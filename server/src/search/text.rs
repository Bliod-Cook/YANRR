//! The text a search matches: what a reader sees of an entry, as CJK runs and words.

use std::sync::LazyLock;

use dom_query::{Document as Html, NodeRef};
use regex::Regex;
use unicode_normalization::UnicodeNormalization;

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

/// The terms of `text`, compared in NFKC and lower case.
fn tokens(text: &str) -> Vec<Token> {
    let folded = text.nfkc().collect::<String>().to_lowercase();
    TERM.captures_iter(&folded)
        .map(|term| match term.name("cjk") {
            Some(run) => Token::Cjk(run.as_str().into()),
            None => Token::Word(term[0].into()),
        })
        .collect()
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
            Token::Word(word) if word.chars().count() < 3 => document.words.contains(word),
            Token::Word(word) => document
                .words
                .iter()
                .any(|found| found.starts_with(word.as_str())),
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

    #[test]
    fn a_query_of_punctuation_has_no_terms() {
        assert_eq!(query(" ，。!? "), []);
        assert_eq!(
            query("Rust 量子 rust"),
            [Token::Word("rust".into()), Token::Cjk("量子".into())]
        );
    }
}
