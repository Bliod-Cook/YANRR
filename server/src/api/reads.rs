use std::collections::BTreeMap;

use axum::{Json, extract::State};
use chrono::DateTime;
use sea_orm::{
    ColumnTrait, ConnectionTrait, DatabaseTransaction, DbBackend, DbErr, EntityTrait,
    FromQueryResult, QueryFilter, Statement, TransactionTrait,
};
use serde::Deserialize;
use serde_json::{Value, json};

use super::{
    entries::{INBOX_TIMELINE, Params, Scope, TIMELINE},
    error::{ApiJson, ApiQuery, ApiResult},
    inboxes,
    response::{ok, synced},
    session::AuthUser,
};
use crate::{
    AppState,
    entity::unread,
    id,
    sync::{self, Action},
};

const ENTRIES_PER_ACTION: usize = 500;

/// An entry whose read state really flipped, with the feed id or inbox handle whose unread count it moves.
#[derive(FromQueryResult)]
struct Flip {
    entry_id: i64,
    counter: String,
}

impl From<unread::Model> for Flip {
    fn from(row: unread::Model) -> Self {
        Self {
            entry_id: row.entry_id,
            counter: row.feed_id.to_string(),
        }
    }
}

/// Flipped entries per feed id or inbox handle.
fn per_counter(flips: &[Flip]) -> BTreeMap<String, usize> {
    let mut counts = BTreeMap::new();
    for flip in flips {
        *counts.entry(flip.counter.clone()).or_default() += 1;
    }
    counts
}

/// `timeline U` actions for entries whose read state really flipped. Each counts its own entries per feed or
/// inbox, as clients add up the counts of every action.
fn flipped(user_id: &str, read: bool, is_inbox: bool, flips: &[Flip]) -> Vec<Action> {
    flips
        .chunks(ENTRIES_PER_ACTION)
        .map(|chunk| {
            let entry_ids: Vec<_> = chunk.iter().map(|flip| flip.entry_id.to_string()).collect();
            Action {
                user_id: user_id.into(),
                model: "timeline",
                model_id: None,
                action: "U",
                data: json!({
                    "entryIds": entry_ids,
                    "read": read,
                    "isInbox": is_inbox,
                    "feeds": per_counter(chunk),
                }),
            }
        })
        .collect()
}

/// Sets the read state of the user's inbox entries matching `condition` on [`INBOX_TIMELINE`] and returns those
/// it changed.
async fn flip_inbox(
    txn: &DatabaseTransaction,
    read: bool,
    condition: &str,
    params: Params,
) -> Result<Vec<Flip>, DbErr> {
    // Checked again after waiting for a row lock, so concurrent requests count each flip once.
    let sql = format!(
        "UPDATE inbox_entries SET read = {read}
        WHERE read <> {read} AND id IN (SELECT e.id {INBOX_TIMELINE} WHERE {condition})
        RETURNING id AS entry_id, inbox_handle AS counter"
    );
    let statement = Statement::from_sql_and_values(DbBackend::Postgres, sql, params.0);
    Flip::find_by_statement(statement).all(txn).await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadBody {
    entry_ids: Vec<String>,
    #[serde(default)]
    is_inbox: bool,
}

/// `POST /reads`: the entries are all feed entries or, with `isInbox`, all inbox entries.
pub async fn mark_read(
    State(state): State<AppState>,
    user: AuthUser,
    ApiJson(body): ApiJson<ReadBody>,
) -> ApiResult<Json<Value>> {
    let ids: Vec<_> = body
        .entry_ids
        .iter()
        .filter_map(|id| id::parse(id))
        .collect();
    let txn = state.db.begin().await?;
    let flips = if body.is_inbox {
        let mut params = Params(vec![user.id.clone().into()]);
        let condition = format!("e.id = ANY({})", params.bind(ids));
        flip_inbox(&txn, true, &condition, params).await?
    } else {
        let rows = unread::Entity::delete_many()
            .filter(unread::Column::UserId.eq(&user.id))
            .filter(unread::Column::EntryId.is_in(ids))
            .exec_with_returning(&txn)
            .await?;
        rows.into_iter().map(Flip::from).collect()
    };
    let last_sync_id = sync::record(&txn, flipped(&user.id, true, body.is_inbox, &flips)).await?;
    txn.commit().await?;
    Ok(synced(last_sync_id))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnreadBody {
    entry_id: String,
    #[serde(default)]
    is_inbox: bool,
}

/// `DELETE /reads`: only entries of followed feeds, or of the user's inboxes with `isInbox`, can be unread.
pub async fn mark_unread(
    State(state): State<AppState>,
    user: AuthUser,
    ApiJson(body): ApiJson<UnreadBody>,
) -> ApiResult<Json<Value>> {
    let txn = state.db.begin().await?;
    let mut flips = Vec::new();
    if let Some(entry_id) = id::parse(&body.entry_id) {
        let mut params = Params(vec![user.id.clone().into()]);
        let entry_id = params.bind(entry_id);
        flips = if body.is_inbox {
            let condition = format!("e.id = {entry_id}");
            flip_inbox(&txn, false, &condition, params).await?
        } else {
            // The subscription is locked, so an unsubscribe in flight either waits and then drops this row
            // too, or removes the subscription first and leaves nothing to insert.
            let sql = format!(
                "INSERT INTO unreads (user_id, entry_id, feed_id)
                SELECT s.user_id, e.id, e.feed_id
                FROM entries e JOIN subscriptions s ON s.feed_id = e.feed_id AND s.user_id = $1
                WHERE e.id = {entry_id}
                FOR KEY SHARE OF s
                ON CONFLICT DO NOTHING
                RETURNING *"
            );
            let statement = Statement::from_sql_and_values(DbBackend::Postgres, sql, params.0);
            let rows = unread::Model::find_by_statement(statement)
                .all(&txn)
                .await?;
            rows.into_iter().map(Flip::from).collect()
        };
    }
    let last_sync_id = sync::record(&txn, flipped(&user.id, false, body.is_inbox, &flips)).await?;
    txn.commit().await?;
    Ok(synced(last_sync_id))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadAllBody {
    #[serde(flatten)]
    scope: Scope,
    start_time: Option<i64>,
    end_time: Option<i64>,
    inserted_before: Option<i64>,
}

impl ReadAllBody {
    /// Conditions on `e` for entries published between `startTime` and `endTime` and inserted before
    /// `insertedBefore`, all in milliseconds.
    fn time_range(&self, params: &mut Params) -> String {
        let mut sql = String::new();
        let mut time = |column: &str, operator: &str, millis: Option<i64>| {
            if let Some(time) = millis.and_then(DateTime::from_timestamp_millis) {
                sql += &format!(" AND {column} {operator} {}", params.bind(time));
            }
        };
        time("e.published_at", ">=", self.start_time);
        time("e.published_at", "<=", self.end_time);
        time("e.inserted_at", "<", self.inserted_before);
        sql
    }
}

/// `POST /reads/all`: marks what the timeline of the scope shows read, optionally only within a time range.
pub async fn mark_all_read(
    State(state): State<AppState>,
    user: AuthUser,
    ApiJson(body): ApiJson<ReadAllBody>,
) -> ApiResult<Json<Value>> {
    let txn = state.db.begin().await?;
    let mut params = Params(vec![user.id.clone().into()]);
    let mut feed_flips = Vec::new();
    if let Some(scope) = body.scope.condition(&mut params) {
        let time_range = body.time_range(&mut params);
        let sql = format!(
            "DELETE FROM unreads WHERE user_id = $1
                AND entry_id IN (SELECT e.id {TIMELINE} WHERE {scope}{time_range})
            RETURNING *"
        );
        let statement = Statement::from_sql_and_values(DbBackend::Postgres, sql, params.0);
        let rows = unread::Model::find_by_statement(statement)
            .all(&txn)
            .await?;
        feed_flips = rows.into_iter().map(Flip::from).collect();
    }
    let mut params = Params(vec![user.id.clone().into()]);
    let mut inbox_flips = Vec::new();
    if let Some(scope) = body.scope.inbox_condition(&mut params) {
        let condition = scope + &body.time_range(&mut params);
        inbox_flips = flip_inbox(&txn, true, &condition, params).await?;
    }
    let mut actions = flipped(&user.id, true, false, &feed_flips);
    actions.extend(flipped(&user.id, true, true, &inbox_flips));
    let last_sync_id = sync::record(&txn, actions).await?;
    txn.commit().await?;
    let mut read = per_counter(&feed_flips);
    read.extend(per_counter(&inbox_flips));
    Ok(Json(json!({
        "code": 0,
        "data": { "read": read },
        "lastSyncId": last_sync_id,
    })))
}

#[derive(Deserialize)]
pub struct CountQuery {
    view: Option<i16>,
}

#[derive(FromQueryResult)]
struct Count {
    counter: String,
    count: i64,
}

/// `GET /reads`: unread entries per feed and inbox, with the change log id the counts include, so a client
/// replaying the log does not count those changes twice.
pub async fn counts(
    State(state): State<AppState>,
    user: AuthUser,
    ApiQuery(query): ApiQuery<CountQuery>,
) -> ApiResult<Json<Value>> {
    let mut params = Params(vec![user.id.into()]);
    let mut sql = "SELECT u.feed_id::text AS counter, count(*) AS count FROM unreads u
        JOIN subscriptions s ON s.user_id = u.user_id AND s.feed_id = u.feed_id
        WHERE u.user_id = $1"
        .to_string();
    if let Some(view) = query.view.filter(|view| *view != -1) {
        sql += &format!(" AND s.view = {}", params.bind(view));
    }
    sql += " GROUP BY u.feed_id";
    if inboxes::in_view(query.view) {
        sql += &format!(
            " UNION ALL SELECT e.inbox_handle, count(*) {INBOX_TIMELINE} WHERE NOT e.read
            GROUP BY e.inbox_handle"
        );
    }
    let txn = sync::snapshot(&state.db).await?;
    let statement = Statement::from_sql_and_values(DbBackend::Postgres, sql, params.0);
    let counts = Count::find_by_statement(statement).all(&txn).await?;
    let last_sync_id = sync::state(&txn).await?;
    txn.commit().await?;
    let counts: BTreeMap<_, _> = counts
        .into_iter()
        .map(|row| (row.counter, row.count))
        .collect();
    Ok(Json(
        json!({ "code": 0, "data": counts, "lastSyncId": last_sync_id }),
    ))
}

/// `GET /reads/total-count`
pub async fn total(State(state): State<AppState>, user: AuthUser) -> ApiResult<Json<Value>> {
    let sql = format!(
        "SELECT (SELECT count(*) FROM unreads WHERE user_id = $1)
            + (SELECT count(*) {INBOX_TIMELINE} WHERE NOT e.read) AS count"
    );
    let statement = Statement::from_sql_and_values(DbBackend::Postgres, sql, [user.id.into()]);
    let row = state
        .db
        .query_one_raw(statement)
        .await?
        .ok_or_else(|| DbErr::RecordNotFound("unread count".into()))?;
    let count: i64 = row.try_get("", "count")?;
    Ok(ok(json!({ "count": count })))
}
