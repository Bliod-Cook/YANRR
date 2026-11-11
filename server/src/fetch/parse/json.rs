use chrono::{DateTime, Utc};
use reqwest::Url;
use serde::Deserialize;
use serde_json::Value;

use super::{Attachment, Author, Draft, Entries, Media, MediaKind, ParsedFeed, resolve};

/// JSON Feed 1.0/1.1 plus RSSHub's `_extra`; feed-rs drops avatars, item images, durations and `_extra`.
#[derive(Deserialize)]
struct JsonFeed {
    version: String,
    title: Option<String>,
    home_page_url: Option<String>,
    description: Option<String>,
    icon: Option<String>,
    favicon: Option<String>,
    language: Option<String>,
    /// Read one by one, so that an item that does not fit is skipped rather than failing the feed.
    #[serde(default)]
    items: Vec<Value>,
}

#[derive(Deserialize)]
struct Item {
    id: Option<Value>,
    url: Option<String>,
    title: Option<String>,
    content_html: Option<String>,
    content_text: Option<String>,
    summary: Option<String>,
    image: Option<String>,
    date_published: Option<String>,
    date_modified: Option<String>,
    #[serde(default)]
    authors: Vec<JsonAuthor>,
    author: Option<JsonAuthor>,
    #[serde(default)]
    tags: Vec<String>,
    language: Option<String>,
    #[serde(default)]
    attachments: Vec<JsonAttachment>,
    #[serde(rename = "_extra")]
    extra: Option<Value>,
}

#[derive(Deserialize)]
struct JsonAuthor {
    name: Option<String>,
    url: Option<String>,
    avatar: Option<String>,
}

#[derive(Deserialize)]
struct JsonAttachment {
    url: String,
    mime_type: Option<String>,
    title: Option<String>,
    size_in_bytes: Option<Value>,
    duration_in_seconds: Option<Value>,
}

pub fn parse(body: &[u8], url: &str) -> Result<ParsedFeed, String> {
    let mut feed: Value = serde_json::from_slice(body).map_err(|err| err.to_string())?;
    strip_nul(&mut feed);
    let feed: JsonFeed = serde_json::from_value(feed).map_err(|err| err.to_string())?;
    if !feed.version.starts_with("https://jsonfeed.org/version/") {
        return Err("Not a JSON Feed".into());
    }
    let feed_url = Url::parse(url).ok();
    let site_url = feed
        .home_page_url
        .and_then(|href| resolve(feed_url.as_ref(), &href));
    let base = site_url
        .as_deref()
        .and_then(|url| Url::parse(url).ok())
        .or(feed_url);
    let image = feed.icon.or(feed.favicon);
    let image = image.and_then(|href| resolve(base.as_ref(), &href));
    let language = feed.language;
    let items = feed.items.into_iter();
    let drafts = items.filter_map(|item| serde_json::from_value(item).ok().map(draft));
    Ok(ParsedFeed {
        title: feed.title,
        description: feed.description,
        image,
        site_url,
        language: language.clone(),
        ttl: None,
        entries: Entries::new(drafts, base, language),
    })
}

/// Drops the NUL characters of every string, which PostgreSQL text cannot hold.
fn strip_nul(value: &mut Value) {
    match value {
        Value::String(text) => text.retain(|char| char != '\0'),
        Value::Array(items) => items.iter_mut().for_each(strip_nul),
        Value::Object(fields) => fields.values_mut().for_each(strip_nul),
        _ => {}
    }
}

fn draft(item: Item) -> Draft {
    let mut draft = Draft {
        guid: match item.id {
            Some(Value::String(id)) => id,
            Some(Value::Number(id)) => id.to_string(),
            _ => String::new(),
        },
        title: item.title,
        url: item.url,
        summary: item.summary,
        content: item.content_html.or(item.content_text),
        authors: item
            .authors
            .into_iter()
            .chain(item.author)
            .map(|author| Author {
                name: author.name,
                url: author.url,
                avatar: author.avatar,
            })
            .collect(),
        categories: item.tags,
        extra: item
            .extra
            .and_then(|extra| serde_json::from_value(extra).ok()),
        language: item.language,
        published: item.date_published.or(item.date_modified).and_then(|date| {
            DateTime::parse_from_rfc3339(&date)
                .ok()
                .map(|date| date.with_timezone(&Utc))
        }),
        ..Draft::default()
    };
    if let Some(url) = item.image {
        draft.media.push(Media {
            url,
            kind: MediaKind::Photo,
            preview_image_url: None,
            width: None,
            height: None,
        });
    }
    for attachment in item.attachments {
        let attachment = Attachment {
            url: attachment.url,
            mime_type: attachment.mime_type,
            size_in_bytes: number(attachment.size_in_bytes),
            duration_in_seconds: number(attachment.duration_in_seconds),
            title: attachment.title,
        };
        draft.add_file(attachment, None, None);
    }
    draft
}

/// RSSHub may write sizes and durations as strings.
fn number(value: Option<Value>) -> Option<u64> {
    match value? {
        Value::Number(number) => number.as_f64().map(|number| number as u64),
        Value::String(text) => text.parse::<f64>().ok().map(|number| number as u64),
        _ => None,
    }
}
