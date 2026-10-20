use std::sync::LazyLock;

use reqwest::Url;
use scraper::{ElementRef, Html, Selector};

use super::parse::{Media, MediaKind};

static EMBEDDED: LazyLock<Selector> = LazyLock::new(|| Selector::parse("img, video").unwrap());
static SOURCE: LazyLock<Selector> = LazyLock::new(|| Selector::parse("source[src]").unwrap());

/// Text of an HTML fragment with whitespace collapsed.
pub fn text(html: &str) -> String {
    let fragment = Html::parse_fragment(html);
    let words: Vec<_> = fragment
        .root_element()
        .text()
        .flat_map(str::split_whitespace)
        .collect();
    words.join(" ")
}

/// Images and videos embedded in an HTML fragment, with URLs resolved against `base`.
pub fn media(html: &str, base: Option<&Url>) -> Vec<Media> {
    let fragment = Html::parse_fragment(html);
    fragment
        .select(&EMBEDDED)
        .filter_map(|element| embedded(element, base))
        .collect()
}

fn embedded(element: ElementRef, base: Option<&Url>) -> Option<Media> {
    let attr = |name| {
        element
            .value()
            .attr(name)
            .and_then(|href| super::parse::resolve(base, href))
    };
    let size = |name| {
        element
            .value()
            .attr(name)
            .and_then(|value| value.parse().ok())
    };
    if element.value().name() == "img" {
        return Some(Media {
            url: attr("src")?,
            kind: MediaKind::Photo,
            preview_image_url: None,
            width: size("width"),
            height: size("height"),
        });
    }
    let source = element
        .select(&SOURCE)
        .next()
        .and_then(|source| source.value().attr("src"));
    Some(Media {
        url: attr("src").or_else(|| super::parse::resolve(base, source?))?,
        kind: MediaKind::Video,
        preview_image_url: attr("poster"),
        width: size("width"),
        height: size("height"),
    })
}

static FEED_LINKS: LazyLock<Selector> =
    LazyLock::new(|| Selector::parse(r#"link[rel~="alternate"][href][type]"#).unwrap());
const FEED_TYPES: [&str; 4] = [
    "application/rss+xml",
    "application/atom+xml",
    "application/feed+json",
    "application/json",
];

/// Feeds a web page announces with `<link rel="alternate">`, resolved against `base`.
pub fn feed_links(html: &str, base: &Url) -> Vec<String> {
    Html::parse_document(html)
        .select(&FEED_LINKS)
        .filter(|link| {
            let kind = link.value().attr("type").unwrap_or_default();
            FEED_TYPES.contains(&kind.trim().to_ascii_lowercase().as_str())
        })
        .filter_map(|link| super::parse::resolve(Some(base), link.value().attr("href")?))
        .collect()
}
