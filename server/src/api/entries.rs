use std::collections::HashMap;

use axum::{Json, extract::State, http::header, response::IntoResponse};
use chrono::{DateTime, Utc};
use sea_orm::{
    ColumnTrait, ConnectionTrait, DbBackend, EntityTrait, FromQueryResult, QueryFilter, Statement,
    Value as SqlValue,
};
use serde::Deserialize;
use serde_json::{Value, json};

use super::{
    error::{ApiError, ApiJson, ApiQuery, ApiResult, ExceptionCode},
    response::ok,
    session::AuthUser,
};
use crate::{
    AppState,
    entity::{entry, feed},
    fetch, id,
    time::iso,
    wire,
};

const PAGE_SIZE: u64 = 20;
const MAX_PAGE_SIZE: u64 = 100;

/// The user's view of entries: `e` is the entry, `s` the user's subscription to its feed, `c` the user's
/// collection of it and `u` its unread mark; `$1` is the user id.
pub const TIMELINE: &str = "FROM entries e
    LEFT JOIN subscriptions s ON s.user_id = $1 AND s.feed_id = e.feed_id
    LEFT JOIN collections c ON c.user_id = $1 AND c.entry_id = e.id
    LEFT JOIN unreads u ON u.user_id = $1 AND u.entry_id = e.id";

/// Values bound to a statement as `$1`, `$2`, …
pub struct Params(pub Vec<SqlValue>);

impl Params {
    pub fn bind(&mut self, value: impl Into<SqlValue>) -> String {
        self.0.push(value.into());
        format!("${}", self.0.len())
    }
}

/// The entries a timeline, or marking it all read, covers.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Scope {
    view: Option<i16>,
    feed_id: Option<String>,
    feed_id_list: Option<Vec<String>>,
    is_collection: Option<bool>,
    list_id: Option<String>,
    inbox_id: Option<String>,
}

impl Scope {
    fn is_collection(&self) -> bool {
        self.is_collection == Some(true)
    }

    /// A condition on [`TIMELINE`], or `None` when the scope covers nothing.
    pub fn condition(&self, params: &mut Params) -> Option<String> {
        // Lists and inboxes are not supported; ignoring them would cover every entry instead.
        if self.list_id.is_some() || self.inbox_id.is_some() {
            return None;
        }
        let view = self.view.filter(|view| *view != -1);
        let feed_ids: Vec<_> = self
            .feed_id
            .iter()
            .chain(self.feed_id_list.iter().flatten())
            .collect();
        let mut conditions = Vec::new();
        if self.is_collection() {
            conditions.push("c.entry_id IS NOT NULL".to_string());
            conditions.extend(view.map(|view| format!("c.view = {}", params.bind(view))));
        } else if !feed_ids.is_empty() {
            // Any feed, followed or not, so feeds can be previewed.
            let feed_ids: Vec<_> = feed_ids
                .into_iter()
                .filter_map(|id| id::parse(id))
                .collect();
            conditions.push(format!("e.feed_id = ANY({})", params.bind(feed_ids)));
        } else {
            conditions.push("s.feed_id IS NOT NULL AND s.hide_from_timeline IS NOT TRUE".into());
            conditions.extend(view.map(|view| format!("s.view = {}", params.bind(view))));
        }
        Some(conditions.join(" AND "))
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineBody {
    #[serde(flatten)]
    scope: Scope,
    read: Option<bool>,
    limit: Option<u64>,
    published_after: Option<DateTime<Utc>>,
    published_before: Option<DateTime<Utc>>,
    sort_order: Option<String>,
    #[serde(default)]
    with_content: bool,
}

#[derive(FromQueryResult)]
struct Marks {
    read: bool,
    view: Option<i16>,
    collected_at: Option<DateTime<Utc>>,
}

/// `POST /entries`: a page of the timeline.
///
/// The cursors follow the clients: `publishedAfter` pages towards older entries and `publishedBefore` towards
/// newer ones, whatever their names say. Collections page by the time they were collected.
pub async fn timeline(
    State(state): State<AppState>,
    user: AuthUser,
    ApiJson(body): ApiJson<TimelineBody>,
) -> ApiResult<Json<Value>> {
    let mut params = Params(vec![user.id.into()]);
    let Some(scope) = body.scope.condition(&mut params) else {
        return Ok(ok(json!([])));
    };
    let time = match body.scope.is_collection() {
        true => "c.created_at",
        false => "e.published_at",
    };
    let mut sql = format!(
        "SELECT e.*, u.entry_id IS NULL AS read, COALESCE(s.view, c.view) AS view,
            c.created_at AS collected_at
        {TIMELINE} WHERE {scope}"
    );
    if let Some(cursor) = body.published_after {
        sql += &format!(" AND {time} < {}", params.bind(cursor));
    }
    if let Some(cursor) = body.published_before {
        sql += &format!(" AND {time} > {}", params.bind(cursor));
    }
    match body.read {
        Some(false) => sql += " AND u.entry_id IS NOT NULL",
        Some(true) => sql += " AND u.entry_id IS NULL",
        None => {}
    }
    let order = match body.sort_order.as_deref() {
        Some("asc") => "ASC",
        _ => "DESC",
    };
    let limit = body.limit.unwrap_or(PAGE_SIZE).clamp(1, MAX_PAGE_SIZE);
    sql += &format!(" ORDER BY {time} {order}, e.id {order} LIMIT {limit}");

    let statement = Statement::from_sql_and_values(DbBackend::Postgres, sql, params.0);
    let rows = state.db.query_all_raw(statement).await?;
    let mut items = Vec::new();
    for row in &rows {
        let entry = entry::Model::from_query_result(row, "")?;
        items.push((entry, Marks::from_query_result(row, "")?));
    }
    let feed_ids = items.iter().map(|(entry, _)| entry.feed_id);
    let feeds: HashMap<_, _> = feed::Entity::find()
        .filter(feed::Column::Id.is_in(feed_ids))
        .all(&state.db)
        .await?
        .into_iter()
        .map(|feed| (feed.id, feed))
        .collect();
    let data: Vec<_> = items
        .into_iter()
        .map(|(entry, marks)| {
            let mut item = json!({
                "read": marks.read,
                "view": marks.view.or(body.scope.view).unwrap_or(0),
                "from": ["feed"],
                "feeds": wire::Feed::from(&feeds[&entry.feed_id]),
                "entries": wire::Entry::new(entry, body.with_content),
            });
            // Clients drop their star when the key is missing; `null` would keep it.
            if let Some(collected_at) = marks.collected_at {
                item["collections"] = json!({ "createdAt": iso(collected_at) });
            }
            item
        })
        .collect();
    Ok(ok(data))
}

#[derive(Deserialize)]
pub struct EntryQuery {
    id: String,
}

/// `GET /entries`: one entry with its content, or `null` if there is no such entry.
pub async fn get(
    State(state): State<AppState>,
    _user: AuthUser,
    ApiQuery(query): ApiQuery<EntryQuery>,
) -> ApiResult<Json<Value>> {
    let Some(id) = id::parse(&query.id) else {
        return Ok(ok(Value::Null));
    };
    let found = entry::Entity::find_by_id(id)
        .find_also_related(feed::Entity)
        .one(&state.db)
        .await?;
    let data = found.and_then(|(entry, feed)| {
        let feed = feed?;
        Some(json!({ "feeds": wire::Feed::from(&feed), "entries": wire::Entry::new(entry, true) }))
    });
    Ok(ok(data))
}

#[derive(Deserialize)]
pub struct StreamBody {
    ids: Vec<String>,
}

/// `POST /entries/stream`: the content of each entry that has one, as NDJSON lines of `{ id, content }`.
pub async fn stream(
    State(state): State<AppState>,
    _user: AuthUser,
    ApiJson(body): ApiJson<StreamBody>,
) -> ApiResult<impl IntoResponse> {
    let ids = body.ids.iter().filter_map(|id| id::parse(id));
    let entries = entry::Entity::find()
        .filter(entry::Column::Id.is_in(ids))
        .filter(entry::Column::Content.is_not_null())
        .all(&state.db)
        .await?;
    let lines: String = entries
        .into_iter()
        .map(|entry| {
            json!({ "id": entry.id.to_string(), "content": entry.content }).to_string() + "\n"
        })
        .collect();
    Ok(([(header::CONTENT_TYPE, "application/x-ndjson")], lines))
}

/// `GET /entries/readability`: the readable part of the entry's web page.
pub async fn readability(
    State(state): State<AppState>,
    _user: AuthUser,
    ApiQuery(query): ApiQuery<EntryQuery>,
) -> ApiResult<Json<Value>> {
    let id = id::parse(&query.id).ok_or_else(ApiError::entry_not_found)?;
    let entry = entry::Entity::find_by_id(id)
        .one(&state.db)
        .await?
        .ok_or_else(ApiError::entry_not_found)?;
    let url = entry
        .url
        .ok_or_else(|| ApiError::new(ExceptionCode::FeedFetchError, "The entry has no URL"))?;
    let content = fetch::readability::extract(&state, &url).await?;
    Ok(ok(json!({ "content": content })))
}
