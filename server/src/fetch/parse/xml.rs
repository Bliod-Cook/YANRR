use std::time::Duration;

use feed_rs::{
    model::{Entry, Link, MediaObject, Text},
    parser,
};
use reqwest::Url;

use super::{Attachment, Author, Draft, Media, MediaKind, ParsedFeed, finish_all, html, resolve};

pub fn parse(body: &[u8], url: &str) -> Result<ParsedFeed, String> {
    // Empty ids are filled in by `Draft::finish`; feed-rs would fall back to a random UUID.
    let feed = parser::Builder::new()
        .id_generator(|_, _, _| String::new())
        .build()
        .parse(body)
        .map_err(|err| err.to_string())?;

    let feed_url = Url::parse(url).ok();
    let site_url = alternate(&feed.links).and_then(|href| resolve(feed_url.as_ref(), href));
    let base = site_url
        .as_deref()
        .and_then(|url| Url::parse(url).ok())
        .or(feed_url);
    let language = feed.language;
    let drafts = feed.entries.into_iter().map(draft);
    let entries = finish_all(drafts, base.as_ref(), language.as_deref());
    Ok(ParsedFeed {
        title: feed.title.map(plain),
        description: feed.description.map(plain),
        image: feed.logo.or(feed.icon).map(|image| image.uri),
        site_url,
        language,
        ttl: feed.ttl.and_then(|ttl| ttl.try_into().ok()),
        entries,
    })
}

fn draft(entry: Entry) -> Draft {
    // feed-rs keeps <itunes:duration> apart from <enclosure> unless MediaRSS is present.
    let duration = entry.media.iter().find_map(|object| object.duration);
    let mut draft = Draft {
        guid: entry.id,
        title: entry.title.map(plain),
        url: alternate(&entry.links).map(String::from),
        summary: entry.summary.map(|summary| summary.content),
        content: entry.content.and_then(|content| content.body),
        authors: entry
            .authors
            .into_iter()
            .map(|person| Author {
                name: person.name,
                url: person.uri,
                avatar: None,
            })
            .collect(),
        categories: entry
            .categories
            .into_iter()
            .map(|category| category.label.unwrap_or(category.term))
            .collect(),
        language: entry.language,
        published: entry.published.or(entry.updated),
        ..Draft::default()
    };
    for object in entry.media {
        add_media_object(&mut draft, object, duration);
    }
    draft
}

/// Adds a MediaRSS / enclosure / iTunes object; its thumbnail previews a video or stands alone as a photo.
fn add_media_object(draft: &mut Draft, object: MediaObject, entry_duration: Option<Duration>) {
    let title = object.title.map(plain);
    let start = draft.media.len();
    for content in object.content {
        let Some(url) = content.url else { continue };
        let attachment = Attachment {
            url: url.into(),
            mime_type: content.content_type.map(|mime| mime.to_string()),
            size_in_bytes: content.size,
            duration_in_seconds: content
                .duration
                .or(object.duration)
                .or(entry_duration)
                .map(|duration| duration.as_secs()),
            title: title.clone(),
        };
        draft.add_file(attachment, content.width, content.height);
    }

    let thumbnails = object
        .thumbnails
        .into_iter()
        .map(|thumbnail| thumbnail.image);
    let mut videos = draft.media[start..]
        .iter_mut()
        .filter(|media| media.kind == MediaKind::Video)
        .peekable();
    if videos.peek().is_none() {
        draft.media.extend(thumbnails.map(|image| Media {
            url: image.uri,
            kind: MediaKind::Photo,
            preview_image_url: None,
            width: image.width,
            height: image.height,
        }));
    } else if let Some(preview) = thumbnails.map(|image| image.uri).next() {
        videos.for_each(|video| video.preview_image_url = Some(preview.clone()));
    }
}

fn alternate(links: &[Link]) -> Option<&str> {
    links
        .iter()
        .find(|link| link.rel.as_deref().is_none_or(|rel| rel == "alternate"))
        .map(|link| link.href.as_str())
}

fn plain(text: Text) -> String {
    if text.content_type.subty().as_str().contains("html") {
        html::text(&text.content)
    } else {
        text.content
    }
}
