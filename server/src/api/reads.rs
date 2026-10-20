use std::collections::BTreeMap;

use axum::{Json, extract::State};
use chrono::DateTime;
use sea_orm::{
    ColumnTrait, DbBackend, EntityTrait, FromQueryResult, PaginatorTrait, QueryFilter, Statement,
    TransactionTrait,
};
use serde::Deserialize;
use serde_json::{Value, json};

use super::{
    entries::{Params, Scope, TIMELINE},
    error::{ApiJson, ApiQuery, ApiResult},
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

/// Entries per feed, keyed by feed id.
fn per_feed(rows: &[unread::Model]) -> BTreeMap<String, usize> {
    let mut counts = BTreeMap::new();
    for row in rows {
        *counts.entry(row.feed_id.to_string()).or_default() += 1;
    }
    counts
}

/// `timeline U` actions for entries whose read state really flipped. Each counts its own entries per feed, as
/// clients add up the counts of every action.
fn flipped(user_id: &str, read: bool, rows: &[unread::Model]) -> Vec<Action> {
    rows.chunks(ENTRIES_PER_ACTION)
        .map(|chunk| {
            let entry_ids: Vec<_> = chunk.iter().map(|row| row.entry_id.to_string()).collect();
            Action {
                user_id: user_id.into(),
                model: "timeline",
                model_id: None,
                action: "U",
                data: json!({ "entryIds": entry_ids, "read": read, "feeds": per_feed(chunk) }),
            }
        })
        .collect()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadBody {
    entry_ids: Vec<String>,
}

/// `POST /reads`
pub async fn mark_read(
    State(state): State<AppState>,
    user: AuthUser,
    ApiJson(body): ApiJson<ReadBody>,
) -> ApiResult<Json<Value>> {
    let ids = body.entry_ids.iter().filter_map(|id| id::parse(id));
    let txn = state.db.begin().await?;
    let rows = unread::Entity::delete_many()
        .filter(unread::Column::UserId.eq(&user.id))
        .filter(unread::Column::EntryId.is_in(ids))
        .exec_with_returning(&txn)
        .await?;
    let last_sync_id = sync::record(&txn, flipped(&user.id, true, &rows)).await?;
    txn.commit().await?;
    Ok(synced(last_sync_id))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnreadBody {
    entry_id: String,
}

/// `DELETE /reads`: only entries of followed feeds can be unread.
pub async fn mark_unread(
    State(state): State<AppState>,
    user: AuthUser,
    ApiJson(body): ApiJson<UnreadBody>,
) -> ApiResult<Json<Value>> {
    let txn = state.db.begin().await?;
    let mut rows = Vec::new();
    if let Some(entry_id) = id::parse(&body.entry_id) {
        let sql = "INSERT INTO unreads (user_id, entry_id, feed_id)
            SELECT s.user_id, e.id, e.feed_id
            FROM entries e JOIN subscriptions s ON s.feed_id = e.feed_id AND s.user_id = $1
            WHERE e.id = $2
            ON CONFLICT DO NOTHING
            RETURNING *";
        let values = [user.id.clone().into(), entry_id.into()];
        let statement = Statement::from_sql_and_values(DbBackend::Postgres, sql, values);
        rows = unread::Model::find_by_statement(statement)
            .all(&txn)
            .await?;
    }
    let last_sync_id = sync::record(&txn, flipped(&user.id, false, &rows)).await?;
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

/// `POST /reads/all`: marks what the timeline of the scope shows read, optionally only entries published between
/// `startTime` and `endTime` or inserted before `insertedBefore` (all in milliseconds).
pub async fn mark_all_read(
    State(state): State<AppState>,
    user: AuthUser,
    ApiJson(body): ApiJson<ReadAllBody>,
) -> ApiResult<Json<Value>> {
    let mut params = Params(vec![user.id.clone().into()]);
    let txn = state.db.begin().await?;
    let mut rows = Vec::new();
    if let Some(scope) = body.scope.condition(&mut params) {
        let mut sql = format!(
            "DELETE FROM unreads WHERE user_id = $1 AND entry_id IN (SELECT e.id {TIMELINE} WHERE {scope}"
        );
        let mut time = |column: &str, operator: &str, millis: Option<i64>| {
            if let Some(time) = millis.and_then(DateTime::from_timestamp_millis) {
                sql += &format!(" AND {column} {operator} {}", params.bind(time));
            }
        };
        time("e.published_at", ">=", body.start_time);
        time("e.published_at", "<=", body.end_time);
        time("e.inserted_at", "<", body.inserted_before);
        sql += ") RETURNING *";
        let statement = Statement::from_sql_and_values(DbBackend::Postgres, sql, params.0);
        rows = unread::Model::find_by_statement(statement)
            .all(&txn)
            .await?;
    }
    let last_sync_id = sync::record(&txn, flipped(&user.id, true, &rows)).await?;
    txn.commit().await?;
    Ok(Json(json!({
        "code": 0,
        "data": { "read": per_feed(&rows) },
        "lastSyncId": last_sync_id,
    })))
}

#[derive(Deserialize)]
pub struct CountQuery {
    view: Option<i16>,
}

#[derive(FromQueryResult)]
struct FeedCount {
    feed_id: i64,
    count: i64,
}

/// `GET /reads`: unread entries per feed, with the change log id the counts include, so a client replaying the
/// log does not count those changes twice.
pub async fn counts(
    State(state): State<AppState>,
    user: AuthUser,
    ApiQuery(query): ApiQuery<CountQuery>,
) -> ApiResult<Json<Value>> {
    let mut params = Params(vec![user.id.into()]);
    let mut sql = "SELECT u.feed_id, count(*) AS count FROM unreads u
        JOIN subscriptions s ON s.user_id = u.user_id AND s.feed_id = u.feed_id
        WHERE u.user_id = $1"
        .to_string();
    if let Some(view) = query.view.filter(|view| *view != -1) {
        sql += &format!(" AND s.view = {}", params.bind(view));
    }
    sql += " GROUP BY u.feed_id";
    let txn = sync::snapshot(&state.db).await?;
    let statement = Statement::from_sql_and_values(DbBackend::Postgres, sql, params.0);
    let counts = FeedCount::find_by_statement(statement).all(&txn).await?;
    let last_sync_id = sync::state(&txn).await?;
    txn.commit().await?;
    let counts: BTreeMap<_, _> = counts
        .into_iter()
        .map(|row| (row.feed_id.to_string(), row.count))
        .collect();
    Ok(Json(
        json!({ "code": 0, "data": counts, "lastSyncId": last_sync_id }),
    ))
}

/// `GET /reads/total-count`
pub async fn total(State(state): State<AppState>, user: AuthUser) -> ApiResult<Json<Value>> {
    let count = unread::Entity::find()
        .filter(unread::Column::UserId.eq(user.id))
        .count(&state.db)
        .await?;
    Ok(ok(json!({ "count": count })))
}
