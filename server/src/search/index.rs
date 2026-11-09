//! The search index: candidate terms of each entry and of its title, with nothing stored.

use std::{collections::BTreeSet, ops::Bound};

use tantivy::{
    DocId, IndexWriter, Score, Searcher, SegmentReader, TantivyDocument, Term,
    collector::TopDocs,
    columnar::ColumnValues,
    query::{
        BooleanQuery, ConstScoreQuery, EmptyQuery, Occur, Query, RangeQuery, TermQuery,
        TermSetQuery,
    },
    schema::{Field, IndexRecordOption, NumericOptions, Schema, TextFieldIndexing, TextOptions},
};

use super::text::{Document, Token};

/// Where an entry sorts among the results, first to last: most terms of the query in its title, then newest, then
/// by id.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct Key {
    /// How many terms of the query its title has.
    pub title: u32,
    /// Microseconds since the epoch.
    pub published: i64,
    pub id: u64,
}

/// An entry as the index takes it.
pub struct Entry {
    pub id: u64,
    /// Microseconds since the epoch.
    pub published: i64,
    /// `f<feed id>` or `i<inbox handle>`.
    pub source: String,
    /// Of the title alone.
    pub title: Document,
    /// Of the title, description and content.
    pub document: Document,
}

/// The fields holding the terms of a text.
struct Terms {
    cjk: Field,
    word: Field,
}

impl Terms {
    fn new(schema: &Schema, prefix: &str) -> Self {
        Self {
            cjk: field(schema, &format!("{prefix}cjk")),
            word: field(schema, &format!("{prefix}word")),
        }
    }

    fn add(&self, target: &mut TantivyDocument, document: &Document) {
        target.add_text(self.cjk, grams(&document.runs));
        target.add_text(self.word, joined(document.words.iter().cloned()));
    }

    /// The texts that may have `token`, and whether one must still be checked: the index can't tell where terms
    /// are.
    fn query(&self, token: &Token) -> (Box<dyn Query>, bool) {
        match token {
            Token::Cjk(run) => {
                let chars: Vec<char> = run.chars().collect();
                match chars.len() {
                    1 | 3 => (term(self.cjk, run), false),
                    2 => (prefix(self.cjk, run), false),
                    _ => {
                        let trigrams = chars.windows(3).map(String::from_iter);
                        let terms = trigrams.map(|trigram| term(self.cjk, &trigram)).collect();
                        (Box::new(all(terms)), true)
                    }
                }
            }
            Token::Word(word) if word.chars().count() < 3 => (term(self.word, word), false),
            Token::Word(word) => (prefix(self.word, word), false),
        }
    }
}

pub struct Fields {
    id: Field,
    published: Field,
    source: Field,
    /// Of the title, description and content.
    text: Terms,
    title: Terms,
}

pub fn schema() -> Schema {
    let mut builder = Schema::builder();
    builder.add_u64_field("id", NumericOptions::default().set_indexed().set_fast());
    builder.add_i64_field("published", NumericOptions::default().set_fast());
    builder.add_text_field("source", terms("raw"));
    for name in ["cjk", "word", "title_cjk", "title_word"] {
        builder.add_text_field(name, terms("whitespace"));
    }
    builder.build()
}

fn field(schema: &Schema, name: &str) -> Field {
    schema
        .get_field(name)
        .expect("the search schema has the field")
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
        Self {
            id: field(schema, "id"),
            published: field(schema, "published"),
            source: field(schema, "source"),
            text: Terms::new(schema, ""),
            title: Terms::new(schema, "title_"),
        }
    }

    /// Replaces the entry's document, if any, with this one.
    pub fn add(&self, writer: &IndexWriter, entry: &Entry) -> tantivy::Result<()> {
        self.delete(writer, entry.id);
        let mut document = TantivyDocument::default();
        document.add_u64(self.id, entry.id);
        document.add_i64(self.published, entry.published);
        document.add_text(self.source, &entry.source);
        self.text.add(&mut document, &entry.document);
        self.title.add(&mut document, &entry.title);
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

/// A query on the index: entries of `sources` that may match `tokens`, ranked by the terms in their title.
pub struct Plan {
    query: Box<dyn Query>,
    /// For each term, the entries whose title may have it.
    title: Vec<Box<dyn Query>>,
    id: Field,
    /// Whether a candidate must still be checked against its text: the index can't tell where terms are.
    pub verify: bool,
}

impl Plan {
    pub fn new(fields: &Fields, tokens: &[Token], sources: &[String]) -> Self {
        let mut verify = false;
        let mut clauses = Vec::new();
        for token in tokens {
            let (clause, check) = fields.text.query(token);
            clauses.push(clause);
            verify |= check;
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
            title: tokens
                .iter()
                .map(|token| fields.title.query(token).0)
                .collect(),
            id: fields.id,
            verify,
        }
    }

    /// The keys of up to `limit` candidates, in order, sorting after `before`.
    pub fn top(
        &self,
        searcher: &Searcher,
        before: Option<Key>,
        limit: usize,
    ) -> tantivy::Result<Vec<Key>> {
        self.ranked(searcher, self.query.box_clone(), before, limit)
    }

    /// Where the entry `id` sorts, whether it matches or not; `None` if the index doesn't have it.
    pub fn key(&self, searcher: &Searcher, id: u64) -> tantivy::Result<Option<Key>> {
        let entry = TermQuery::new(Term::from_field_u64(self.id, id), IndexRecordOption::Basic);
        Ok(self.ranked(searcher, Box::new(entry), None, 1)?.pop())
    }

    /// The keys of up to `limit` entries of `query`, in order, sorting after `before`. Each title query an entry
    /// matches scores one.
    fn ranked(
        &self,
        searcher: &Searcher,
        query: Box<dyn Query>,
        before: Option<Key>,
        limit: usize,
    ) -> tantivy::Result<Vec<Key>> {
        let scored = |query: Box<dyn Query>, score| -> Box<dyn Query> {
            Box::new(ConstScoreQuery::new(query, score))
        };
        let mut clauses = vec![(Occur::Must, scored(query, 0.0))];
        for title in &self.title {
            clauses.push((Occur::Should, scored(title.box_clone(), 1.0)));
        }
        let keys = TopDocs::with_limit(limit).tweak_score(move |segment: &SegmentReader| {
            let fast = segment.fast_fields();
            let published = fast
                .i64("published")
                .expect("published is fast")
                .first_or_default_col(0);
            let id = fast.u64("id").expect("id is fast").first_or_default_col(0);
            move |doc: DocId, score: Score| {
                let key = Key {
                    title: score as u32,
                    published: published.get_val(doc),
                    id: id.get_val(doc),
                };
                // Entries up to `before` score lowest, and are dropped below.
                before.is_none_or(|before| key < before).then_some(key)
            }
        });
        let hits = searcher.search(&BooleanQuery::new(clauses), &keys)?;
        Ok(hits.into_iter().filter_map(|(key, _)| key).collect())
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

        fn plan(&self, text: &str, sources: &[&str]) -> Plan {
            let sources: Vec<_> = sources.iter().map(|source| source.to_string()).collect();
            Plan::new(&self.fields, &query(text), &sources)
        }

        fn searcher(&self) -> Searcher {
            self.index.reader().unwrap().searcher()
        }

        fn top(
            &self,
            text: &str,
            sources: &[&str],
            before: Option<Key>,
            limit: usize,
        ) -> (Vec<Key>, bool) {
            let plan = self.plan(text, sources);
            (
                plan.top(&self.searcher(), before, limit).unwrap(),
                plan.verify,
            )
        }

        fn key(&self, text: &str, id: u64) -> Option<Key> {
            self.plan(text, &["f1"]).key(&self.searcher(), id).unwrap()
        }
    }

    fn entry(id: u64, published: i64, source: &str, content: &str) -> Entry {
        Entry {
            id,
            published,
            source: source.into(),
            title: Document::default(),
            document: document(None, None, Some(content)),
        }
    }

    fn titled(id: u64, published: i64, title: &str, content: &str) -> Entry {
        Entry {
            title: document(Some(title), None, None),
            document: document(Some(title), None, Some(content)),
            ..entry(id, published, "f1", "")
        }
    }

    fn ids(keys: &[Key]) -> Vec<u64> {
        keys.iter().map(|key| key.id).collect()
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
                .map(|entry| entry.id)
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
        let (first, _) = fixture.top("rust", &["f1", "ihome"], None, 2);
        assert_eq!(ids(&first), [4, 3]);
        let (rest, _) = fixture.top("rust", &["f1", "ihome"], Some(first[1]), 10);
        assert_eq!(ids(&rest), [2, 1]);
    }

    #[test]
    fn entries_with_more_terms_in_their_title_come_first() {
        let fixture = Fixture::new(&[
            titled(1, 100, "Rust async", ""),
            titled(2, 400, "Notes", "rust async"),
            titled(3, 200, "Rust", "async"),
            titled(4, 300, "Async", "rust"),
            titled(5, 50, "Rust async runtimes", ""),
            titled(6, 500, "Rust", ""),
        ]);
        let (first, _) = fixture.top("rust async", &["f1"], None, 3);
        assert_eq!(ids(&first), [1, 5, 4]);
        // A page goes on from where the entry it ended at sorts.
        let after = fixture.key("rust async", 4).unwrap();
        let (rest, _) = fixture.top("rust async", &["f1"], Some(after), 10);
        assert_eq!(ids(&rest), [3, 2]);
        // Entries sort where they would whether they match or not; the index may not have them.
        assert_eq!(fixture.key("rust async", 6).map(|key| key.title), Some(1));
        assert_eq!(fixture.key("rust async", 7), None);
    }
}
