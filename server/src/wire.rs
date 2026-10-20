//! Feeds, entries and subscriptions as API responses and change log data show them.

use serde::Serialize;
use serde_json::Value;

use crate::{
    entity::{entry, feed, subscription},
    time::iso,
};

/// `FeedModel` plus the `type` of `FeedOpenApiSchema`, so one shape serves both.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Feed {
    #[serde(rename = "type")]
    kind: &'static str,
    id: String,
    url: String,
    title: Option<String>,
    description: Option<String>,
    image: Option<String>,
    site_url: Option<String>,
    language: Option<String>,
    error_message: Option<String>,
    error_at: Option<String>,
    checked_at: String,
    refresh_enqueued_at: Option<String>,
    etag_header: Option<String>,
    last_modified_header: Option<String>,
    ttl: Option<i32>,
    migrate_to: Option<String>,
    // Feed claiming, RSSHub route analytics and NSFW flags are not kept: always null.
    owner_user_id: (),
    rsshub_route: (),
    rsshub_namespace: (),
    nsfw: (),
}

impl From<&feed::Model> for Feed {
    fn from(feed: &feed::Model) -> Self {
        Self {
            kind: "feed",
            id: feed.id.to_string(),
            url: feed.url.clone(),
            title: feed.title.clone(),
            description: feed.description.clone(),
            image: feed.image.clone(),
            site_url: feed.site_url.clone(),
            language: feed.language.clone(),
            error_message: feed.error_message.clone(),
            error_at: feed.error_at.map(iso),
            checked_at: iso(feed.checked_at),
            refresh_enqueued_at: feed.refresh_enqueued_at.map(iso),
            etag_header: feed.etag_header.clone(),
            last_modified_header: feed.last_modified_header.clone(),
            ttl: feed.ttl,
            migrate_to: feed.migrate_to.map(|id| id.to_string()),
            owner_user_id: (),
            rsshub_route: (),
            rsshub_namespace: (),
            nsfw: (),
        }
    }
}

/// `EntryWithoutContent`, with the content when asked for.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    id: String,
    guid: String,
    title: Option<String>,
    url: Option<String>,
    description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    content: Option<Option<String>>,
    /// AI summaries are not stored.
    summary: (),
    author: Option<String>,
    author_url: Option<String>,
    author_avatar: Option<String>,
    categories: Option<Vec<String>>,
    media: Option<Value>,
    attachments: Option<Value>,
    extra: Option<Value>,
    language: Option<String>,
    published_at: String,
    inserted_at: String,
}

impl Entry {
    pub fn new(entry: entry::Model, with_content: bool) -> Self {
        Self {
            id: entry.id.to_string(),
            guid: entry.guid,
            title: entry.title,
            url: entry.url,
            description: entry.description,
            content: with_content.then_some(entry.content),
            summary: (),
            author: entry.author,
            author_url: entry.author_url,
            author_avatar: entry.author_avatar,
            categories: entry.categories,
            media: entry.media,
            attachments: entry.attachments,
            extra: entry.extra,
            language: entry.language,
            published_at: iso(entry.published_at),
            inserted_at: iso(entry.inserted_at),
        }
    }
}

/// An item of `GET /subscriptions`. Clients tell subscription types apart by which of `feeds`, `lists` or
/// `inboxes` is present, so only `feeds` is ever written.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Subscription {
    feeds: Feed,
    feed_id: String,
    user_id: String,
    view: i16,
    category: Option<String>,
    title: Option<String>,
    hide_from_timeline: Option<bool>,
    /// Private subscriptions are not supported.
    is_private: bool,
    created_at: String,
}

impl Subscription {
    pub fn new(subscription: subscription::Model, feed: &feed::Model) -> Self {
        Self {
            feeds: feed.into(),
            feed_id: subscription.feed_id.to_string(),
            user_id: subscription.user_id,
            view: subscription.view,
            category: subscription.category,
            title: subscription.title,
            hide_from_timeline: subscription.hide_from_timeline,
            is_private: false,
            created_at: iso(subscription.created_at),
        }
    }
}
