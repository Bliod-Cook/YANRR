//! The text a search matches: what a reader sees of an entry, as CJK runs and words; and what a result shows of
//! where they matched.

use std::{iter, ops::Range, sync::LazyLock};

use dom_query::{Document as Html, NodeRef};
use regex::Regex;
use serde::Serialize;
use unicode_normalization::{
    IsNormalized, UnicodeNormalization,
    char::{canonical_combining_class, decompose_compatible},
    is_nfkc_quick,
};

/// Characters a snippet shows before the term it is about.
const LEAD: usize = 30;
/// Characters a snippet shows at most.
const SNIPPET: usize = 160;

/// Elements set apart from the text around them.
const BLOCKS: &[&str] = &[
    "address",
    "article",
    "aside",
    "blockquote",
    "br",
    "caption",
    "dd",
    "details",
    "div",
    "dl",
    "dt",
    "figcaption",
    "figure",
    "footer",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "header",
    "hr",
    "li",
    "main",
    "nav",
    "ol",
    "p",
    "pre",
    "section",
    "summary",
    "table",
    "tbody",
    "td",
    "tfoot",
    "th",
    "thead",
    "tr",
    "ul",
];
/// Elements shown without text, which still stand between the text around them.
const MEDIA: &[&str] = &[
    "audio", "canvas", "embed", "iframe", "img", "math", "object", "picture", "svg", "video",
];
/// Elements never shown.
const HIDDEN: &[&str] = &["script", "style", "template"];

/// What a reader sees of `html`, with a line break wherever its text is set apart.
fn visible(html: &str) -> String {
    enum Step<'a> {
        Enter(NodeRef<'a>),
        Leave,
    }
    let document = Html::fragment(html);
    let mut text = String::new();
    // A stack rather than recursion, so that deeply nested markup can't exhaust the thread's.
    let mut steps: Vec<Step> = document
        .html_root()
        .children_it(true)
        .map(Step::Enter)
        .collect();
    while let Some(step) = steps.pop() {
        let node = match step {
            Step::Enter(node) => node,
            Step::Leave => {
                text.push('\n');
                continue;
            }
        };
        if node.is_text() {
            text.push_str(&node.text());
            continue;
        }
        let Some(name) = node.qual_name_ref().map(|name| name.local.to_string()) else {
            continue;
        };
        if HIDDEN.contains(&name.as_str()) {
            continue;
        }
        if MEDIA.contains(&name.as_str()) {
            text.push('\n');
            continue;
        }
        if BLOCKS.contains(&name.as_str()) {
            text.push('\n');
            steps.push(Step::Leave);
        }
        steps.extend(node.children_it(true).map(Step::Enter));
    }
    text
}

/// A run of CJK characters, or a word of other letters, numbers and marks; everything else separates them.
static TERM: LazyLock<Regex> = LazyLock::new(|| {
    let cjk = r"\p{Han}\p{Hiragana}\p{Katakana}\p{Hangul}\x{30FC}";
    Regex::new(&format!(
        r"(?<cjk>[{cjk}]+)|[[\p{{L}}\p{{N}}\p{{M}}]--[{cjk}]]+"
    ))
    .unwrap()
});

/// Text in NFKC and lower case that knows where each part of it comes from.
struct Folded {
    text: String,
    /// Where each piece of the source, folded on its own, ends: in `text`, and in the source.
    ends: Vec<(usize, usize)>,
}

impl Folded {
    /// Folds `source` piece by piece, cut before each character NFKC keeps apart from what comes before, which
    /// gives the same text as folding it whole.
    fn new(source: &str) -> Self {
        let mut folded = Self {
            text: String::with_capacity(source.len()),
            ends: Vec::new(),
        };
        // Where pieces start, and whether with a character NFKC leaves as it is
        let mut starts = source
            .char_indices()
            .filter_map(|(at, c)| {
                let inert = inert(c);
                (at == 0 || inert || stands_alone(c)).then_some((at, inert))
            })
            .peekable();
        while let Some((start, inert)) = starts.next() {
            let end = starts.peek().map_or(source.len(), |&(end, _)| end);
            let piece = &source[start..end];
            let lower = |c: char| c.to_lowercase();
            if inert && piece.chars().nth(1).is_none() {
                folded.text.extend(piece.chars().flat_map(lower));
            } else {
                folded.text.extend(piece.nfkc().flat_map(lower));
            }
            folded.ends.push((folded.text.len(), end));
        }
        folded
    }

    /// Where `range` of the folded text comes from, widened to whole pieces.
    fn source(&self, range: Range<usize>) -> Range<usize> {
        let first = self.ends.partition_point(|&(end, _)| end <= range.start);
        let last = self.ends.partition_point(|&(end, _)| end < range.end);
        let start = first.checked_sub(1).map_or(0, |piece| self.ends[piece].1);
        start..self.ends[last].1
    }
}

/// Whether NFKC leaves `c` as it is and apart from what comes before it.
fn inert(c: char) -> bool {
    c.is_ascii()
        || canonical_combining_class(c) == 0 && is_nfkc_quick(iter::once(c)) == IsNormalized::Yes
}

/// Whether NFKC keeps `c` apart from what comes before it: `c` starts with a character combining with nothing
/// before it.
fn stands_alone(c: char) -> bool {
    let mut first = None;
    decompose_compatible(c, |part| {
        first.get_or_insert(part);
    });
    first.is_some_and(inert)
}

/// The terms of `text`, compared in NFKC and lower case.
fn tokens(text: &str) -> Vec<Token> {
    TERM.captures_iter(&Folded::new(text).text)
        .map(|term| match term.name("cjk") {
            Some(run) => Token::Cjk(run.as_str().into()),
            None => Token::Word(term[0].into()),
        })
        .collect()
}

/// Whether `found`, a word of a text, is `word` of a query: the whole of it or, from three characters, its start.
fn has_word(found: &str, word: &str) -> bool {
    if word.chars().count() < 3 {
        found == word
    } else {
        found.starts_with(word)
    }
}

/// Where the terms of `query` are in `text`, in order: ranges of `text`, each with its term. Of a word, only what
/// the term matches.
fn hits<'a>(text: &str, query: &'a [Token]) -> Vec<(Range<usize>, &'a Token)> {
    let folded = Folded::new(text);
    let mut hits = Vec::new();
    for found in TERM.captures_iter(&folded.text) {
        let whole = found.get(0).expect("a match has a whole");
        for token in query {
            let ranges = match (token, found.name("cjk")) {
                (Token::Cjk(run), Some(_)) => whole
                    .as_str()
                    .match_indices(run.as_str())
                    .map(|(at, _)| at..at + run.len())
                    .collect(),
                (Token::Word(word), None) if has_word(whole.as_str(), word) => {
                    iter::once(0..word.len()).collect()
                }
                _ => Vec::new(),
            };
            hits.extend(ranges.into_iter().map(|range| {
                let range = whole.start() + range.start..whole.start() + range.end;
                (folded.source(range), token)
            }));
        }
    }
    hits.sort_by_key(|(range, _)| range.start);
    hits
}

/// `text` cut at `ranges`, given in order of their starts: what lies between them and, at odd places, the ranges,
/// those that overlap or touch made one.
fn marked(text: &str, ranges: impl IntoIterator<Item = Range<usize>>) -> Vec<String> {
    let mut merged: Vec<Range<usize>> = Vec::new();
    for range in ranges {
        match merged.last_mut() {
            Some(last) if range.start <= last.end => last.end = last.end.max(range.end),
            _ => merged.push(range),
        }
    }
    let mut pieces = Vec::new();
    let mut at = 0;
    for range in merged {
        pieces.push(text[at..range.start].to_owned());
        pieces.push(text[range.clone()].to_owned());
        at = range.end;
    }
    pieces.push(text[at..].to_owned());
    pieces
}

/// `text` with each run of white space made one space.
fn collapsed(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Up to [`SNIPPET`] characters of `text` from about [`LEAD`] before `anchor`, cut like [`marked`]'s at the
/// `hits` it has, with an ellipsis where `text` goes on.
fn snippet(text: &str, hits: &[Range<usize>], anchor: usize) -> Vec<String> {
    let mut start = text[..anchor]
        .char_indices()
        .rev()
        .nth(LEAD - 1)
        .map_or(0, |(at, _)| at);
    // From the start of a word, when one starts before the anchor
    if start > 0
        && !text[..start].ends_with(' ')
        && let Some(space) = text[start..anchor].find(' ')
    {
        start += space + 1;
    }
    let end = text[start..]
        .char_indices()
        .nth(SNIPPET)
        .map_or(text.len(), |(at, _)| start + at);
    let inside = hits
        .iter()
        .filter(|hit| start <= hit.start && hit.end <= end)
        .map(|hit| hit.start - start..hit.end - start);
    let mut pieces = marked(&text[start..end], inside);
    if start > 0 {
        pieces[0].insert(0, '…');
    }
    if end < text.len() {
        pieces.last_mut().expect("pieces are never none").push('…');
    }
    pieces
}

/// What a search result shows of where its terms are.
#[derive(Debug, PartialEq, Serialize)]
pub struct Highlight {
    /// The title cut at the terms: every other piece, from the second, is one.
    pub title: Vec<String>,
    /// Where the description or content has a term the title lacks, cut alike; none when the title has them all.
    pub snippet: Option<Vec<String>>,
}

/// Where the terms of `query` are in an entry; the title and description are plain text, the content is HTML.
pub fn highlight(
    title: Option<&str>,
    description: Option<&str>,
    content: Option<&str>,
    query: &[Token],
) -> Highlight {
    let title = title.unwrap_or_default();
    let in_title = hits(title, query);
    let lacking: Vec<&Token> = query
        .iter()
        .filter(|token| !in_title.iter().any(|(_, found)| found == token))
        .collect();
    let snippet_of = |text: String| {
        let found = hits(&text, query);
        let anchor = found
            .iter()
            .find(|(_, token)| lacking.contains(token))?
            .0
            .start;
        let ranges: Vec<_> = found.into_iter().map(|(range, _)| range).collect();
        Some(snippet(&text, &ranges, anchor))
    };
    let snippet = if lacking.is_empty() {
        None
    } else {
        // The description is usually the start of the content, which takes longer to read.
        description
            .and_then(|description| snippet_of(collapsed(description)))
            .or_else(|| content.and_then(|content| snippet_of(collapsed(&visible(content)))))
    };
    Highlight {
        title: marked(title, in_title.into_iter().map(|(range, _)| range)),
        snippet,
    }
}

/// A search term: a run of CJK characters, matched as a substring, or a word, matched whole or, from three
/// characters, by prefix.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum Token {
    Cjk(String),
    Word(String),
}

/// The CJK runs and words of an entry's title, description and content.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Document {
    pub runs: Vec<String>,
    pub words: Vec<String>,
}

impl Document {
    fn add(&mut self, text: &str) {
        for token in tokens(text) {
            match token {
                Token::Cjk(run) => self.runs.push(run),
                Token::Word(word) => self.words.push(word),
            }
        }
    }
}

/// The document of an entry; the title and description are plain text, the content is HTML.
pub fn document(title: Option<&str>, description: Option<&str>, content: Option<&str>) -> Document {
    let mut document = Document::default();
    title
        .into_iter()
        .chain(description)
        .for_each(|text| document.add(text));
    if let Some(content) = content {
        document.add(&visible(content));
    }
    document
}

/// The distinct terms of a query; none when it has only punctuation.
pub fn query(text: &str) -> Vec<Token> {
    let mut terms = Vec::new();
    for token in tokens(text) {
        if !terms.contains(&token) {
            terms.push(token);
        }
    }
    terms
}

/// Whether `document` has every term of `query`.
pub fn matches(document: &Document, query: &[Token]) -> bool {
    !query.is_empty()
        && query.iter().all(|token| match token {
            Token::Cjk(run) => document
                .runs
                .iter()
                .any(|found| found.contains(run.as_str())),
            Token::Word(word) => document.words.iter().any(|found| has_word(found, word)),
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn body_matches(content: &str, text: &str) -> bool {
        matches(&document(None, None, Some(content)), &query(text))
    }

    #[test]
    fn content_matches_what_a_reader_sees() {
        let cases = [
            ("今天量子计算有新突破", "量子计算", true),
            ("今天量子计算有新突破", "子计", true),
            ("今天量子计算有新突破", "计量", false),
            ("今天量子计算有新突破", "破", true),
            ("量子，计算", "量子计算", false),
            ("量子&nbsp;计算", "量子计算", false),
            ("量子<b>计算</b>", "量子计算", true),
            ("<p>量子</p><p>计算</p>", "量子计算", false),
            ("量子<br>计算", "量子计算", false),
            ("<li>量子</li><li>计算</li>", "量子计算", false),
            (r#"<p class="img-box">今天</p>"#, "class", false),
            (r#"<img src="secret.png">"#, "secret", false),
            (
                "<script>secretscript</script><style>secretstyle</style>visible",
                "secretscript",
                false,
            ),
            ("<pre>let answer = 42;</pre>", "answer", true),
            ("<p>量<span>子<br>计算</span></p>", "量子", true),
            ("<p>量<span>子<br>计算</span></p>", "子计", false),
            ("量<script>x</script>子", "量子", true),
            ("foo<img>bar", "bar", true),
            ("foo<img>bar", "foobar", false),
            ("AIR quality", "AI", false),
            ("AI said", "AI", true),
            ("said", "AI", false),
            ("Rust models", "model", true),
            ("“Rust”—great", "great", true),
            ("ＡＢＣ１２３", "abc123", true),
            ("ｹﾞｰﾑ開発", "ゲーム", true),
            ("ゲーム開発", "ム開", true),
            ("한국어검색", "국어", true),
            ("東京ゲーム開発", "京ゲ", true),
            ("北京𠀀科技", "𠀀科", true),
            ("Caf\u{e9}", "cafe\u{301}", true),
            ("A&amp;B", "a b", true),
            ("Rust", "，。", false),
            ("量子和计算", "量子计算", false),
            ("量子和子计和计算", "量子计算", false),
            ("量子计算", "计算 量子", true),
            ("running", "run", true),
            ("running", "ran", false),
            ("smaller", "all", false),
            ("in", "in", true),
            ("inside", "in", false),
            (
                r#"<a href="class">量子</a><strong>计算</strong>"#,
                "量子计算",
                true,
            ),
            ("量子<!-- ignored -->计算", "量子计算", true),
            ("&lt;class&gt;", "class", true),
        ];
        for (content, text, expected) in cases {
            assert_eq!(
                body_matches(content, text),
                expected,
                "{content:?} / {text:?}"
            );
        }
    }

    #[test]
    fn terms_may_be_in_different_fields_but_runs_do_not_cross_them() {
        let document = document(Some("量子"), Some("Rust models"), Some("计算"));
        assert!(matches(&document, &query("量子 计算 model")));
        assert!(!matches(&document, &query("量子计算")));
    }

    #[test]
    fn the_description_is_plain_text() {
        let document = document(None, Some("a<b>c"), None);
        assert!(!matches(&document, &query("ac")));
        assert!(matches(&document, &query("b")));
    }

    fn title_marks(title: &str, text: &str) -> Vec<String> {
        highlight(Some(title), None, None, &query(text)).title
    }

    #[test]
    fn matches_are_marked_in_the_text_they_were_found_in() {
        let cases: &[(&str, &str, &[&str])] = &[
            ("ＡＢＣ１２３ abc", "abc123", &["", "ＡＢＣ１２３", " abc"]),
            ("ｹﾞｰﾑ開発", "ゲーム", &["", "ｹﾞｰﾑ", "開発"]),
            (
                "Cafe\u{301} au lait",
                "caf\u{e9}",
                &["", "Cafe\u{301}", " au lait"],
            ),
            ("㍿の話", "株式", &["", "㍿", "の話"]),
            (
                "Evaluation of models",
                "eval model",
                &["", "Eval", "uation of ", "model", "s"],
            ),
            ("今天量子计算", "量子 子计", &["今天", "量子计", "算"]),
            ("AI said, AIR", "ai", &["", "AI", " said, AIR"]),
            ("Rust", "go", &["Rust"]),
        ];
        for (title, text, marked) in cases {
            assert_eq!(&title_marks(title, text), marked, "{title:?} / {text:?}");
        }
        assert_eq!(highlight(None, None, None, &query("go")).title, [""]);
    }

    #[test]
    fn a_snippet_shows_a_term_the_title_lacks() {
        let terms = query("rust async");
        let snippet = |title, description, content| {
            highlight(Some(title), description, content, &terms).snippet
        };
        assert_eq!(snippet("Rust async", Some("async rust"), None), None);
        assert_eq!(
            snippet("Rust", Some("All about async."), Some("<p>async</p>")),
            Some(["All about ", "async", "."].map(String::from).into())
        );
        assert_eq!(
            snippet(
                "Rust",
                Some("Nothing here"),
                Some("<p>Rust\n\n  and</p><p>async</p>")
            ),
            Some(["", "Rust", " and ", "async", ""].map(String::from).into())
        );
        assert_eq!(snippet("Rust", Some("Nothing here"), None), None);
    }

    #[test]
    fn a_snippet_is_cut_around_the_term_from_the_start_of_a_word() {
        let filler = "abcdef ".repeat(40);
        let content = format!("rust {filler}async {filler}");
        let snippet = highlight(Some("Rust"), None, Some(&content), &query("rust async"))
            .snippet
            .unwrap();
        assert_eq!(snippet[0], format!("…{}", "abcdef ".repeat(4)));
        assert_eq!(snippet[1], "async");
        assert_eq!(snippet.len(), 3);
        assert!(snippet[2].ends_with('…'));
        assert!(snippet.concat().chars().count() <= SNIPPET + 2);
    }

    #[test]
    fn a_query_of_punctuation_has_no_terms() {
        assert_eq!(query(" ，。!? "), []);
        assert_eq!(
            query("Rust 量子 rust"),
            [Token::Word("rust".into()), Token::Cjk("量子".into())]
        );
    }
}
