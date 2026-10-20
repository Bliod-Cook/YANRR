use std::{sync::Arc, time::Duration};

use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, DbErr, Statement};
use tokio::sync::Semaphore;

use super::refresh_feed;
use crate::AppState;

const TICK: Duration = Duration::from_secs(60);
const CONCURRENCY: usize = 8;

/// Refreshes due feeds in the background for as long as the process runs.
pub fn spawn(state: AppState) {
    tokio::spawn(async move {
        let permits = Arc::new(Semaphore::new(CONCURRENCY));
        let mut ticker = tokio::time::interval(TICK);
        loop {
            ticker.tick().await;
            let ids = match claim_due_feeds(&state.db).await {
                Ok(ids) => ids,
                Err(err) => {
                    tracing::error!("claiming due feeds failed: {err}");
                    continue;
                }
            };
            for id in ids {
                let permit = permits
                    .clone()
                    .acquire_owned()
                    .await
                    .expect("semaphore is never closed");
                let state = state.clone();
                tokio::spawn(async move {
                    if let Err(err) = refresh_feed(&state, id).await {
                        tracing::warn!(feed = id, "refresh failed: {err:?}");
                    }
                    drop(permit);
                });
            }
        }
    });
}

/// Marks due feeds as enqueued and returns their ids.
///
/// A feed is due `ttl` minutes after its last check (60 without a TTL, at least 10). Feeds being fetched are
/// skipped, unless the fetch started over 10 minutes ago and is presumed lost.
pub async fn claim_due_feeds(db: &DatabaseConnection) -> Result<Vec<i64>, DbErr> {
    let sql = "
        UPDATE feeds SET refresh_enqueued_at = now()
        WHERE migrate_to IS NULL
          AND checked_at + make_interval(mins => GREATEST(COALESCE(ttl, 60), 10)) <= now()
          AND (refresh_enqueued_at IS NULL
               OR refresh_enqueued_at <= checked_at
               OR refresh_enqueued_at < now() - interval '10 minutes')
        RETURNING id";
    let rows = db
        .query_all_raw(Statement::from_string(DbBackend::Postgres, sql))
        .await?;
    rows.iter().map(|row| row.try_get("", "id")).collect()
}
