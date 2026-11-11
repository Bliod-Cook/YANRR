pub(crate) mod html;
pub(crate) mod http;
pub(crate) mod language;
pub mod parse;
pub mod readability;
pub mod scheduler;

use std::collections::HashSet;

use chrono::{DateTime, SubsecRound, TimeDelta, Utc};
use futures::{StreamExt, stream};
use reqwest::{StatusCode, Url};
use sea_orm::{
    ActiveModelTrait,
    ActiveValue::{Set, Unchanged},
    ColumnTrait, ConnectionTrait, DatabaseTransaction, DbBackend, DbErr, EntityTrait,
    PaginatorTrait, QueryFilter, Statement, TransactionTrait,
    prelude::Json,
    sea_query::OnConflict,
};
use serde::Serialize;
use serde_json::json;

use self::{
    http::{Failure, Fetched, Validators},
    parse::{ParsedEntry, ParsedFeed},
};
use crate::{
    AppState,
    entity::{entry, feed, subscription},
    id::next_id,
    rules::{
        Rules, Subject,
        deliver::{self, Delivery},
    },
    search, subscription as subscriptions,
    sync::{self, Action},
    time::iso,
};

pub use self::http::client as http_client;

/// Rows per insert: 17 columns stay far below the 65535 parameters a statement can bind.
const INSERT_CHUNK: usize = 500;
/// How many feeds a page links to are fetched at once.
const DISCOVER_CONCURRENCY: usize = 4;

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
    let url = normalize(url);
    let existing = feed::Entity::find().filter(feed::Column::Url.eq(&url));
    if let Some(feed) = existing.one(&state.db).await? {
        return freshen(state, feed).await;
    }
    let fetched = fetch(state, &url, &Validators::default())
        .await
        .map_err(|failure| FetchError::Fetch(failure.message))?
        .ok_or(FetchError::Fetch("HTTP 304".into()))?;
    let update = parsed(&url, fetched).await?;
    insert(state, &url, update).await
}

/// A feed address as feeds are stored under: web addresses as [`Url`] writes them, so that each spelling of one finds
/// the same feed.
fn normalize(url: &str) -> String {
    let url = url.trim();
    match Url::parse(url) {
        Ok(parsed) if matches!(parsed.scheme(), "http" | "https") => parsed.into(),
        _ => url.into(),
    }
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
    let Fetched {
        body,
        validators,
        url: page,
        permanent,
    } = fetched;
    let base = page.clone();
    // A feed itself, or else a page linking to feeds.
    let found = blocking(move || {
        parse::parse(&body, &base).map_err(|_| {
            let base = Url::parse(&base).expect("fetched URL");
            html::feed_links(&String::from_utf8_lossy(&body), &base)
        })
    })
    .await
    .map_err(FetchError::Parse)?;
    let links = match found {
        Ok(feed) => {
            let update = Update {
                feed,
                validators,
                moved_to: permanent.then_some(page),
            };
            return Ok(vec![insert(state, &url, update).await?]);
        }
        Err(links) => links,
    };
    let mut seen = HashSet::new();
    let links: Vec<_> = links
        .into_iter()
        .filter(|link| seen.insert(link.clone()))
        .collect();
    // In the page's order; links redirecting to the same feed find it once.
    let adds: Vec<_> = links
        .iter()
        .map(|link| async move { (link, add_feed(state, link).await) })
        .collect();
    let mut added = stream::iter(adds).buffered(DISCOVER_CONCURRENCY);
    let mut feeds: Vec<feed::Model> = Vec::new();
    while let Some((link, added)) = added.next().await {
        match added {
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
async fn insert(
    state: &AppState,
    url: &str,
    mut update: Update,
) -> Result<feed::Model, FetchError> {
    let entries = update.new_entries(HashSet::new()).await?;
    let txn = state.db.begin().await?;
    let feed = find_or_create(&txn, update.moved_to.as_deref().unwrap_or(url)).await?;
    let stored = store(&txn, feed.id, update, entries).await?;
    sync::record(&txn, stored.actions).await?;
    txn.commit().await?;
    state.search.wake();
    deliver::spawn(state, &stored.feed, stored.deliveries);
    Ok(stored.feed)
}

/// Fetches a feed again, recording the error on failure.
///
/// `error_at` keeps when the failures began, which the scheduler backs off by. A server that asks to be left alone
/// for a while, or says the feed is gone, gets as long a break as failures of that length would.
pub async fn refresh_feed(state: &AppState, feed_id: i64) -> Result<(), FetchError> {
    let feed = feed::Entity::find_by_id(feed_id)
        .one(&state.db)
        .await?
        .ok_or_else(|| DbErr::RecordNotFound(format!("feed {feed_id}")))?;
    let validators = Validators {
        etag: feed.etag_header.clone(),
        last_modified: feed.last_modified_header.clone(),
    };
    let (result, wait) = match fetch(state, &feed.url, &validators).await {
        Ok(fetched) => (refresh(state, &feed, fetched).await, None),
        Err(failure) => {
            let wait = match failure.status {
                Some(StatusCode::GONE) => Some(scheduler::MAX_BACKOFF),
                _ => failure.retry_after,
            };
            (Err(FetchError::Fetch(failure.message)), wait)
        }
    };
    let message = match &result {
        Ok(()) => None,
        Err(FetchError::Fetch(message) | FetchError::Parse(message)) => Some(message.clone()),
        Err(FetchError::Db(err)) => {
            tracing::error!(feed = feed.id, "storing failed: {err}");
            Some("Storing the feed failed".into())
        }
    };
    let Some(message) = message else {
        return result;
    };
    let now = Utc::now();
    let mut began = feed.error_at.unwrap_or(now);
    if let Some(wait) = wait {
        let wait = TimeDelta::from_std(wait.min(scheduler::MAX_BACKOFF)).expect("a day fits");
        began = began.min(now - wait);
    }
    feed::ActiveModel {
        id: Unchanged(feed.id),
        checked_at: Set(now),
        error_message: Set(Some(message)),
        error_at: Set(Some(began)),
        ..Default::default()
    }
    .update(&state.db)
    .await?;
    result
}

/// Stores a feed fetched again, or only notes the check when it was not modified.
async fn refresh(
    state: &AppState,
    feed: &feed::Model,
    fetched: Option<Fetched>,
) -> Result<(), FetchError> {
    let Some(fetched) = fetched else {
        checked(feed.id).update(&state.db).await?;
        return Ok(());
    };
    let mut update = parsed(&feed.url, fetched).await?;
    let moved_to = update.moved_to.take().filter(|url| *url != feed.url);
    // Where a moved feed goes may have some of its entries, which storing skips, so only an unmoved one skips
    // normalizing those it has.
    let known = match moved_to {
        None => known_guids(&state.db, feed.id, update.feed.entries.guids()).await?,
        Some(_) => HashSet::new(),
    };
    let entries = update.new_entries(known).await?;
    let txn = state.db.begin().await?;
    let stored = match moved_to {
        None => store(&txn, feed.id, update, entries).await?,
        Some(url) => moved(&txn, feed, url, update, entries).await?,
    };
    sync::record(&txn, stored.actions).await?;
    txn.commit().await?;
    state.search.wake();
    deliver::spawn(state, &stored.feed, stored.deliveries);
    Ok(())
}

/// Stores the update of `feed`, which permanently moved to `url`. With no feed there yet, the feed takes the new
/// address and its followers notice nothing; otherwise its followers and the entries only it has move to the feed
/// there.
async fn moved(
    txn: &DatabaseTransaction,
    feed: &feed::Model,
    url: String,
    update: Update,
    entries: Vec<ParsedEntry>,
) -> Result<Stored, DbErr> {
    let found = feed::Entity::find()
        .filter(feed::Column::Url.eq(&url))
        .one(txn)
        .await?;
    let Some(found) = found else {
        let renamed = feed::ActiveModel {
            id: Unchanged(feed.id),
            url: Set(url),
            ..Default::default()
        };
        renamed.update(txn).await?;
        return store(txn, feed.id, update, entries).await;
    };
    // Addresses redirecting to each other lead back here; that is no move.
    let target = subscriptions::resolve(txn, found.id)
        .await?
        .filter(|target| target.id != feed.id);
    let Some(target) = target else {
        return store(txn, feed.id, update, entries).await;
    };
    let mut stored = store(txn, target.id, update, entries).await?;
    let migrated = feed::ActiveModel {
        migrate_to: Set(Some(target.id)),
        ..checked(feed.id)
    };
    migrated.update(txn).await?;
    let moved = subscriptions::migrate(txn, feed.id, &stored.feed).await?;
    stored.actions.extend(moved);
    Ok(stored)
}

/// A fetched and parsed feed.
struct Update {
    feed: ParsedFeed,
    validators: Validators,
    /// Where the feed permanently moved to; never set for `rsshub://` feeds, whose instance may change.
    moved_to: Option<String>,
}

impl Update {
    /// The entries whose guid `known` lacks, normalized off the async workers; the update keeps none.
    async fn new_entries(
        &mut self,
        known: HashSet<String>,
    ) -> Result<Vec<ParsedEntry>, FetchError> {
        let entries = std::mem::take(&mut self.feed.entries);
        blocking(move || entries.finish(known))
            .await
            .map_err(FetchError::Parse)
    }
}

/// Fetches the feed at `url`; `None` means not modified.
async fn fetch(
    state: &AppState,
    url: &str,
    validators: &Validators,
) -> Result<Option<Fetched>, Failure> {
    let source = source_url(&state.config.rsshub.url, url);
    http::get_within(&state.http, &source, validators, &http::LIMITS).await
}

/// Parses what was fetched for the feed at `url`.
async fn parsed(url: &str, fetched: Fetched) -> Result<Update, FetchError> {
    let Fetched {
        body,
        validators,
        url: source,
        permanent,
    } = fetched;
    let base = source.clone();
    let feed = blocking(move || parse::parse(&body, &base))
        .await
        .and_then(|parsed| parsed)
        .map_err(FetchError::Parse)?;
    let moved_to = (permanent && !url.starts_with("rsshub://")).then_some(source);
    Ok(Update {
        feed,
        validators,
        moved_to,
    })
}

/// Runs CPU-bound work, such as building a DOM for every entry, off the async workers.
pub(crate) async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> T + Send + 'static,
) -> Result<T, String> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|err| err.to_string())
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

/// Which of `guids` the feed has stored.
async fn known_guids(
    db: &impl ConnectionTrait,
    feed_id: i64,
    guids: Vec<String>,
) -> Result<HashSet<String>, DbErr> {
    let sql = "SELECT guid FROM entries WHERE feed_id = $1 AND guid = ANY($2)";
    let statement =
        Statement::from_sql_and_values(DbBackend::Postgres, sql, [feed_id.into(), guids.into()]);
    let rows = db.query_all_raw(statement).await?;
    rows.iter().map(|row| row.try_get("", "guid")).collect()
}

/// What storing a fetched feed did: the actions to record, and what to deliver once they are committed.
struct Stored {
    feed: feed::Model,
    actions: Vec<Action>,
    deliveries: Vec<Delivery>,
}

/// Writes the feed's metadata and those of `entries` it has not stored, and hands these to its subscribers; run it
/// in the caller's transaction, which records the actions.
async fn store(
    db: &impl ConnectionTrait,
    feed_id: i64,
    update: Update,
    entries: Vec<ParsedEntry>,
) -> Result<Stored, DbErr> {
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
    let entries: Vec<_> = entries
        .into_iter()
        .map(|entry| entry_model(feed_id, entry, now))
        .collect();
    // Entries are never updated once stored, so a changing feed does not churn the timeline; only new ones are sent.
    let mut new = Vec::new();
    for chunk in entries.chunks(INSERT_CHUNK) {
        let inserted = entry::Entity::insert_many(chunk.to_vec())
            .on_conflict(
                OnConflict::columns([entry::Column::FeedId, entry::Column::Guid])
                    .do_nothing()
                    .to_owned(),
            )
            .exec_with_returning(db)
            .await?;
        new.extend(inserted);
    }
    search::enqueue(db, &new.iter().map(|entry| entry.id).collect::<Vec<_>>()).await?;
    let (actions, deliveries) = fan_out(db, &feed, &new).await?;
    Ok(Stored {
        feed,
        actions,
        deliveries,
    })
}

/// Users and entries of rows to insert, column by column.
#[derive(Default)]
struct Pairs {
    users: Vec<String>,
    entries: Vec<i64>,
}

impl Pairs {
    fn push(&mut self, user_id: &str, entry_id: i64) {
        self.users.push(user_id.into());
        self.entries.push(entry_id);
    }
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
    let (mut unread, mut blocked, mut collected) =
        (Pairs::default(), Pairs::default(), Pairs::default());
    let mut views = Vec::new();
    let (mut actions, mut deliveries) = (Vec::new(), Vec::new());
    for subscription in &subscribers {
        let user_id = &subscription.user_id;
        let user_rules = rules.get(user_id);
        let (mut arrived, mut silenced) = (Vec::new(), 0);
        for entry in entries {
            let subject = Subject::arriving(feed, entry, Some(subscription));
            let settings = user_rules.and_then(|rules| rules.apply(&subject));
            let settings = settings.unwrap_or_default();
            if user_rules.is_some_and(|rules| rules.blocks(&settings, entry)) {
                blocked.push(user_id, entry.id);
                continue;
            }
            arrived.push(entry);
            if settings.silence == Some(true) {
                silenced += 1;
            } else {
                unread.push(user_id, entry.id);
            }
            if settings.star == Some(true) {
                collected.push(user_id, entry.id);
                views.push(subscription.view);
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
    // Rows go in as one array per column, which binds a few parameters however many subscribers and entries meet.
    let inserts = [
        (
            "INSERT INTO unreads (user_id, entry_id, feed_id)
            SELECT *, $3 FROM unnest($1::text[], $2::bigint[])",
            unread,
            vec![feed.id.into()],
        ),
        (
            "INSERT INTO blocked_entries (user_id, entry_id) SELECT * FROM unnest($1::text[], $2::bigint[])",
            blocked,
            vec![],
        ),
        (
            "INSERT INTO collections (user_id, entry_id, view, created_at)
            SELECT *, $4 FROM unnest($1::text[], $2::bigint[], $3::smallint[])",
            collected,
            vec![views.into(), now.into()],
        ),
    ];
    for (sql, rows, more) in inserts {
        if rows.users.is_empty() {
            continue;
        }
        let mut values = vec![rows.users.into(), rows.entries.into()];
        values.extend(more);
        let statement = Statement::from_sql_and_values(DbBackend::Postgres, sql, values);
        db.execute_raw(statement).await?;
    }
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
