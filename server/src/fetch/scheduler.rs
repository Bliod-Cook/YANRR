use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Mutex, PoisonError},
    time::Duration,
};

use reqwest::Url;
use sea_orm::{DatabaseConnection, DbBackend, DbErr, FromQueryResult, Statement};
use tokio::sync::Semaphore;

use super::{refresh_feed, source_url};
use crate::AppState;

const TICK: Duration = Duration::from_secs(60);
/// How many feeds are fetched at once.
const CONCURRENCY: usize = 8;
/// How many feeds of one host are fetched at once, so that feeds sharing a server, such as an RSSHub instance, do not
/// flood it.
const PER_HOST: usize = 2;
/// The longest a feed declares to wait between checks, in minutes; a longer TTL would all but freeze it.
const MAX_TTL: u32 = 6 * 60;
/// The longest a failing feed waits between checks.
pub(crate) const MAX_BACKOFF: Duration = Duration::from_secs(24 * 60 * 60);
/// Due times are put off by up to this share at random, so that feeds checked together drift apart.
const JITTER: f64 = 0.1;

/// Refreshes due feeds in the background for as long as the process runs.
pub fn spawn(state: AppState) {
    tokio::spawn(async move {
        let mut scheduler = Scheduler::new(state);
        let mut ticker = tokio::time::interval(TICK);
        loop {
            ticker.tick().await;
            scheduler.tick().await;
        }
    });
}

/// Starts the refreshes of due feeds, a few at a time and fewer per host.
pub struct Scheduler {
    state: AppState,
    permits: Arc<Semaphore>,
    hosts: HashMap<String, Arc<Semaphore>>,
    /// Feeds being refreshed or waiting for their turn: one waiting long enough to be claimed again is not
    /// refreshed twice.
    queued: Arc<Mutex<HashSet<i64>>>,
}

impl Scheduler {
    pub fn new(state: AppState) -> Self {
        Self {
            state,
            permits: Arc::new(Semaphore::new(CONCURRENCY)),
            hosts: HashMap::new(),
            queued: Arc::default(),
        }
    }

    /// Claims the due feeds and starts refreshing them.
    pub async fn tick(&mut self) {
        let due = match claim_due_feeds(&self.state.db).await {
            Ok(due) => due,
            Err(err) => {
                tracing::error!("claiming due feeds failed: {err}");
                return;
            }
        };
        // Hosts no refresh waits for any more.
        self.hosts.retain(|_, host| Arc::strong_count(host) > 1);
        for feed in due {
            let queued = self.queued.clone();
            if !queued
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .insert(feed.id)
            {
                continue;
            }
            let host = host(&self.state.config.rsshub.url, &feed.url);
            let host = self.hosts.entry(host);
            let host = host
                .or_insert_with(|| Arc::new(Semaphore::new(PER_HOST)))
                .clone();
            let (state, permits) = (self.state.clone(), self.permits.clone());
            tokio::spawn(async move {
                let _host = host
                    .acquire_owned()
                    .await
                    .expect("semaphore is never closed");
                let _permit = permits
                    .acquire_owned()
                    .await
                    .expect("semaphore is never closed");
                if let Err(err) = refresh_feed(&state, feed.id).await {
                    tracing::warn!(feed = feed.id, "refresh failed: {err:?}");
                }
                queued
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .remove(&feed.id);
            });
        }
    }
}

/// The server a feed is fetched from: `rsshub://` feeds share their instance's.
fn host(instance: &str, url: &str) -> String {
    let Ok(url) = Url::parse(&source_url(instance, url)) else {
        return String::new();
    };
    let host = url.host_str().unwrap_or_default();
    match url.port() {
        Some(port) => format!("{host}:{port}"),
        None => host.into(),
    }
}

/// A feed claimed for a refresh.
#[derive(FromQueryResult)]
pub struct Due {
    pub id: i64,
    pub url: String,
}

/// Marks due feeds as enqueued and returns them.
///
/// A feed is due `ttl` minutes after its last check: 60 without a TTL, at least 10 and at most [`MAX_TTL`]. A failing
/// feed waits as long as its failures have lasted if that is longer, up to [`MAX_BACKOFF`], so the wait doubles with
/// each failure. Feeds being fetched are skipped, unless the fetch started over 10 minutes ago and is presumed lost,
/// and so are feeds nobody follows.
pub async fn claim_due_feeds(db: &DatabaseConnection) -> Result<Vec<Due>, DbErr> {
    let wait = format!(
        "LEAST(
            GREATEST(
                make_interval(mins => LEAST(GREATEST(COALESCE(ttl, 60), 10), {MAX_TTL})),
                checked_at - error_at
            ),
            make_interval(secs => {})
        )",
        MAX_BACKOFF.as_secs()
    );
    let sql = format!(
        "UPDATE feeds SET refresh_enqueued_at = now()
        WHERE migrate_to IS NULL
          AND EXISTS (SELECT 1 FROM subscriptions WHERE feed_id = feeds.id)
          AND checked_at + {wait} * (1 + {JITTER} * random()) <= now()
          AND (refresh_enqueued_at IS NULL
               OR refresh_enqueued_at <= checked_at
               OR refresh_enqueued_at < now() - interval '10 minutes')
        RETURNING id, url"
    );
    Due::find_by_statement(Statement::from_string(DbBackend::Postgres, sql))
        .all(db)
        .await
}
