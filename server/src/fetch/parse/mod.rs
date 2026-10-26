mod json;
mod xml;

use chrono::{DateTime, TimeDelta, Utc};
use reqwest::Url;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::{html, language};

const DESCRIPTION_LENGTH: usize = 300;

pub struct ParsedFeed {
    pub title: Option<String>,
    pub description: Option<String>,
    pub image: Option<String>,
    pub site_url: Option<String>,
    pub language: Option<String>,
    pub ttl: Option<i32>,
    pub entries: Vec<ParsedEntry>,
}

#[derive(Debug)]
pub struct ParsedEntry {
    pub guid: String,
    pub title: Option<String>,
    pub url: Option<String>,
    pub description: Option<String>,
    pub content: Option<String>,
    pub author: Option<String>,
    pub author_url: Option<String>,
    pub author_avatar: Option<String>,
    pub categories: Vec<String>,
    pub media: Vec<Media>,
    pub attachments: Vec<Attachment>,
    pub extra: Option<Extra>,
    pub language: Option<String>,
    pub published_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Media {
    pub url: String,
    #[serde(rename = "type")]
    pub kind: MediaKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview_image_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MediaKind {
    Photo,
    Video,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Attachment {
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size_in_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_in_seconds: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Extra {
    pub links: Vec<EntryLink>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EntryLink {
    pub url: String,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_html: Option<String>,
}

/// The start of an HTML summary's text, or `None` if it has none.
pub fn describe(html: &str) -> Option<String> {
    let text = html::text(html);
    (!text.is_empty()).then(|| text.chars().take(DESCRIPTION_LENGTH).collect())
}

/// Parses RSS, Atom or JSON Feed; `url` resolves relative links.
pub fn parse(body: &[u8], url: &str) -> Result<ParsedFeed, String> {
    let is_json = body.iter().find(|byte| !byte.is_ascii_whitespace()) == Some(&b'{');
    if is_json {
        json::parse(body, url)
    } else {
        xml::parse(body, url)
    }
}

/// Finishes a feed's entries in the order the feed lists them, newest first: each may be dated a millisecond
/// earlier than the one before at the latest, so that undated entries keep that order.
fn finish_all(
    drafts: impl Iterator<Item = Draft>,
    base: Option<&Url>,
    feed_language: Option<&str>,
) -> Vec<ParsedEntry> {
    let now = Utc::now();
    drafts
        .enumerate()
        .map(|(index, draft)| {
            let latest = now - TimeDelta::milliseconds(index as i64);
            draft.finish(base, feed_language, latest)
        })
        .collect()
}

/// Entry fields as a format provides them, before the shared normalization in [`Draft::finish`].
#[derive(Default)]
struct Draft {
    guid: String,
    title: Option<String>,
    url: Option<String>,
    summary: Option<String>,
    content: Option<String>,
    authors: Vec<Author>,
    categories: Vec<String>,
    media: Vec<Media>,
    attachments: Vec<Attachment>,
    extra: Option<Extra>,
    language: Option<String>,
    published: Option<DateTime<Utc>>,
}

#[derive(Default)]
struct Author {
    name: Option<String>,
    url: Option<String>,
    avatar: Option<String>,
}

impl Draft {
    /// Files with an image or video MIME type become media, everything else an attachment.
    fn add_file(&mut self, attachment: Attachment, width: Option<u32>, height: Option<u32>) {
        let kind = match attachment
            .mime_type
            .as_deref()
            .and_then(|mime| mime.split('/').next())
        {
            Some("image") => MediaKind::Photo,
            Some("video") => MediaKind::Video,
            _ => return self.attachments.push(attachment),
        };
        let url = attachment.url;
        self.media.push(Media {
            url,
            kind,
            preview_image_url: None,
            width,
            height,
        });
    }

    fn finish(
        self,
        base: Option<&Url>,
        feed_language: Option<&str>,
        latest: DateTime<Utc>,
    ) -> ParsedEntry {
        let url = self.url.and_then(|url| resolve(base, &url));
        let content = self.content.or_else(|| self.summary.clone());
        let description = self
            .summary
            .as_deref()
            .or(content.as_deref())
            .and_then(describe);

        let mut media = self.media;
        if let Some(content) = &content {
            let page = url.as_deref().and_then(|url| Url::parse(url).ok());
            media.extend(html::media(content, page.as_ref().or(base)));
        }
        let mut seen = std::collections::HashSet::new();
        media.retain(|item| seen.insert(item.url.clone()));

        let language = self.language.or_else(|| {
            let text = [self.title.as_deref(), description.as_deref()]
                .into_iter()
                .flatten();
            language::detect(&text.collect::<Vec<_>>().join(" "))
        });

        let guid = Some(self.guid.trim().to_string())
            .filter(|guid| !guid.is_empty())
            .or_else(|| url.clone())
            .or_else(|| self.title.clone())
            .unwrap_or_else(|| {
                format!(
                    "{:x}",
                    Sha256::digest(content.as_deref().unwrap_or_default())
                )
            });

        let names: Vec<_> = self
            .authors
            .iter()
            .filter_map(|author| author.name.as_deref())
            .collect();
        ParsedEntry {
            guid,
            title: self.title,
            url,
            description,
            content,
            author: (!names.is_empty()).then(|| names.join(", ")),
            author_url: self.authors.iter().find_map(|author| author.url.clone()),
            author_avatar: self.authors.iter().find_map(|author| author.avatar.clone()),
            categories: self.categories,
            media,
            attachments: self.attachments,
            extra: self.extra,
            language: language.or_else(|| feed_language.map(String::from)),
            // A future date would pin the entry to the top of every timeline.
            published_at: self
                .published
                .map_or(latest, |published| published.min(latest)),
        }
    }
}

/// Absolute http(s) URL for `href`, resolved against `base` when relative.
pub(super) fn resolve(base: Option<&Url>, href: &str) -> Option<String> {
    let url = match base {
        Some(base) => base.join(href).ok()?,
        None => Url::parse(href).ok()?,
    };
    matches!(url.scheme(), "http" | "https").then(|| url.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> Vec<u8> {
        std::fs::read(format!(
            "{}/tests/fixtures/{name}",
            env!("CARGO_MANIFEST_DIR")
        ))
        .unwrap()
    }

    fn photo(url: &str, width: Option<u32>, height: Option<u32>) -> Media {
        Media {
            url: url.into(),
            kind: MediaKind::Photo,
            preview_image_url: None,
            width,
            height,
        }
    }

    #[test]
    fn parses_rss2() {
        let feed = parse(&fixture("rss2.xml"), "https://example.com/feed.xml").unwrap();

        assert_eq!(feed.title.as_deref(), Some("Example Blog"));
        assert_eq!(feed.site_url.as_deref(), Some("https://example.com/"));
        assert_eq!(feed.image.as_deref(), Some("https://example.com/logo.png"));
        assert_eq!(feed.language.as_deref(), Some("en"));
        assert_eq!(feed.ttl, Some(30));

        let [first, second] = &feed.entries[..] else {
            panic!("expected two entries")
        };
        assert_eq!(first.guid, "post-1");
        assert_eq!(first.url.as_deref(), Some("https://example.com/posts/1"));
        assert_eq!(first.author.as_deref(), Some("Alice"));
        assert_eq!(first.categories, ["Tech", "Rust"]);
        assert_eq!(
            first.description.as_deref(),
            Some("A short summary of the first post.")
        );
        assert!(
            first
                .content
                .as_deref()
                .unwrap()
                .contains("rebuilt our reader")
        );
        assert_eq!(first.published_at.to_rfc3339(), "2026-10-05T08:00:00+00:00");
        assert_eq!(first.language.as_deref(), Some("en"));
        assert_eq!(
            first.attachments,
            [Attachment {
                url: "https://example.com/episode.mp3".into(),
                mime_type: Some("audio/mpeg".into()),
                size_in_bytes: Some(12345),
                duration_in_seconds: Some(3723),
                title: None,
            }]
        );
        assert_eq!(
            first.media,
            [
                photo("https://example.com/cover.jpg", None, None),
                photo(
                    "https://example.com/images/diagram.png",
                    Some(640),
                    Some(480)
                ),
                Media {
                    url: "https://example.com/clip.mp4".into(),
                    kind: MediaKind::Video,
                    preview_image_url: Some("https://example.com/clip.jpg".into()),
                    width: None,
                    height: None,
                },
            ]
        );

        assert_eq!(second.guid, "https://example.com/posts/2");
        // Detected from the text rather than taken from the feed's "en".
        assert_eq!(second.language.as_deref(), Some("zh"));
    }

    #[test]
    fn parses_atom() {
        let feed = parse(
            &fixture("atom.xml"),
            "https://journal.example.org/feed.atom",
        )
        .unwrap();

        assert_eq!(
            feed.site_url.as_deref(),
            Some("https://journal.example.org/")
        );
        let entry = &feed.entries[0];
        assert_eq!(entry.guid, "urn:uuid:1225c695-cfb8-4ebb-aaaa-80da344efa6a");
        assert_eq!(
            entry.url.as_deref(),
            Some("https://journal.example.org/articles/un-article")
        );
        assert_eq!(entry.author.as_deref(), Some("Camille"));
        assert_eq!(
            entry.author_url.as_deref(),
            Some("https://journal.example.org/camille")
        );
        assert_eq!(entry.description.as_deref(), Some("Bonjour tout le monde."));
        assert_eq!(entry.language.as_deref(), Some("fr"));
        assert_eq!(entry.published_at.to_rfc3339(), "2026-10-01T18:30:02+00:00");
    }

    #[test]
    fn parses_json_feed() {
        let feed = parse(
            &fixture("feed.json"),
            "https://social.example.net/alice.json",
        )
        .unwrap();

        assert_eq!(feed.title.as_deref(), Some("Social Timeline"));
        assert_eq!(
            feed.site_url.as_deref(),
            Some("https://social.example.net/alice")
        );
        assert_eq!(
            feed.image.as_deref(),
            Some("https://social.example.net/alice.png")
        );
        assert_eq!(feed.language.as_deref(), Some("zh-cn"));

        let entry = &feed.entries[0];
        assert_eq!(entry.guid, "status-42");
        assert_eq!(entry.author.as_deref(), Some("Alice"));
        assert_eq!(
            entry.author_url.as_deref(),
            Some("https://social.example.net/alice")
        );
        assert_eq!(
            entry.author_avatar.as_deref(),
            Some("https://social.example.net/alice.png")
        );
        assert_eq!(entry.categories, ["photos", "hiking"]);
        // RSSHub declares "zh-cn" for every feed, so the detected language wins.
        assert_eq!(entry.language.as_deref(), Some("en"));
        assert_eq!(
            entry.media,
            [
                photo("https://social.example.net/media/cover.jpg", None, None),
                photo("https://social.example.net/media/1.jpg", None, None),
            ]
        );
        assert_eq!(
            entry.attachments,
            [Attachment {
                url: "https://social.example.net/media/voice.m4a".into(),
                mime_type: Some("audio/mp4".into()),
                size_in_bytes: Some(2048),
                duration_in_seconds: Some(95),
                title: Some("Voice note".into()),
            }]
        );
        assert_eq!(
            entry.extra,
            Some(Extra {
                links: vec![EntryLink {
                    url: "https://social.example.net/bob/7".into(),
                    kind: "quote".into(),
                    content_html: Some("<p>Quoted post</p>".into()),
                }],
            })
        );
    }

    #[test]
    fn missing_guid_is_stable() {
        let xml = br#"<rss version="2.0"><channel><title>t</title>
            <item><title>Only a title</title></item>
            <item><description>Only some text</description></item>
        </channel></rss>"#;
        let parse_guids = || {
            let feed = parse(xml, "https://example.com/feed.xml").unwrap();
            feed.entries
                .into_iter()
                .map(|entry| entry.guid)
                .collect::<Vec<_>>()
        };

        let guids = parse_guids();

        assert_eq!(guids[0], "Only a title");
        assert!(!guids[1].is_empty());
        assert_eq!(guids, parse_guids());
    }

    #[test]
    fn undated_entries_keep_feed_order() {
        let xml = br#"<rss version="2.0"><channel><title>t</title>
            <item><guid>newer</guid></item>
            <item><guid>older</guid></item>
        </channel></rss>"#;

        let feed = parse(xml, "https://example.com/feed.xml").unwrap();

        let [newer, older] = &feed.entries[..] else {
            panic!("expected two entries")
        };
        assert_eq!(
            newer.published_at - older.published_at,
            TimeDelta::milliseconds(1)
        );
    }
}
