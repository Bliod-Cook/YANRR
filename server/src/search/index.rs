//! The search index: candidate terms of each entry, newest first, with nothing stored.

use std::{collections::BTreeSet, ops::Bound};

use tantivy::{
    DocId, IndexWriter, Searcher, SegmentReader, TantivyDocument, Term,
    collector::TopDocs,
    columnar::ColumnValues,
    query::{BooleanQuery, EmptyQuery, Occur, Query, RangeQuery, TermQuery, TermSetQuery},
    schema::{Field, IndexRecordOption, NumericOptions, Schema, TextFieldIndexing, TextOptions},
};

use super::text::{Document, Token};

/// Where an entry sorts: newest first, then by id.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct Key {
    /// Microseconds since the epoch.
    pub published: i64,
    pub id: u64,
}

/// An entry as the index takes it.
pub struct Entry {
    pub key: Key,
    /// `f<feed id>` or `i<inbox handle>`.
    pub source: String,
    pub document: Document,
}

pub struct Fields {
    id: Field,
    published: Field,
    source: Field,
    cjk: Field,
    word: Field,
}

pub fn schema() -> Schema {
    let mut builder = Schema::builder();
    builder.add_u64_field("id", NumericOptions::default().set_indexed().set_fast());
    builder.add_i64_field("published", NumericOptions::default().set_fast());
    builder.add_text_field("source", terms("raw"));
    builder.add_text_field("cjk", terms("whitespace"));
    builder.add_text_field("word", terms("whitespace"));
    builder.build()
}

/// A field of terms that are only looked up: no positions, frequencies or norms, nothing stored.
fn terms(tokenizer: &str) -> TextOptions {
    let indexing = TextFieldIndexing::default()
        .set_tokenizer(tokenizer)
        .set_index_option(IndexRecordOption::Basic)
        .set_fieldnorms(false);
    TextOptions::default().set_indexing_options(indexing)
}

impl Fields {
    pub fn new(schema: &Schema) -> Self {
        let field = |name| {
            schema
                .get_field(name)
                .expect("the search schema has the field")
        };
        Self {
            id: field("id"),
            published: field("published"),
            source: field("source"),
            cjk: field("cjk"),
            word: field("word"),
        }
    }

    /// Replaces the entry's document, if any, with this one.
    pub fn add(&self, writer: &IndexWriter, entry: &Entry) -> tantivy::Result<()> {
        self.delete(writer, entry.key.id);
        let mut document = TantivyDocument::default();
        document.add_u64(self.id, entry.key.id);
        document.add_i64(self.published, entry.key.published);
        document.add_text(self.source, &entry.source);
        document.add_text(self.cjk, grams(&entry.document.runs));
        document.add_text(self.word, joined(entry.document.words.iter().cloned()));
        writer.add_document(document)?;
        Ok(())
    }

    /// Removes the entry's document, if any.
    pub fn delete(&self, writer: &IndexWriter, id: u64) {
        writer.delete_term(Term::from_field_u64(self.id, id));
    }
}

/// The terms of CJK runs: every character and trigram, and the last two characters of each run, so that a
/// substring of one or three characters is a term and one of two is a prefix of one.
fn grams(runs: &[String]) -> String {
    let mut terms = Vec::new();
    for run in runs {
        let chars: Vec<char> = run.chars().collect();
        terms.extend(chars.iter().map(char::to_string));
        terms.extend(chars.windows(3).map(String::from_iter));
        if chars.len() >= 2 {
            terms.push(String::from_iter(&chars[chars.len() - 2..]));
        }
    }
    joined(terms)
}

fn joined(terms: impl IntoIterator<Item = String>) -> String {
    let distinct: BTreeSet<String> = terms.into_iter().collect();
    distinct.into_iter().collect::<Vec<_>>().join(" ")
}

/// A query on the index: entries of `sources` that may match `tokens`.
pub struct Plan {
    query: Box<dyn Query>,
    id: Field,
    published: Field,
    /// Whether a candidate must still be checked against its text: the index can't tell where terms are.
    pub verify: bool,
}

impl Plan {
    pub fn new(fields: &Fields, tokens: &[Token], sources: &[String]) -> Self {
        let mut verify = false;
        let mut clauses = Vec::new();
        for token in tokens {
            match token {
                Token::Cjk(run) => {
                    let chars: Vec<char> = run.chars().collect();
                    match chars.len() {
                        1 | 3 => clauses.push(term(fields.cjk, run)),
                        2 => clauses.push(prefix(fields.cjk, run)),
                        _ => {
                            verify = true;
                            let trigrams = chars.windows(3).map(String::from_iter);
                            clauses.extend(trigrams.map(|trigram| term(fields.cjk, &trigram)));
                        }
                    }
                }
                Token::Word(word) if word.chars().count() < 3 => {
                    clauses.push(term(fields.word, word))
                }
                Token::Word(word) => clauses.push(prefix(fields.word, word)),
            }
        }
        let query: Box<dyn Query> = if clauses.is_empty() {
            Box::new(EmptyQuery)
        } else {
            let sources = sources
                .iter()
                .map(|source| Term::from_field_text(fields.source, source));
            clauses.push(Box::new(TermSetQuery::new(sources)));
            Box::new(all(clauses))
        };
        Self {
            query,
            id: fields.id,
            published: fields.published,
            verify,
        }
    }

    /// The keys of up to `limit` candidates, newest first, sorting after `before`.
    pub fn top(
        &self,
        searcher: &Searcher,
        before: Option<Key>,
        limit: usize,
    ) -> tantivy::Result<Vec<Key>> {
        let query = match before {
            Some(key) => Box::new(all(vec![self.query.box_clone(), self.before(key)])),
            None => self.query.box_clone(),
        };
        let newest = TopDocs::with_limit(limit).custom_score(|segment: &SegmentReader| {
            let fast = segment.fast_fields();
            let published = fast
                .i64("published")
                .expect("published is fast")
                .first_or_default_col(0);
            let id = fast.u64("id").expect("id is fast").first_or_default_col(0);
            move |doc: DocId| Key {
                published: published.get_val(doc),
                id: id.get_val(doc),
            }
        });
        let hits = searcher.search(&query, &newest)?;
        Ok(hits.into_iter().map(|(key, _)| key).collect())
    }

    /// Entries that sort after `key`: published earlier, or at the same time with a lower id.
    fn before(&self, key: Key) -> Box<dyn Query> {
        let published = Term::from_field_i64(self.published, key.published);
        let earlier = RangeQuery::new(Bound::Unbounded, Bound::Excluded(published.clone()));
        let same_time = RangeQuery::new(
            Bound::Included(published.clone()),
            Bound::Included(published),
        );
        let lower_id = RangeQuery::new(
            Bound::Unbounded,
            Bound::Excluded(Term::from_field_u64(self.id, key.id)),
        );
        let tie: Box<dyn Query> = Box::new(all(vec![Box::new(same_time), Box::new(lower_id)]));
        Box::new(BooleanQuery::new(vec![
            (Occur::Should, Box::new(earlier)),
            (Occur::Should, tie),
        ]))
    }
}

fn all(queries: Vec<Box<dyn Query>>) -> BooleanQuery {
    BooleanQuery::new(
        queries
            .into_iter()
            .map(|query| (Occur::Must, query))
            .collect(),
    )
}

fn term(field: Field, text: &str) -> Box<dyn Query> {
    Box::new(TermQuery::new(
        Term::from_field_text(field, text),
        IndexRecordOption::Basic,
    ))
}

/// Terms starting with `text`: none holds U+10FFFF, so the range is exactly them.
fn prefix(field: Field, text: &str) -> Box<dyn Query> {
    let lower = Term::from_field_text(field, text);
    let upper = Term::from_field_text(field, &format!("{text}\u{10FFFF}"));
    Box::new(RangeQuery::new(
        Bound::Included(lower),
        Bound::Excluded(upper),
    ))
}

#[cfg(test)]
mod tests {
    use tantivy::Index;

    use super::*;
    use crate::search::text::{document, matches, query};

    struct Fixture {
        index: Index,
        fields: Fields,
    }

    impl Fixture {
        fn new(entries: &[Entry]) -> Self {
            let index = Index::create_in_ram(schema());
            let fields = Fields::new(&index.schema());
            let mut writer: IndexWriter = index.writer(15_000_000).unwrap();
            for entry in entries {
                fields.add(&writer, entry).unwrap();
            }
            writer.commit().unwrap();
            Self { index, fields }
        }

        fn top(
            &self,
            text: &str,
            sources: &[&str],
            before: Option<Key>,
            limit: usize,
        ) -> (Vec<Key>, bool) {
            let sources: Vec<_> = sources.iter().map(|source| source.to_string()).collect();
            let plan = Plan::new(&self.fields, &query(text), &sources);
            let searcher = self.index.reader().unwrap().searcher();
            (plan.top(&searcher, before, limit).unwrap(), plan.verify)
        }
    }

    fn entry(id: u64, published: i64, source: &str, content: &str) -> Entry {
        Entry {
            key: Key { published, id },
            source: source.into(),
            document: document(None, None, Some(content)),
        }
    }

    /// Bodies that look alike in their characters but not in their order, so that terms often meet by chance.
    fn lookalikes() -> Vec<String> {
        let mut seed: u32 = 73;
        let alphabet: Vec<char> = "甲乙丙，".chars().collect();
        (0..120)
            .map(|_| {
                (0..20)
                    .map(|_| {
                        seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                        // The low bits of this generator repeat every few steps; the high ones don't.
                        alphabet[(seed >> 16) as usize % 4]
                    })
                    .collect()
            })
            .collect()
    }

    #[test]
    fn candidates_checked_when_needed_are_exactly_the_matches() {
        let mut bodies: Vec<String> = [
            "今天量子计算有新突破",
            "量子，计算",
            "量子<b>计算</b>",
            "量子和子计和计算",
            "量子<br>计算",
            "ゲーム開発",
            "ｹﾞｰﾑ開発",
            "한국어검색",
            "北京𠀀科技",
            "AIR quality",
            "AI said",
            "Rust models",
            "running",
            "<script>hiddenword</script>visible",
            "甲乙 丙丁",
            "甲乙丙丁",
        ]
        .map(String::from)
        .into();
        bodies.extend(lookalikes());
        let entries: Vec<_> = bodies
            .iter()
            .enumerate()
            .map(|(i, body)| entry(i as u64 + 1, 0, "f1", body))
            .collect();
        let fixture = Fixture::new(&entries);
        let queries = [
            "量子计算",
            "量子 计算",
            "子计",
            "计量",
            "破",
            "AI",
            "model",
            "run",
            "ム開",
            "ゲーム",
            "국어",
            "𠀀科",
            "hiddenword",
            "甲乙丙",
            "丁",
            "甲 乙",
            "甲甲",
            "乙丙甲乙",
            "，。",
        ];
        for text in queries {
            let (candidates, verify) = fixture.top(text, &["f1"], None, 1000);
            let terms = query(text);
            let found: BTreeSet<u64> = candidates
                .iter()
                .filter(|key| !verify || matches(&entries[key.id as usize - 1].document, &terms))
                .map(|key| key.id)
                .collect();
            let expected: BTreeSet<u64> = entries
                .iter()
                .filter(|entry| matches(&entry.document, &terms))
                .map(|entry| entry.key.id)
                .collect();
            assert_eq!(found, expected, "{text:?}");
            if !verify {
                assert_eq!(candidates.len(), expected.len(), "{text:?} needs no check");
            }
        }
    }

    #[test]
    fn adding_an_entry_again_replaces_it() {
        let fixture = Fixture::new(&[entry(1, 0, "f1", "量子"), entry(1, 0, "f1", "量子计算")]);
        assert_eq!(fixture.index.reader().unwrap().searcher().num_docs(), 1);
        assert_eq!(fixture.top("计算", &["f1"], None, 10).0.len(), 1);
    }

    #[test]
    fn candidates_come_newest_first_from_the_given_sources() {
        let fixture = Fixture::new(&[
            entry(1, 100, "f1", "rust"),
            entry(2, 200, "f1", "rust"),
            entry(3, 200, "f1", "rust"),
            entry(4, 300, "ihome", "rust"),
            entry(5, 400, "f2", "rust"),
        ]);
        let key = |published, id| Key { published, id };
        let (first, _) = fixture.top("rust", &["f1", "ihome"], None, 2);
        assert_eq!(first, [key(300, 4), key(200, 3)]);
        let (rest, _) = fixture.top("rust", &["f1", "ihome"], Some(key(200, 3)), 10);
        assert_eq!(rest, [key(200, 2), key(100, 1)]);
    }
}
