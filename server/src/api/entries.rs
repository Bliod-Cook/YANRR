use std::collections::HashMap;

use axum::{Json, extract::State, http::header, response::IntoResponse};
use chrono::{DateTime, Utc};
use sea_orm::{
    ColumnTrait, ConnectionTrait, DatabaseConnection, DbBackend, DbErr, EntityTrait,
    FromQueryResult, QueryFilter, QueryResult, Statement, TransactionTrait, Value as SqlValue,
};
use serde::Deserialize;
use serde_json::{Value, json};

use super::{
    error::{ApiError, ApiJson, ApiQuery, ApiResult, ExceptionCode},
    inboxes,
    response::ok,
    session::AuthUser,
};
use crate::{
    AppState,
    entity::{entry, feed, inbox, inbox_entry},
    fetch, id,
    rules::{EntrySettings, Rules, Subject},
    sync::{self, Action},
    time::iso,
    wire,
};

const PAGE_SIZE: u64 = 20;
const MAX_PAGE_SIZE: u64 = 100;

/// The user's view of entries: `e` is the entry, `s` the user's subscription to its feed, `c` the user's
/// collection of it, `u` its unread mark and `b` its block by the user's rules; `$1` is the user id.
pub const TIMELINE: &str = "FROM entries e
    LEFT JOIN subscriptions s ON s.user_id = $1 AND s.feed_id = e.feed_id
    LEFT JOIN collections c ON c.user_id = $1 AND c.entry_id = e.id
    LEFT JOIN unreads u ON u.user_id = $1 AND u.entry_id = e.id
    LEFT JOIN blocked_entries b ON b.user_id = $1 AND b.entry_id = e.id";

/// The columns of an entry and its [`Marks`] on [`TIMELINE`].
const MARKED: &str = "e.*, u.entry_id IS NULL AS read, COALESCE(s.view, c.view) AS view,
    c.created_at AS collected_at, s.title AS subscription_title, s.category";

/// The user's inbox entries, named `e` like [`TIMELINE`]'s so that cursors and order fit both; `i` is the inbox
/// and `$1` the user id. The join is the ownership check.
pub const INBOX_TIMELINE: &str =
    "FROM inbox_entries e JOIN inboxes i ON i.handle = e.inbox_handle AND i.user_id = $1";

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

    fn feed_ids(&self) -> Vec<&String> {
        self.feed_id
            .iter()
            .chain(self.feed_id_list.iter().flatten())
            .collect()
    }

    /// The timeline of everything the user follows, rather than of a feed, list, inbox or the collection.
    fn is_subscriptions(&self) -> bool {
        !self.is_collection()
            && self.list_id.is_none()
            && self.inbox_id.is_none()
            && self.feed_ids().is_empty()
    }

    /// A condition on [`TIMELINE`], or `None` when the scope covers no feed entry.
    pub fn condition(&self, params: &mut Params) -> Option<String> {
        // Lists are not supported and inboxes hold no feed entries; ignoring them would cover every entry instead.
        if self.list_id.is_some() || self.inbox_id.is_some() {
            return None;
        }
        let view = self.view.filter(|view| *view != -1);
        let feed_ids = self.feed_ids();
        let mut conditions = vec!["b.entry_id IS NULL".to_string()];
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

    /// A condition on [`INBOX_TIMELINE`], or `None` when the scope covers no inbox entry.
    pub fn inbox_condition(&self, params: &mut Params) -> Option<String> {
        match &self.inbox_id {
            Some(handle) => Some(format!("i.handle = {}", params.bind(handle.clone()))),
            None => (self.is_subscriptions() && inboxes::in_view(self.view)).then(|| "TRUE".into()),
        }
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
    /// The entry the cursor stands at, which places it among the entries of its time.
    cursor_id: Option<String>,
    sort_order: Option<String>,
    #[serde(default)]
    with_content: bool,
}

impl TimelineBody {
    fn is_ascending(&self) -> bool {
        self.sort_order.as_deref() == Some("asc")
    }

    /// Appends the cursors, read filter, order and `limit` to a query over `e` ordered by `time`; `read` is SQL
    /// telling whether an entry is read.
    ///
    /// The cursors follow the clients: `publishedAfter` pages towards older entries and `publishedBefore` towards
    /// newer ones, whatever their names say. Without `cursorId` a cursor skips every entry of its time.
    fn paginate(&self, sql: &mut String, params: &mut Params, time: &str, read: &str, limit: u64) {
        let id = self.cursor_id.as_deref().and_then(id::parse);
        for (cursor, op) in [(self.published_after, "<"), (self.published_before, ">")] {
            let Some(cursor) = cursor else { continue };
            let cursor = params.bind(cursor);
            *sql += &match id {
                Some(id) => format!(" AND ({time}, e.id) {op} ({cursor}, {})", params.bind(id)),
                None => format!(" AND {time} {op} {cursor}"),
            };
        }
        match self.read {
            Some(false) => *sql += &format!(" AND NOT ({read})"),
            Some(true) => *sql += &format!(" AND ({read})"),
            None => {}
        }
        let order = if self.is_ascending() { "ASC" } else { "DESC" };
        *sql += &format!(" ORDER BY {time} {order}, e.id {order} LIMIT {limit}");
    }
}

/// A timeline item and the time it is ordered by.
struct Item {
    time: DateTime<Utc>,
    id: i64,
    data: Value,
}

/// What the user did with an entry: read it, follows its feed or collected it.
#[derive(FromQueryResult)]
pub(super) struct Marks {
    read: bool,
    view: Option<i16>,
    collected_at: Option<DateTime<Utc>>,
    subscription_title: Option<String>,
    category: Option<String>,
}

impl Marks {
    /// The entry as the user's rules see it.
    pub(super) fn subject<'a>(
        &'a self,
        feed: &'a feed::Model,
        entry: &'a entry::Model,
    ) -> Subject<'a> {
        Subject {
            feed,
            entry,
            view: self.view,
            title: self.subscription_title.as_deref(),
            category: self.category.as_deref(),
            read: self.read,
            collected: self.collected_at.is_some(),
        }
    }
}

/// An entry and its marks from a row selecting [`MARKED`].
fn marked(row: &QueryResult) -> Result<(entry::Model, Marks), DbErr> {
    let entry = entry::Model::from_query_result(row, "")?;
    Ok((entry, Marks::from_query_result(row, "")?))
}

/// The entry and what the user did with it, or `None` if there is no such entry.
pub(super) async fn find_marked(
    db: &impl ConnectionTrait,
    user_id: &str,
    id: i64,
) -> Result<Option<(entry::Model, Marks)>, DbErr> {
    let sql = format!("SELECT {MARKED} {TIMELINE} WHERE e.id = $2");
    let values = [user_id.into(), id.into()];
    let statement = Statement::from_sql_and_values(DbBackend::Postgres, sql, values);
    db.query_one_raw(statement)
        .await?
        .as_ref()
        .map(marked)
        .transpose()
}

async fn feeds(
    db: &DatabaseConnection,
    ids: impl IntoIterator<Item = i64>,
) -> Result<HashMap<i64, feed::Model>, DbErr> {
    let feeds = feed::Entity::find()
        .filter(feed::Column::Id.is_in(ids))
        .all(db)
        .await?;
    Ok(feeds.into_iter().map(|feed| (feed.id, feed)).collect())
}

/// The entry as the user's rules show it, rewritten, and what they do to it.
fn personalize(
    rules: &Rules,
    feed: &feed::Model,
    mut entry: entry::Model,
    marks: &Marks,
) -> (entry::Model, Option<EntrySettings>) {
    let settings = rules.apply(&marks.subject(feed, &entry));
    if let Some(settings) = &settings {
        settings.rewrite(&mut entry);
    }
    (entry, settings)
}

/// `POST /entries`, and `POST /entries/inbox` with an `inboxId`: a page of the timeline. Feed entries and inbox
/// entries are each paged on their own, then merged.
pub async fn timeline(
    State(state): State<AppState>,
    user: AuthUser,
    ApiJson(body): ApiJson<TimelineBody>,
) -> ApiResult<Json<Value>> {
    let limit = body.limit.unwrap_or(PAGE_SIZE).clamp(1, MAX_PAGE_SIZE);
    let mut items = feed_items(&state.db, &user.id, &body, limit).await?;
    items.extend(inbox_items(&state.db, &user.id, &body, limit).await?);
    items.sort_by_key(|item| (item.time, item.id));
    if !body.is_ascending() {
        items.reverse();
    }
    items.truncate(limit as usize);
    let data: Vec<_> = items.into_iter().map(|item| item.data).collect();
    Ok(ok(data))
}

/// Feed entries of the timeline; collections page by the time they were collected.
async fn feed_items(
    db: &DatabaseConnection,
    user_id: &str,
    body: &TimelineBody,
    limit: u64,
) -> Result<Vec<Item>, DbErr> {
    let mut params = Params(vec![user_id.into()]);
    let Some(scope) = body.scope.condition(&mut params) else {
        return Ok(Vec::new());
    };
    let time = match body.scope.is_collection() {
        true => "c.created_at",
        false => "e.published_at",
    };
    let mut sql = format!("SELECT {MARKED}, {time} AS time {TIMELINE} WHERE {scope}");
    body.paginate(&mut sql, &mut params, time, "u.entry_id IS NULL", limit);

    let statement = Statement::from_sql_and_values(DbBackend::Postgres, sql, params.0);
    let rows = db.query_all_raw(statement).await?;
    let mut entries = Vec::new();
    for row in &rows {
        let time: DateTime<Utc> = row.try_get("", "time")?;
        entries.push((marked(row)?, time));
    }
    let feeds = feeds(db, entries.iter().map(|((entry, _), _)| entry.feed_id)).await?;
    let rules = Rules::load(db, user_id).await?;
    let items = entries
        .into_iter()
        .map(|((entry, marks), time)| {
            let feed = &feeds[&entry.feed_id];
            let (entry, settings) = personalize(&rules, feed, entry, &marks);
            let id = entry.id;
            let mut data = json!({
                "read": marks.read,
                "view": marks.view.or(body.scope.view).unwrap_or(0),
                "from": ["feed"],
                "feeds": wire::Feed::from(feed),
                "entries": wire::Entry::new(entry, body.with_content),
            });
            // Clients drop their star when the key is missing; `null` would keep it.
            if let Some(collected_at) = marks.collected_at {
                data["collections"] = json!({ "createdAt": iso(collected_at) });
            }
            if let Some(settings) = settings {
                data["settings"] = json!(settings);
            }
            Item { time, id, data }
        })
        .collect();
    Ok(items)
}

/// Inbox entries of the timeline, which cannot be collected.
async fn inbox_items(
    db: &DatabaseConnection,
    user_id: &str,
    body: &TimelineBody,
    limit: u64,
) -> Result<Vec<Item>, DbErr> {
    let mut params = Params(vec![user_id.into()]);
    let Some(scope) = body.scope.inbox_condition(&mut params) else {
        return Ok(Vec::new());
    };
    let mut sql = format!("SELECT e.* {INBOX_TIMELINE} WHERE {scope}");
    body.paginate(&mut sql, &mut params, "e.published_at", "e.read", limit);

    let statement = Statement::from_sql_and_values(DbBackend::Postgres, sql, params.0);
    let entries = inbox_entry::Model::find_by_statement(statement)
        .all(db)
        .await?;
    let inboxes: HashMap<_, _> = inbox::Entity::find()
        .filter(inbox::Column::UserId.eq(user_id))
        .all(db)
        .await?
        .into_iter()
        .map(|inbox| (inbox.handle.clone(), inbox))
        .collect();
    let items = entries
        .into_iter()
        .map(|entry| Item {
            time: entry.published_at,
            id: entry.id,
            data: json!({
                "read": entry.read,
                "view": 0,
                "from": ["inbox"],
                "feeds": wire::Inbox::from(&inboxes[&entry.inbox_handle]),
                "entries": wire::InboxEntry::new(entry, body.with_content),
            }),
        })
        .collect();
    Ok(items)
}

#[derive(Deserialize)]
pub struct EntryQuery {
    id: String,
}

/// `GET /entries`: one entry with its content, or `null` if there is no such entry.
pub async fn get(
    State(state): State<AppState>,
    user: AuthUser,
    ApiQuery(query): ApiQuery<EntryQuery>,
) -> ApiResult<Json<Value>> {
    let Some(id) = id::parse(&query.id) else {
        return Ok(ok(Value::Null));
    };
    let Some((entry, marks)) = find_marked(&state.db, &user.id, id).await? else {
        return Ok(ok(Value::Null));
    };
    let Some(feed) = feed::Entity::find_by_id(entry.feed_id)
        .one(&state.db)
        .await?
    else {
        return Ok(ok(Value::Null));
    };
    let rules = Rules::load(&state.db, &user.id).await?;
    let (entry, settings) = personalize(&rules, &feed, entry, &marks);
    let mut data =
        json!({ "feeds": wire::Feed::from(&feed), "entries": wire::Entry::new(entry, true) });
    if let Some(settings) = settings {
        data["settings"] = json!(settings);
    }
    Ok(ok(data))
}

#[derive(Deserialize)]
pub struct StreamBody {
    ids: Vec<String>,
}

/// The text of a feed or inbox entry.
pub(super) struct EntryText {
    pub id: i64,
    pub title: Option<String>,
    pub url: Option<String>,
    pub description: Option<String>,
    pub content: Option<String>,
}

impl From<entry::Model> for EntryText {
    fn from(entry: entry::Model) -> Self {
        Self {
            id: entry.id,
            title: entry.title,
            url: entry.url,
            description: entry.description,
            content: entry.content,
        }
    }
}

impl From<inbox_entry::Model> for EntryText {
    fn from(entry: inbox_entry::Model) -> Self {
        Self {
            id: entry.id,
            title: entry.title,
            url: entry.url,
            description: entry.description,
            content: entry.content,
        }
    }
}

/// The feed and inbox entries among `ids` as the user reads them: feed entries rewritten by the user's rules, and
/// only the user's own inbox entries.
pub(super) async fn texts(
    db: &DatabaseConnection,
    user_id: &str,
    ids: &[i64],
) -> Result<Vec<EntryText>, DbErr> {
    let sql = format!("SELECT {MARKED} {TIMELINE} WHERE e.id = ANY($2)");
    let values = [user_id.into(), ids.to_vec().into()];
    let statement = Statement::from_sql_and_values(DbBackend::Postgres, sql, values);
    let rows = db.query_all_raw(statement).await?;
    let entries = rows.iter().map(marked).collect::<Result<Vec<_>, _>>()?;
    let feeds = feeds(db, entries.iter().map(|(entry, _)| entry.feed_id)).await?;
    let rules = Rules::load(db, user_id).await?;
    let mut texts: Vec<EntryText> = entries
        .into_iter()
        .map(|(entry, marks)| personalize(&rules, &feeds[&entry.feed_id], entry, &marks).0)
        .map(EntryText::from)
        .collect();
    // Rules do not apply to inbox entries.
    let sql = format!("SELECT e.* {INBOX_TIMELINE} WHERE e.id = ANY($2)");
    let values = [user_id.into(), ids.to_vec().into()];
    let statement = Statement::from_sql_and_values(DbBackend::Postgres, sql, values);
    let inbox_entries = inbox_entry::Model::find_by_statement(statement)
        .all(db)
        .await?;
    texts.extend(inbox_entries.into_iter().map(EntryText::from));
    Ok(texts)
}

/// `POST /entries/stream`: the content of each feed or inbox entry that has one, as NDJSON lines of
/// `{ id, content }`.
pub async fn stream(
    State(state): State<AppState>,
    user: AuthUser,
    ApiJson(body): ApiJson<StreamBody>,
) -> ApiResult<impl IntoResponse> {
    let ids: Vec<_> = body.ids.iter().filter_map(|id| id::parse(id)).collect();
    let lines: String = texts(&state.db, &user.id, &ids)
        .await?
        .into_iter()
        .filter_map(|entry| {
            let line = json!({ "id": entry.id.to_string(), "content": entry.content? });
            Some(line.to_string() + "\n")
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

/// `GET /entries/inbox`: one of the user's inbox entries with its content, or `null`.
pub async fn get_inbox_entry(
    State(state): State<AppState>,
    user: AuthUser,
    ApiQuery(query): ApiQuery<EntryQuery>,
) -> ApiResult<Json<Value>> {
    let Some(id) = id::parse(&query.id) else {
        return Ok(ok(Value::Null));
    };
    let sql = format!("SELECT e.* {INBOX_TIMELINE} WHERE e.id = $2");
    let statement =
        Statement::from_sql_and_values(DbBackend::Postgres, sql, [user.id.into(), id.into()]);
    let Some(entry) = inbox_entry::Model::find_by_statement(statement)
        .one(&state.db)
        .await?
    else {
        return Ok(ok(Value::Null));
    };
    let inbox = inbox::Entity::find_by_id(&entry.inbox_handle)
        .one(&state.db)
        .await?;
    let data = inbox.map(|inbox| {
        json!({ "feeds": wire::Inbox::from(&inbox), "entries": wire::InboxEntry::new(entry, true) })
    });
    Ok(ok(data))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteInboxEntryBody {
    entry_id: String,
}

/// `DELETE /entries/inbox`
pub async fn delete_inbox_entry(
    State(state): State<AppState>,
    user: AuthUser,
    ApiJson(body): ApiJson<DeleteInboxEntryBody>,
) -> ApiResult<Json<Value>> {
    let id = id::parse(&body.entry_id).ok_or_else(ApiError::entry_not_found)?;
    let sql = format!(
        "DELETE FROM inbox_entries WHERE id IN (SELECT e.id {INBOX_TIMELINE} WHERE e.id = $2)
        RETURNING inbox_handle, read"
    );
    let values = [user.id.clone().into(), id.into()];
    let txn = state.db.begin().await?;
    let deleted = txn
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            sql,
            values,
        ))
        .await?
        .ok_or_else(ApiError::entry_not_found)?;
    let handle: String = deleted.try_get("", "inbox_handle")?;
    let read: bool = deleted.try_get("", "read")?;
    let action = Action {
        user_id: user.id,
        model: "inbox_entry",
        model_id: Some(id.to_string()),
        action: "D",
        data: json!({ "inboxId": handle, "unread": !read }),
    };
    let last_sync_id = sync::record(&txn, vec![action]).await?;
    txn.commit().await?;
    Ok(Json(
        json!({ "code": 0, "data": null, "lastSyncId": last_sync_id }),
    ))
}
