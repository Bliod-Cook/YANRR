//! HTML as a reader sees it: the text it shows, and the elements that set text apart.

use dom_query::{Document, NodeRef};

/// Elements set apart from the text around them.
pub const BLOCKS: &[&str] = &[
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
pub const MEDIA: &[&str] = &[
    "audio", "canvas", "embed", "iframe", "img", "math", "object", "picture", "svg", "video",
];
/// Elements never shown, such as those an HTML email's head leaves in its body.
pub const HIDDEN: &[&str] = &["script", "style", "template", "title"];

/// Whether `node` is an element named one of `names`.
pub fn named(node: &NodeRef, names: &[&str]) -> bool {
    node.qual_name_ref()
        .is_some_and(|name| names.contains(&name.local.as_ref()))
}

/// What a reader sees of `html`, with a line break wherever its text is set apart.
pub fn visible(html: &str) -> String {
    enum Step<'a> {
        Enter(NodeRef<'a>),
        Leave,
    }
    let document = Document::fragment(html);
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
        } else if named(&node, MEDIA) {
            text.push('\n');
        } else if !named(&node, HIDDEN) {
            if named(&node, BLOCKS) {
                text.push('\n');
                steps.push(Step::Leave);
            }
            steps.extend(node.children_it(true).map(Step::Enter));
        }
    }
    text
}

/// What a reader sees of `html` on one line, with white space collapsed.
pub fn text(html: &str) -> String {
    visible(html)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_is_what_a_reader_sees() {
        let cases = [
            ("今天<b>量子</b>计算", "今天量子计算"),
            ("<p>One</p><p>Two</p>", "One Two"),
            ("Line<br>break", "Line break"),
            (
                "<title>Weekly</title><style>p { color: red }</style><script>track()</script><p>Hello</p>",
                "Hello",
            ),
            ("A&amp;B <!-- note -->  C", "A&B C"),
        ];
        for (html, expected) in cases {
            assert_eq!(text(html), expected, "{html:?}");
        }
    }
}
