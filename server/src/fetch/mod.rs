pub(crate) mod html;
pub(crate) mod http;
pub(crate) mod language;
pub mod parse;
pub mod readability;
pub mod scheduler;

use chrono::{DateTime, SubsecRound, Utc};
use reqwest::Url;
use sea_orm::{
    ActiveModelTrait,
    ActiveValue::{Set, Unchanged},
    ColumnTrait, ConnectionTrait, DbErr, EntityTrait, PaginatorTrait, QueryFilter,
    TransactionTrait,
    prelude::Json,
    sea_query::OnConflict,
};
use serde::Serialize;
use serde_json::json;

use self::{
    http::Validators,
    parse::{ParsedEntry, ParsedFeed},
};
use crate::{
    AppState,
    entity::{blocked_entry, collection, entry, feed, subscription, unread},
    id::next_id,
    rules::{
        Rules, Subject,
        deliver::{self, Delivery},
    },
    subscription as subscriptions,
    sync::{self, Action},
    time::iso,
};

pub use self::http::client as http_client;

#[derive(Debug)]
pub enum FetchError {
    Fetch(String),
    Parse(String),
    Db(DbErr),
}

impl From<DbErr> for FetchError {
    fn from(err: DbErr) -> Self {
        Self::Db(err)
    }
}

/// Returns the feed at `url`, fetching and storing it first if it is new.
pub async fn add_feed(state: &AppState, url: &str) -> Result<feed::Model, FetchError> {
    let existing = feed::Entity::find().filter(feed::Column::Url.eq(url));
    if let Some(feed) = existing.one(&state.db).await? {
        return freshen(state, feed).await;
    }
    let update = fetch(state, url, &Validators::default())
        .await?
        .ok_or(FetchError::Fetch("HTTP 304".into()))?;
    insert(state, url, update).await
}

/// Feeds found at `keyword`: the feed it addresses, or those the web page there links to. Only addresses are
/// understood, so anything else finds nothing.
pub async fn discover(state: &AppState, keyword: &str) -> Result<Vec<feed::Model>, FetchError> {
    let keyword = keyword.trim();
    if keyword.starts_with("rsshub://") {
        return Ok(vec![add_feed(state, keyword).await?]);
    }
    let address = if keyword.contains("://") {
        keyword.to_string()
    } else {
        format!("https://{keyword}")
    };
    let Some(url) = Url::parse(&address).ok().filter(|url| {
        matches!(url.scheme(), "http" | "https")
            && url.host_str().is_some_and(|host| host.contains('.'))
    }) else {
        return Ok(Vec::new());
    };
    let url = url.to_string();
    if let Some(feed) = feed::Entity::find()
        .filter(feed::Column::Url.eq(&url))
        .one(&state.db)
        .await?
    {
        return Ok(vec![freshen(state, feed).await?]);
    }
    let fetched = http::get(&state.http, &url, &Validators::default())
        .await
        .map_err(FetchError::Fetch)?
        .ok_or(FetchError::Fetch("HTTP 304".into()))?;
    if let Ok(parsed) = parse::parse(&fetched.body, &url) {
        let update = Update {
            feed: parsed,
            validators: fetched.validators,
            moved_to: fetched.moved_to,
        };
        return Ok(vec![insert(state, &url, update).await?]);
    }
    let page = Url::parse(fetched.moved_to.as_deref().unwrap_or(&url)).expect("fetched URL");
    let mut feeds: Vec<feed::Model> = Vec::new();
    for link in html::feed_links(&String::from_utf8_lossy(&fetched.body), &page) {
        match add_feed(state, &link).await {
            Ok(feed) if feeds.iter().all(|found| found.id != feed.id) => feeds.push(feed),
            Ok(_) => {}
            Err(err) => tracing::debug!("discovered feed {link} failed: {err:?}"),
        }
    }
    Ok(feeds)
}

/// Refreshes a feed nobody follows, which the scheduler leaves alone, so whoever looks at it sees recent entries.
async fn freshen(state: &AppState, feed: feed::Model) -> Result<feed::Model, FetchError> {
    let followers = subscription::Entity::find()
        .filter(subscription::Column::FeedId.eq(feed.id))
        .count(&state.db)
        .await?;
    if followers > 0 {
        return Ok(feed);
    }
    // A failure is recorded on the feed; what was stored before is still worth showing.
    if let Err(err) = refresh_feed(state, feed.id).await {
        tracing::warn!(feed = feed.id, "refresh failed: {err:?}");
    }
    Ok(feed::Entity::find_by_id(feed.id)
        .one(&state.db)
        .await?
        .unwrap_or(feed))
}

/// Stores a feed fetched from `url` for the first time.
async fn insert(state: &AppState, url: &str, update: Update) -> Result<feed::Model, FetchError> {
    let txn = state.db.begin().await?;
    let feed = find_or_create(&txn, update.moved_to.as_deref().unwrap_or(url)).await?;
    let stored = store(&txn, feed.id, update).await?;
    sync::record(&txn, stored.actions).await?;
    txn.commit().await?;
    deliver::spawn(state, &stored.feed, stored.deliveries);
    Ok(stored.feed)
}

/// Fetches a feed again, recording the error on failure; `error_at` keeps when the failures began.
pub async fn refresh_feed(state: &AppState, feed_id: i64) -> Result<(), FetchError> {
    let feed = feed::Entity::find_by_id(feed_id)
        .one(&state.db)
        .await?
        .ok_or_else(|| DbErr::RecordNotFound(format!("feed {feed_id}")))?;
    let result = refresh(state, &feed).await;
    if let Err(FetchError::Fetch(message) | FetchError::Parse(message)) = &result {
        let now = Utc::now();
        feed::ActiveModel {
            id: Unchanged(feed.id),
            checked_at: Set(now),
            error_message: Set(Some(message.clone())),
            error_at: Set(feed.error_at.or(Some(now))),
            ..Default::default()
        }
        .update(&state.db)
        .await?;
    }
    result
}

async fn refresh(state: &AppState, feed: &feed::Model) -> Result<(), FetchError> {
    let validators = Validators {
        etag: feed.etag_header.clone(),
        last_modified: feed.last_modified_header.clone(),
    };
    let Some(update) = fetch(state, &feed.url, &validators).await? else {
        checked(feed.id).update(&state.db).await?;
        return Ok(());
    };
    let txn = state.db.begin().await?;
    let target = match update.moved_to.as_deref() {
        Some(url) => {
            let found = find_or_create(&txn, url).await?;
            // Addresses redirecting to each other lead back here; that is no move.
            subscriptions::resolve(&txn, found.id)
                .await?
                .filter(|target| target.id != feed.id)
        }
        None => None,
    };
    let stored = match target {
        None => store(&txn, feed.id, update).await?,
        Some(target) => {
            let mut stored = store(&txn, target.id, update).await?;
            let migrated = feed::ActiveModel {
                migrate_to: Set(Some(target.id)),
                ..checked(feed.id)
            };
            migrated.update(&txn).await?;
            let moved = subscriptions::migrate(&txn, feed.id, &stored.feed).await?;
            stored.actions.extend(moved);
            stored
        }
    };
    sync::record(&txn, stored.actions).await?;
    txn.commit().await?;
    deliver::spawn(state, &stored.feed, stored.deliveries);
    Ok(())
}

/// A fetched and parsed feed.
struct Update {
    feed: ParsedFeed,
    validators: Validators,
    /// Where the feed permanently moved to; never set for `rsshub://` feeds, whose instance may change.
    moved_to: Option<String>,
}

/// Fetches and parses the feed at `url`; `None` means not modified.
async fn fetch(
    state: &AppState,
    url: &str,
    validators: &Validators,
) -> Result<Option<Update>, FetchError> {
    let source = source_url(&state.config.rsshub.url, url);
    let fetched = http::get(&state.http, &source, validators)
        .await
        .map_err(FetchError::Fetch)?;
    let Some(fetched) = fetched else {
        return Ok(None);
    };
    let feed = parse::parse(&fetched.body, &source).map_err(FetchError::Parse)?;
    let moved_to = fetched.moved_to.filter(|_| !url.starts_with("rsshub://"));
    Ok(Some(Update {
        feed,
        validators: fetched.validators,
        moved_to,
    }))
}

/// Points `rsshub://` at the configured instance, asking for JSON Feed: only it carries avatars,
/// attachment durations and `_extra`.
fn source_url(instance: &str, url: &str) -> String {
    let Some(route) = url.strip_prefix("rsshub://") else {
        return url.into();
    };
    let separator = if route.contains('?') { '&' } else { '?' };
    format!(
        "{}/{route}{separator}format=json",
        instance.trim_end_matches('/')
    )
}

/// A successful check: clears the last error.
fn checked(feed_id: i64) -> feed::ActiveModel {
    feed::ActiveModel {
        id: Unchanged(feed_id),
        checked_at: Set(Utc::now()),
        error_message: Set(None),
        error_at: Set(None),
        ..Default::default()
    }
}

async fn find_or_create(db: &impl ConnectionTrait, url: &str) -> Result<feed::Model, DbErr> {
    let feed = feed::ActiveModel {
        id: Set(next_id()),
        url: Set(url.into()),
        checked_at: Set(Utc::now()),
        ..Default::default()
    };
    feed::Entity::insert(feed)
        .on_conflict(
            OnConflict::column(feed::Column::Url)
                .do_nothing()
                .to_owned(),
        )
        .exec_without_returning(db)
        .await?;
    feed::Entity::find()
        .filter(feed::Column::Url.eq(url))
        .one(db)
        .await?
        .ok_or_else(|| DbErr::RecordNotFound(url.into()))
}

/// What storing a fetched feed did: the actions to record, and what to deliver once they are committed.
struct Stored {
    feed: feed::Model,
    actions: Vec<Action>,
    deliveries: Vec<Delivery>,
}

/// Writes the feed's metadata and new entries, and hands the entries to its subscribers; run it in the caller's
/// transaction, which records the actions.
async fn store(db: &impl ConnectionTrait, feed_id: i64, update: Update) -> Result<Stored, DbErr> {
    let Update {
        feed: parsed,
        validators,
        ..
    } = update;
    // Updating the row first takes the feed's lock, which `subscription::resolve` waits for.
    let feed = feed::ActiveModel {
        title: Set(parsed.title),
        description: Set(parsed.description),
        image: Set(parsed.image),
        site_url: Set(parsed.site_url),
        language: Set(parsed.language),
        ttl: Set(parsed.ttl),
        etag_header: Set(validators.etag),
        last_modified_header: Set(validators.last_modified),
        ..checked(feed_id)
    }
    .update(db)
    .await?;
    // Clients send timestamps back as cursors with millisecond precision, so that is all that is stored.
    let now = Utc::now().trunc_subsecs(3);
    let entries = parsed
        .entries
        .into_iter()
        .map(|entry| entry_model(feed_id, entry, now));
    // Entries are never updated once stored, so a changing feed does not churn the timeline.
    let new = entry::Entity::insert_many(entries)
        .on_conflict(
            OnConflict::columns([entry::Column::FeedId, entry::Column::Guid])
                .do_nothing()
                .to_owned(),
        )
        .exec_with_returning(db)
        .await?;
    let (actions, deliveries) = fan_out(db, &feed, &new).await?;
    Ok(Stored {
        feed,
        actions,
        deliveries,
    })
}

/// Hands new entries to the feed's subscribers as their rules say: blocks them, or marks them unread unless
/// silenced and stars or forwards them. Each subscriber hears of what arrived with one `timeline N`.
async fn fan_out(
    db: &impl ConnectionTrait,
    feed: &feed::Model,
    entries: &[entry::Model],
) -> Result<(Vec<Action>, Vec<Delivery>), DbErr> {
    if entries.is_empty() {
        return Ok(Default::default());
    }
    let subscribers = subscription::Entity::find()
        .filter(subscription::Column::FeedId.eq(feed.id))
        .all(db)
        .await?;
    let user_ids = subscribers
        .iter()
        .map(|subscription| subscription.user_id.clone());
    let rules = Rules::load_many(db, user_ids).await?;
    // Collection times are timeline cursors, which clients send back in milliseconds.
    let now = Utc::now().trunc_subsecs(3);
    let (mut unread, mut blocked, mut collected) = (Vec::new(), Vec::new(), Vec::new());
    let (mut actions, mut deliveries) = (Vec::new(), Vec::new());
    for subscription in &subscribers {
        let user_id = &subscription.user_id;
        let (mut arrived, mut silenced) = (Vec::new(), 0);
        for entry in entries {
            let subject = Subject::arriving(feed, entry, subscription);
            let settings = rules.get(user_id).and_then(|rules| rules.apply(&subject));
            let settings = settings.unwrap_or_default();
            if settings.blocks(entry) {
                blocked.push(blocked_entry::ActiveModel {
                    user_id: Set(user_id.clone()),
                    entry_id: Set(entry.id),
                });
                continue;
            }
            arrived.push(entry);
            if settings.silence == Some(true) {
                silenced += 1;
            } else {
                unread.push(unread::ActiveModel {
                    user_id: Set(user_id.clone()),
                    entry_id: Set(entry.id),
                    feed_id: Set(feed.id),
                });
            }
            if settings.star == Some(true) {
                collected.push(collection::ActiveModel {
                    user_id: Set(user_id.clone()),
                    entry_id: Set(entry.id),
                    view: Set(subscription.view),
                    created_at: Set(now),
                });
                actions.push(Action {
                    user_id: user_id.clone(),
                    model: "collection",
                    model_id: Some(entry.id.to_string()),
                    action: "I",
                    data: json!({
                        "entryId": entry.id.to_string(),
                        "feedId": feed.id.to_string(),
                        "view": subscription.view,
                        "createdAt": iso(now),
                    }),
                });
            }
            deliveries.extend(Delivery::of(user_id, &subject, &settings, &settings));
        }
        let Some(latest) = arrived.iter().map(|entry| entry.published_at).max() else {
            continue;
        };
        actions.push(Action {
            user_id: user_id.clone(),
            model: "timeline",
            model_id: Some(feed.id.to_string()),
            action: "N",
            data: json!({
                "feedId": feed.id.to_string(),
                "count": arrived.len(),
                "unread": arrived.len() - silenced,
                "latestPublishedAt": iso(latest),
                "from": ["feed"],
            }),
        });
    }
    unread::Entity::insert_many(unread)
        .exec_without_returning(db)
        .await?;
    blocked_entry::Entity::insert_many(blocked)
        .exec_without_returning(db)
        .await?;
    collection::Entity::insert_many(collected)
        .exec_without_returning(db)
        .await?;
    Ok((actions, deliveries))
}

fn entry_model(feed_id: i64, entry: ParsedEntry, now: DateTime<Utc>) -> entry::ActiveModel {
    entry::ActiveModel {
        id: Set(next_id()),
        feed_id: Set(feed_id),
        guid: Set(entry.guid),
        title: Set(entry.title),
        url: Set(entry.url),
        description: Set(entry.description),
        content: Set(entry.content),
        author: Set(entry.author),
        author_url: Set(entry.author_url),
        author_avatar: Set(entry.author_avatar),
        categories: Set((!entry.categories.is_empty()).then_some(entry.categories)),
        media: Set(json_list(&entry.media)),
        attachments: Set(json_list(&entry.attachments)),
        extra: Set(entry.extra.map(|extra| json!(extra))),
        language: Set(entry.language),
        published_at: Set(entry.published_at.trunc_subsecs(3)),
        inserted_at: Set(now),
    }
}

fn json_list<T: Serialize>(items: &[T]) -> Option<Json> {
    (!items.is_empty()).then(|| json!(items))
}
