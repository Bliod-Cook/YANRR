//! HTML translated a run of text at a time, so that markup, media and code stay as they are.

use std::collections::HashSet;

use dom_query::{Document, NodeId, NodeRef};

use crate::html::{BLOCKS, HIDDEN, MEDIA, named};

/// Blocks of code, whose text is left as it is.
const CODE: &[&str] = &["pre"];

/// The text of each run in `html`, in order.
pub fn texts(html: &str) -> Vec<String> {
    let document = Document::fragment(html);
    runs(&document.html_root())
        .iter()
        .map(|run| text(run))
        .collect()
}

/// `html` with each run replaced by its translation, or followed by it on a line of its own when `bilingual`;
/// `translations` are those of [`texts`], in order.
pub fn translated(html: &str, translations: &[String], bilingual: bool) -> String {
    let document = Document::fragment(html);
    let root = document.html_root();
    for (run, translation) in runs(&root).iter().zip(translations) {
        let translation = document.tree.new_text(translation.as_str());
        if bilingual {
            let last = run.last().expect("a run has a node");
            last.insert_after(&translation);
            last.insert_after(&document.tree.new_element("br"));
        } else {
            run[0].insert_before(&translation);
            run.iter().for_each(NodeRef::remove_from_parent);
        }
    }
    root.inner_html().to_string()
}

/// The runs under `root` that have text: sibling text and inline elements between the elements that end them.
fn runs<'a>(root: &NodeRef<'a>) -> Vec<Vec<NodeRef<'a>>> {
    enum Step<'a> {
        Enter(NodeRef<'a>),
        Leave,
    }
    let holding = holding(root);
    let ends_run = |node: &NodeRef| node.is_element() && (ends(node) || holding.contains(&node.id));
    let (mut found, mut run) = (Vec::new(), Vec::new());
    // A stack rather than recursion, so that deeply nested markup can't exhaust the thread's.
    let mut steps: Vec<Step> = root.children_it(true).map(Step::Enter).collect();
    while let Some(step) = steps.pop() {
        match step {
            Step::Enter(node) if !ends_run(&node) => run.push(node),
            Step::Enter(node) => {
                found.push(std::mem::take(&mut run));
                if !kept(&node) {
                    steps.push(Step::Leave);
                    steps.extend(node.children_it(true).map(Step::Enter));
                }
            }
            Step::Leave => found.push(std::mem::take(&mut run)),
        }
    }
    found.push(run);
    found.retain(|run| !text(run).is_empty());
    found
}

/// Whether `node` ends a run: a block, line break, media, code or what is never shown.
fn ends(node: &NodeRef) -> bool {
    named(node, BLOCKS) || named(node, MEDIA) || named(node, HIDDEN)
}

/// Whether the text inside `node` is left as it is.
fn kept(node: &NodeRef) -> bool {
    named(node, MEDIA) || named(node, HIDDEN) || named(node, CODE)
}

/// The nodes under `root` holding an element that ends a run, so that they end runs too. Each is found once, from
/// the inside out, which keeps deeply nested markup from taking quadratic time.
fn holding(root: &NodeRef) -> HashSet<NodeId> {
    let mut holding = HashSet::new();
    for node in root.descendants_it().filter(ends) {
        for ancestor in node.ancestors_it(None) {
            if !holding.insert(ancestor.id) {
                break;
            }
        }
    }
    holding
}

/// The text of a run with whitespace collapsed.
fn text(run: &[NodeRef]) -> String {
    let text: String = run.iter().map(|node| node.text().to_string()).collect();
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    const HTML: &str = r#"Intro <b>text</b><p>One <a href="/a">link</a>.</p><ul><li>Item<ul><li>Sub</li></ul></li></ul>Line 1<br>Line 2<img src="a.png"><pre>code</pre>"#;

    #[test]
    fn runs_are_translated_around_markup_media_and_code() {
        let texts = texts(HTML);
        assert_eq!(
            texts,
            ["Intro text", "One link.", "Item", "Sub", "Line 1", "Line 2"]
        );
        let translations: Vec<_> = texts.iter().map(|text| text.to_uppercase()).collect();

        assert_eq!(
            translated(HTML, &translations, false),
            r#"INTRO TEXT<p>ONE LINK.</p><ul><li>ITEM<ul><li>SUB</li></ul></li></ul>LINE 1<br>LINE 2<img src="a.png"><pre>code</pre>"#
        );
        assert_eq!(
            translated(HTML, &translations, true),
            r#"Intro <b>text</b><br>INTRO TEXT<p>One <a href="/a">link</a>.<br>ONE LINK.</p><ul><li>Item<br>ITEM<ul><li>Sub<br>SUB</li></ul></li></ul>Line 1<br>LINE 1<br>Line 2<br>LINE 2<img src="a.png"><pre>code</pre>"#
        );
    }

    #[test]
    fn what_a_reader_does_not_see_is_left_as_it_is() {
        let html = "<title>Weekly</title><style>p { color: red }</style><p>Hello</p>";
        assert_eq!(texts(html), ["Hello"]);
        assert_eq!(
            translated(html, &["HELLO".into()], false),
            "<title>Weekly</title><style>p { color: red }</style><p>HELLO</p>"
        );
    }

    #[test]
    fn deeply_nested_markup_does_not_exhaust_the_stack() {
        let html = format!("{}<br>deep", "<span>".repeat(100_000));
        assert_eq!(texts(&html), ["deep"]);
        assert!(translated(&html, &["DEEP".into()], false).contains("<br>DEEP</span>"));
    }
}
