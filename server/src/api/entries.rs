use std::{
    collections::{HashMap, HashSet},
    time::Duration,
};

use axum::{Json, extract::State, http::header, response::IntoResponse};
use chrono::{DateTime, Utc};
use sea_orm::{
    ColumnTrait, ConnectionTrait, DatabaseConnection, DbBackend, DbErr, EntityTrait,
    FromQueryResult, IdenStatic, Iterable, QueryFilter, QueryResult, Statement, TransactionTrait,
    TryGetable, Value as SqlValue,
};
use serde::Deserialize;
use serde_json::{Value, json};

use super::{
    error::{ApiError, ApiJson, ApiQuery, ApiResult, ExceptionCode, single_view},
    inboxes,
    response::ok,
    session::AuthUser,
};
use crate::{
    AppState,
    entity::{entry, feed, inbox, inbox_entry},
    fetch, id,
    rules::{EntrySettings, Rules, Subject},
    search,
    sync::{self, Action},
    time::iso,
    wire,
};

const PAGE_SIZE: u64 = 20;
const MAX_PAGE_SIZE: u64 = 100;
/// How long a search may take before the client is told to try again.
pub(super) const SEARCH_TIME: Duration = Duration::from_secs(1);

/// The user's view of entries: `e` is the entry, `s` the user's subscription to its feed, `c` the user's
/// collection of it, `u` its unread mark and `b` its block by the user's rules; `$1` is the user id.
pub const TIMELINE: &str = "FROM entries e
    LEFT JOIN subscriptions s ON s.user_id = $1 AND s.feed_id = e.feed_id
    LEFT JOIN collections c ON c.user_id = $1 AND c.entry_id = e.id
    LEFT JOIN unreads u ON u.user_id = $1 AND u.entry_id = e.id
    LEFT JOIN blocked_entries b ON b.user_id = $1 AND b.entry_id = e.id";

/// The [`Marks`] of an entry on [`TIMELINE`].
const MARKS: &str = "u.entry_id IS NULL AS read, COALESCE(s.view, c.view) AS view,
    c.created_at AS collected_at, c.view AS collected_view, s.title AS subscription_title, s.category";

/// The user's inbox entries, named `e` like [`TIMELINE`]'s so that cursors and order fit both; `i` is the inbox
/// and `$1` the user id. The join is the ownership check.
pub const INBOX_TIMELINE: &str =
    "FROM inbox_entries e JOIN inboxes i ON i.handle = e.inbox_handle AND i.user_id = $1";

/// `columns` of `e`, with a null content unless `content`: timelines rarely show it, and it is the largest one.
fn entry_columns(columns: impl Iterator<Item = impl IdenStatic>, content: bool) -> String {
    let columns: Vec<_> = columns
        .map(|column| match column.as_str() {
            "content" if !content => "NULL AS content".to_string(),
            name => format!("e.{name}"),
        })
        .collect();
    columns.join(", ")
}

/// The columns of an entry, with its content only if `content`, and its [`Marks`] on [`TIMELINE`].
pub(super) fn marked_columns(content: bool) -> String {
    format!("{}, {MARKS}", entry_columns(entry::Column::iter(), content))
}

/// The columns of an inbox entry on [`INBOX_TIMELINE`], with its content only if `content`, and of its inbox as
/// `i_<column>`.
fn inboxed_columns(content: bool) -> String {
    let entry = entry_columns(inbox_entry::Column::iter(), content);
    let inbox: Vec<_> = inbox::Column::iter()
        .map(|column| format!("i.{0} AS i_{0}", column.as_str()))
        .collect();
    format!("{entry}, {}", inbox.join(", "))
}

/// An inbox entry and its inbox from a row selecting [`inboxed_columns`].
fn inboxed(row: &QueryResult) -> Result<(inbox_entry::Model, inbox::Model), DbErr> {
    let entry = inbox_entry::Model::from_query_result(row, "")?;
    Ok((entry, inbox::Model::from_query_result(row, "i_")?))
}

/// Values bound to a statement as `$1`, `$2`, …
pub struct Params(pub Vec<SqlValue>);

impl Params {
    pub fn bind(&mut self, value: impl Into<SqlValue>) -> String {
        self.0.push(value.into());
        format!("${}", self.0.len())
    }
}

/// The entries a timeline, or marking it all read, covers; none is no scope at all.
#[derive(Default, Deserialize)]
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
        let view = single_view(self.view);
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

    /// No scope at all: a search then covers every entry the user may read, of hidden feeds too.
    fn is_everything(&self) -> bool {
        self.is_subscriptions() && self.view.is_none()
    }
}

impl search::Scope for Scope {
    /// Where a search of the scope looks in the index for what [`Self::readable`] keeps, or `None` when nowhere;
    /// it follows [`Self::condition`] and then [`Self::inbox_condition`].
    async fn within(
        &self,
        db: &DatabaseConnection,
        user_id: &str,
    ) -> Result<Option<search::Within>, DbErr> {
        let view = single_view(self.view);
        let mut params = Params(vec![user_id.into()]);
        let mut sources = Vec::new();
        if self.list_id.is_none() && self.inbox_id.is_none() {
            if self.is_collection() {
                let mut sql = "SELECT entry_id FROM collections WHERE user_id = $1".to_string();
                if let Some(view) = view {
                    sql += &format!(" AND view = {}", params.bind(view));
                }
                let ids: Vec<i64> = column(db, sql, params, "entry_id").await?;
                let ids = ids.into_iter().map(|id| id as u64).collect();
                return Ok(Some(search::Within::Entries(ids)));
            }
            let feed_ids = self.feed_ids();
            if !feed_ids.is_empty() {
                let feeds = feed_ids.into_iter().filter_map(|id| id::parse(id));
                let sources = feeds.map(|id| format!("f{id}")).collect();
                return Ok(Some(search::Within::Sources(sources)));
            }
            let mut sql =
                "SELECT 'f' || feed_id AS source FROM subscriptions WHERE user_id = $1".to_string();
            if !self.is_everything() {
                sql += " AND hide_from_timeline IS NOT TRUE";
            }
            if let Some(view) = view {
                sql += &format!(" AND view = {}", params.bind(view));
            }
            sources.push(sql);
        }
        let own_inboxes = "SELECT 'i' || handle AS source FROM inboxes WHERE user_id = $1";
        match &self.inbox_id {
            Some(handle) => sources.push(format!(
                "{own_inboxes} AND handle = {}",
                params.bind(handle.clone())
            )),
            None if self.is_subscriptions() && inboxes::in_view(self.view) => {
                sources.push(own_inboxes.into())
            }
            None => {}
        }
        if sources.is_empty() {
            return Ok(None);
        }
        let sources = column(db, sources.join(" UNION ALL "), params, "source").await?;
        Ok(Some(search::Within::Sources(sources)))
    }

    /// Of `ids`, the entries a search of the scope finds: those its timeline lists, or without a scope those of
    /// a feed the user follows and not blocked for them, and of their inboxes.
    async fn readable(
        &self,
        db: &DatabaseConnection,
        user_id: &str,
        ids: &[i64],
    ) -> Result<HashSet<i64>, DbErr> {
        let mut params = Params(vec![user_id.into(), ids.to_vec().into()]);
        let (feeds, inboxes) = match self.is_everything() {
            true => (
                Some("s.feed_id IS NOT NULL AND b.entry_id IS NULL".into()),
                Some("TRUE".into()),
            ),
            false => (
                self.condition(&mut params),
                self.inbox_condition(&mut params),
            ),
        };
        let selects: Vec<String> = [(TIMELINE, feeds), (INBOX_TIMELINE, inboxes)]
            .into_iter()
            .filter_map(|(from, condition)| {
                Some(format!(
                    "SELECT e.id {from} WHERE e.id = ANY($2) AND {}",
                    condition?
                ))
            })
            .collect();
        let ids: Vec<i64> = column(db, selects.join(" UNION ALL "), params, "id").await?;
        Ok(ids.into_iter().collect())
    }
}

/// The column `name` of the rows `sql` selects.
pub(super) async fn column<T: TryGetable>(
    db: &impl ConnectionTrait,
    sql: String,
    params: Params,
    name: &str,
) -> Result<Vec<T>, DbErr> {
    let statement = Statement::from_sql_and_values(DbBackend::Postgres, sql, params.0);
    db.query_all_raw(statement)
        .await?
        .iter()
        .map(|row| row.try_get("", name))
        .collect()
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
    /// Searches the entries the scope's timeline lists, or without a scope every entry the user may read; most
    /// terms in the title first, then newest. Pages by `cursorId` alone.
    keyword: Option<String>,
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
    pub(super) read: bool,
    view: Option<i16>,
    pub(super) collected_at: Option<DateTime<Utc>>,
    collected_view: Option<i16>,
    pub(super) subscription_title: Option<String>,
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

/// An entry and its marks from a row selecting [`marked_columns`].
pub(super) fn marked(row: &QueryResult) -> Result<(entry::Model, Marks), DbErr> {
    let entry = entry::Model::from_query_result(row, "")?;
    Ok((entry, Marks::from_query_result(row, "")?))
}

/// The entry with its content and what the user did with it, or `None` if there is no such entry.
pub(super) async fn find_marked(
    db: &impl ConnectionTrait,
    user_id: &str,
    id: i64,
) -> Result<Option<(entry::Model, Marks)>, DbErr> {
    let sql = format!("SELECT {} {TIMELINE} WHERE e.id = $2", marked_columns(true));
    let values = [user_id.into(), id.into()];
    let statement = Statement::from_sql_and_values(DbBackend::Postgres, sql, values);
    db.query_one_raw(statement)
        .await?
        .as_ref()
        .map(marked)
        .transpose()
}

pub(super) async fn feeds(
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
pub(super) fn personalize(
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
/// entries are each paged on their own, then merged. With a `keyword`, a page of the entries matching it.
pub async fn timeline(
    State(state): State<AppState>,
    user: AuthUser,
    ApiJson(body): ApiJson<TimelineBody>,
) -> ApiResult<Json<Value>> {
    let limit = body.limit.unwrap_or(PAGE_SIZE).clamp(1, MAX_PAGE_SIZE);
    if let Some(keyword) = &body.keyword {
        let found = found(&state, &user.id, &body, keyword, limit);
        return tokio::time::timeout(SEARCH_TIME, found)
            .await
            .map_err(|_| ApiError::timeout())?;
    }
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

/// The entries matching `keyword` that come after the body's cursor, as timeline items with where they matched.
async fn found(
    state: &AppState,
    user_id: &str,
    body: &TimelineBody,
    keyword: &str,
    limit: u64,
) -> ApiResult<Json<Value>> {
    let after = body.cursor_id.as_deref().and_then(id::parse);
    let find = search::find(
        &state.db,
        &state.search,
        user_id,
        keyword,
        &body.scope,
        after,
        limit as usize,
    );
    let found = find.await.map_err(|err| {
        tracing::error!("search failed: {err}");
        ApiError::internal()
    })?;
    let ids: Vec<i64> = found.iter().map(|found| found.id).collect();
    let values = || [user_id.into(), ids.clone().into()];
    let rules = Rules::load(&state.db, user_id).await?;
    let columns = marked_columns(body.with_content || rules.reads_content());
    let sql = format!("SELECT {columns}, e.published_at AS time {TIMELINE} WHERE e.id = ANY($2)");
    let statement = Statement::from_sql_and_values(DbBackend::Postgres, sql, values());
    let view = body.scope.view;
    let mut items = feed_items_from(&state.db, &rules, statement, view, body.with_content).await?;
    let columns = inboxed_columns(body.with_content);
    let sql = format!("SELECT {columns} {INBOX_TIMELINE} WHERE e.id = ANY($2)");
    let statement = Statement::from_sql_and_values(DbBackend::Postgres, sql, values());
    items.extend(inbox_items_from(&state.db, statement, body.with_content).await?);
    let mut places: HashMap<i64, (usize, search::Highlight)> = found
        .into_iter()
        .enumerate()
        .map(|(place, found)| (found.id, (place, found.highlight)))
        .collect();
    let mut placed: Vec<(usize, Value)> = items
        .into_iter()
        .map(|mut item| {
            let (place, highlight) = places.remove(&item.id).expect("the item was found");
            item.data["highlight"] = json!(highlight);
            (place, item.data)
        })
        .collect();
    placed.sort_by_key(|(place, _)| *place);
    let data: Vec<_> = placed.into_iter().map(|(_, data)| data).collect();
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
    let rules = Rules::load(db, user_id).await?;
    let columns = marked_columns(body.with_content || rules.reads_content());
    let mut sql = format!("SELECT {columns}, {time} AS time {TIMELINE} WHERE {scope}");
    body.paginate(&mut sql, &mut params, time, "u.entry_id IS NULL", limit);
    let statement = Statement::from_sql_and_values(DbBackend::Postgres, sql, params.0);
    feed_items_from(db, &rules, statement, body.scope.view, body.with_content).await
}

/// Items of the feed entries `statement` selects with [`marked_columns`] and the `time` they are ordered by, as
/// the user's `rules` show them; `view` is the one of entries the user neither follows nor collected.
async fn feed_items_from(
    db: &DatabaseConnection,
    rules: &Rules,
    statement: Statement,
    view: Option<i16>,
    with_content: bool,
) -> Result<Vec<Item>, DbErr> {
    let rows = db.query_all_raw(statement).await?;
    let mut entries = Vec::new();
    for row in &rows {
        let time: DateTime<Utc> = row.try_get("", "time")?;
        entries.push((marked(row)?, time));
    }
    let feeds = feeds(db, entries.iter().map(|((entry, _), _)| entry.feed_id)).await?;
    let items = entries
        .into_iter()
        .map(|((entry, marks), time)| {
            let feed = &feeds[&entry.feed_id];
            let (entry, settings) = personalize(rules, feed, entry, &marks);
            let id = entry.id;
            let mut data = json!({
                "read": marks.read,
                "view": marks.view.or(view).unwrap_or(0),
                "from": ["feed"],
                "feeds": wire::Feed::from(feed),
                "entries": wire::Entry::new(entry, with_content),
            });
            // Clients drop their star when the key is missing; `null` would keep it.
            if let Some(collected_at) = marks.collected_at {
                data["collections"] =
                    json!({ "createdAt": iso(collected_at), "view": marks.collected_view });
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
    let columns = inboxed_columns(body.with_content);
    let mut sql = format!("SELECT {columns} {INBOX_TIMELINE} WHERE {scope}");
    body.paginate(&mut sql, &mut params, "e.published_at", "e.read", limit);
    let statement = Statement::from_sql_and_values(DbBackend::Postgres, sql, params.0);
    inbox_items_from(db, statement, body.with_content).await
}

/// Items of the inbox entries `statement` selects with [`inboxed_columns`].
async fn inbox_items_from(
    db: &DatabaseConnection,
    statement: Statement,
    with_content: bool,
) -> Result<Vec<Item>, DbErr> {
    let rows = db.query_all_raw(statement).await?;
    rows.iter()
        .map(|row| {
            let (entry, inbox) = inboxed(row)?;
            Ok(Item {
                time: entry.published_at,
                id: entry.id,
                data: json!({
                    "read": entry.read,
                    "view": 0,
                    "from": ["inbox"],
                    "feeds": wire::Inbox::from(&inbox),
                    "entries": wire::InboxEntry::new(entry, with_content),
                }),
            })
        })
        .collect()
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
    let mut data = json!({
        "read": marks.read,
        "feeds": wire::Feed::from(&feed),
        "entries": wire::Entry::new(entry, true),
    });
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
    let sql = format!(
        "SELECT {} {TIMELINE} WHERE e.id = ANY($2)",
        marked_columns(true)
    );
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
    let sql = format!(
        "SELECT {} {INBOX_TIMELINE} WHERE e.id = $2",
        inboxed_columns(true)
    );
    let statement =
        Statement::from_sql_and_values(DbBackend::Postgres, sql, [user.id.into(), id.into()]);
    let Some(row) = state.db.query_one_raw(statement).await? else {
        return Ok(ok(Value::Null));
    };
    let (entry, inbox) = inboxed(&row)?;
    let data = json!({ "feeds": wire::Inbox::from(&inbox), "entries": wire::InboxEntry::new(entry, true) });
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
