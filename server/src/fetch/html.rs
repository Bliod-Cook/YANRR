use dom_query::{Document, NodeRef};
use reqwest::Url;

use super::parse::{Media, MediaKind};

/// Images and videos embedded in an HTML fragment, with URLs resolved against `base`.
pub fn media(html: &str, base: Option<&Url>) -> Vec<Media> {
    Document::fragment(html)
        .select("img, video")
        .nodes()
        .iter()
        .filter_map(|element| embedded(element, base))
        .collect()
}

fn embedded(element: &NodeRef, base: Option<&Url>) -> Option<Media> {
    let attr = |name| {
        element
            .attr(name)
            .and_then(|href| super::parse::resolve(base, &href))
    };
    let size = |name| element.attr(name).and_then(|value| value.parse().ok());
    if element.has_name("img") {
        return Some(Media {
            url: attr("src")?,
            kind: MediaKind::Photo,
            preview_image_url: None,
            width: size("width"),
            height: size("height"),
        });
    }
    let source = element
        .descendants_it()
        .find(|node| node.has_name("source") && node.has_attr("src"))
        .and_then(|source| source.attr("src"));
    Some(Media {
        url: attr("src").or_else(|| super::parse::resolve(base, &source?))?,
        kind: MediaKind::Video,
        preview_image_url: attr("poster"),
        width: size("width"),
        height: size("height"),
    })
}

const FEED_TYPES: [&str; 4] = [
    "application/rss+xml",
    "application/atom+xml",
    "application/feed+json",
    "application/json",
];

/// Feeds a web page announces with `<link rel="alternate">`, resolved against `base`.
pub fn feed_links(html: &str, base: &Url) -> Vec<String> {
    Document::from(html)
        .select(r#"link[rel~="alternate"][href][type]"#)
        .nodes()
        .iter()
        .filter(|link| {
            let kind = link.attr("type").unwrap_or_default();
            FEED_TYPES.contains(&kind.trim().to_ascii_lowercase().as_str())
        })
        .filter_map(|link| super::parse::resolve(Some(base), &link.attr("href")?))
        .collect()
}
