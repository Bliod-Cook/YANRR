use std::time::Duration;

use sea_orm::{
    ActiveValue::Set, ColumnTrait, ConnectionTrait, DatabaseConnection, DatabaseTransaction,
    DbBackend, DbErr, EntityTrait, QueryFilter, QueryOrder, QuerySelect, Statement,
};
use serde::Serialize;
use serde_json::Value;

use crate::{entity::sync_action, time::iso};

const RETENTION_DAYS: u32 = 30;
const PAGE_SIZE: u64 = 500;
/// Advisory lock that orders change log commits.
const LOG_LOCK: i64 = 0x7379_6e63;

/// A change log row. The `data` of each model follows Folo's sync engine design
/// (`docs/superpowers/specs/2026-09-16-sync-engine-design.md` in the Folo repository).
pub struct Action {
    /// subscription, collection, timeline, inbox, inbox_entry, action, setting or messaging.
    pub model: &'static str,
    pub model_id: Option<String>,
    /// `I`, `U`, `D`, or `N` for new timeline entries.
    pub action: &'static str,
    pub data: Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Delta {
    actions: Vec<LoggedAction>,
    last_sync_id: i64,
    has_more: bool,
    reset: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LoggedAction {
    id: i64,
    model: String,
    model_id: Option<String>,
    action: String,
    data: Value,
    created_at: String,
}

/// Appends `actions` to the user's change log and returns the highest id.
///
/// Call it last in the transaction: its lock is held until commit, so rows become visible in id order and a
/// client cursor never moves past a row that commits later.
pub async fn record(
    txn: &DatabaseTransaction,
    user_id: &str,
    actions: Vec<Action>,
) -> Result<i64, DbErr> {
    let lock = "SELECT pg_advisory_xact_lock($1)";
    txn.execute_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        lock,
        [LOG_LOCK.into()],
    ))
    .await?;
    let rows = actions.into_iter().map(|action| sync_action::ActiveModel {
        user_id: Set(user_id.into()),
        model: Set(action.model.into()),
        model_id: Set(action.model_id),
        action: Set(action.action.into()),
        data: Set(action.data),
        ..Default::default()
    });
    let ids = sync_action::Entity::insert_many(rows)
        .exec_with_returning_keys(txn)
        .await?;
    ids.into_iter()
        .max()
        .ok_or_else(|| DbErr::RecordNotInserted)
}

/// The id a client may start from: the head of the log, or the cleaner's horizon once the log is empty.
pub async fn state(db: &impl ConnectionTrait) -> Result<i64, DbErr> {
    Ok(bounds(db).await?.1)
}

/// The user's actions after `cursor`, oldest first.
pub async fn delta(
    db: &impl ConnectionTrait,
    user_id: &str,
    cursor: i64,
    limit: Option<u64>,
) -> Result<Delta, DbErr> {
    let limit = limit.unwrap_or(PAGE_SIZE).clamp(1, PAGE_SIZE);
    let mut rows = sync_action::Entity::find()
        .filter(sync_action::Column::UserId.eq(user_id))
        .filter(sync_action::Column::Id.gt(cursor))
        .order_by_asc(sync_action::Column::Id)
        .limit(limit + 1)
        .all(db)
        .await?;
    // Read after the rows: a cleaner run in between can only cause an extra reset, never a gap.
    let (horizon, head) = bounds(db).await?;
    // Below the horizon rows may be gone; above the head the ids restarted, e.g. after a database reset.
    if cursor < horizon || cursor > head {
        return Ok(Delta {
            actions: Vec::new(),
            last_sync_id: head,
            has_more: false,
            reset: true,
        });
    }
    let has_more = rows.len() as u64 > limit;
    rows.truncate(limit as usize);
    let last_sync_id = rows.last().map_or(cursor, |row| row.id);
    let actions = rows
        .into_iter()
        .map(|row| LoggedAction {
            id: row.id,
            model: row.model,
            model_id: row.model_id,
            action: row.action,
            data: row.data,
            created_at: iso(row.created_at),
        })
        .collect();
    Ok(Delta {
        actions,
        last_sync_id,
        has_more,
        reset: false,
    })
}

/// The cleaner's horizon and the head of the log.
async fn bounds(db: &impl ConnectionTrait) -> Result<(i64, i64), DbErr> {
    let sql = "SELECT pruned_through AS horizon,
            greatest((SELECT max(id) FROM sync_actions), pruned_through) AS head
        FROM sync_horizon";
    let row = db
        .query_one_raw(Statement::from_string(DbBackend::Postgres, sql))
        .await?
        .ok_or_else(|| DbErr::RecordNotFound("sync_horizon".into()))?;
    Ok((row.try_get("", "horizon")?, row.try_get("", "head")?))
}

/// Deletes actions older than the retention period and raises the horizon to the newest deleted id.
pub async fn prune(db: &DatabaseConnection) -> Result<(), DbErr> {
    // Deleting an id prefix keeps "nothing at or below the horizon remains" true even if clocks drift.
    let sql = format!(
        "WITH expired AS (
            SELECT max(id) AS id FROM sync_actions
            WHERE created_at < now() - interval '{RETENTION_DAYS} days'
        ), deleted AS (
            DELETE FROM sync_actions WHERE id <= (SELECT id FROM expired)
        )
        UPDATE sync_horizon SET pruned_through = greatest(pruned_through, (SELECT id FROM expired))"
    );
    db.execute_unprepared(&sql).await?;
    Ok(())
}

/// Prunes the change log once a day for as long as the process runs.
pub fn spawn_cleaner(db: DatabaseConnection) {
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(Duration::from_secs(24 * 60 * 60));
        loop {
            ticker.tick().await;
            if let Err(err) = prune(&db).await {
                tracing::error!("pruning the change log failed: {err}");
            }
        }
    });
}
