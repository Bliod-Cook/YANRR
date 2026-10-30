//! HTML translated a run of text at a time, so that markup, media and code stay as they are.

use dom_query::{Document, NodeRef};

/// Elements that end a run of text; the runs inside them are their own.
const BREAKS: &[&str] = &[
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
/// Elements that end a run of text and are left as they are.
const KEPT: &[&str] = &[
    "audio", "canvas", "embed", "iframe", "img", "math", "object", "picture", "pre", "script",
    "style", "svg", "template", "video",
];

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

/// The runs under `parent` that have text: sibling text and inline elements between the elements that end them.
fn runs<'a>(parent: &NodeRef<'a>) -> Vec<Vec<NodeRef<'a>>> {
    let (mut found, mut run) = (Vec::new(), Vec::new());
    for child in parent.children_it(false) {
        if !ends_run(&child) {
            run.push(child);
            continue;
        }
        found.push(std::mem::take(&mut run));
        if !named(&child, KEPT) {
            found.extend(runs(&child));
        }
    }
    found.push(run);
    found.retain(|run| !text(run).is_empty());
    found
}

/// Whether `node` ends a run: a block, line break, media or code, or an element holding one.
fn ends_run(node: &NodeRef) -> bool {
    let ends = |node: &NodeRef| named(node, BREAKS) || named(node, KEPT);
    node.is_element() && (ends(node) || node.descendants_it().any(|node| ends(&node)))
}

fn named(node: &NodeRef, names: &[&str]) -> bool {
    node.qual_name_ref()
        .is_some_and(|name| names.contains(&name.local.as_ref()))
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
}
