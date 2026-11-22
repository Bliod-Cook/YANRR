//! The tools. They show entries as the user's timeline does, rewritten by their rules and without blocked ones, and
//! leave inboxes out.

use std::{
    collections::{HashMap, HashSet},
    fmt::Display,
};

use axum::http::request::Parts;
use chrono::{DateTime, Utc};
use rmcp::{
    Json,
    handler::server::{tool::Extension, wrapper::Parameters},
    tool, tool_router,
};
use schemars::JsonSchema;
use sea_orm::{
    ConnectionTrait, DatabaseConnection, DbBackend, DbErr, EntityTrait, FromQueryResult, Statement,
};
use serde::{Deserialize, Serialize};

use super::{
    super::entries::{self, Marks, Params, SEARCH_TIME, TIMELINE},
    Server, VISIBLE, principal,
};
use crate::{
    entity::{entry, feed, subscription},
    html, id,
    rules::Rules,
    search::{self, Within},
    time::iso,
};

const PAGE_SIZE: u64 = 20;
const MAX_PAGE_SIZE: u64 = 50;
/// Characters of an entry's text answered at a time.
const TEXT_PAGE: usize = 10_000;
const ENTRY_NOT_FOUND: &str = "No such entry among those of feeds the user follows or starred";

/// A tool's answer, or what went wrong for the agent to read.
type ToolResult<T> = Result<Json<T>, String>;

/// A failure of the server, which is logged and not described to the agent.
fn internal(err: impl Display) -> String {
    tracing::error!("an MCP tool failed: {err}");
    "Internal error".into()
}

fn page_size(limit: Option<u64>) -> u64 {
    limit.unwrap_or(PAGE_SIZE).clamp(1, MAX_PAGE_SIZE)
}

fn parse_id(id: &str, what: &str) -> Result<i64, String> {
    id::parse(id).ok_or_else(|| format!("Invalid {what}"))
}

#[derive(Serialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
enum View {
    Articles,
    Social,
    Pictures,
    Videos,
    Audio,
    Notifications,
}

impl From<i16> for View {
    fn from(view: i16) -> Self {
        match view {
            1 => Self::Social,
            2 => Self::Pictures,
            3 => Self::Videos,
            4 => Self::Audio,
            5 => Self::Notifications,
            _ => Self::Articles,
        }
    }
}

#[derive(FromQueryResult)]
struct FollowedFeed {
    feed_id: i64,
    title: Option<String>,
    category: Option<String>,
    view: i16,
    site_url: Option<String>,
    unread: i64,
    hidden: bool,
    error_message: Option<String>,
}

/// A feed the user follows. Its URL is left out: it may hold a key.
#[derive(Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct Feed {
    id: String,
    title: Option<String>,
    category: Option<String>,
    view: View,
    site_url: Option<String>,
    /// Unread entries.
    unread: i64,
    /// Left out of `list_entries` unless asked for by id.
    hidden_from_timeline: bool,
    /// Why the feed last failed to refresh.
    error: Option<String>,
}

#[derive(Serialize, JsonSchema)]
struct Feeds {
    feeds: Vec<Feed>,
}

/// An entry in short.
#[derive(Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct Summary {
    id: String,
    feed_id: String,
    feed_title: Option<String>,
    title: Option<String>,
    url: Option<String>,
    author: Option<String>,
    published_at: String,
    read: bool,
    starred: bool,
    /// The start of its text.
    excerpt: Option<String>,
}

#[derive(Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct Entries {
    entries: Vec<Summary>,
    /// Passed back for the next page; none after the last.
    next_cursor: Option<String>,
}

#[derive(Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct Found {
    #[serde(flatten)]
    summary: Summary,
    /// Where its text has the words its title lacks.
    snippet: Option<String>,
}

#[derive(Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct FoundEntries {
    entries: Vec<Found>,
    /// Passed back for the next page; none after the last.
    next_cursor: Option<String>,
}

#[derive(Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct Opened {
    #[serde(flatten)]
    summary: Summary,
    opened_at: String,
}

#[derive(Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct OpenedEntries {
    entries: Vec<Opened>,
    /// Passed back for the next page; none after the last.
    next_cursor: Option<String>,
}

#[derive(Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct EntryText {
    #[serde(flatten)]
    summary: Summary,
    /// Its text, a line per paragraph, a piece at a time.
    content: String,
    /// Passed back as `offset` for the next piece; none after the last.
    next_offset: Option<usize>,
}

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct ListEntries {
    /// A feed of `list_feeds`; without one, every followed feed not hidden from the timeline.
    feed_id: Option<String>,
    /// Only unread entries.
    #[serde(default)]
    unread_only: bool,
    /// Only starred entries, latest starred first, also of feeds no longer followed.
    #[serde(default)]
    starred_only: bool,
    /// Entries per page: 20 unless given, 50 at most.
    limit: Option<u64>,
    /// The `nextCursor` of the previous page.
    cursor: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct SearchEntries {
    /// Words the entries have, in their title or text.
    query: String,
    /// A feed of `list_feeds` to search only.
    feed_id: Option<String>,
    /// Entries per page: 20 unless given, 50 at most.
    limit: Option<u64>,
    /// The `nextCursor` of the previous page.
    cursor: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
struct GetEntry {
    /// The entry's id.
    id: String,
    /// The `nextOffset` of the previous piece.
    offset: Option<usize>,
}

#[derive(Deserialize, JsonSchema)]
struct ListRecentReads {
    /// Entries per page: 20 unless given, 50 at most.
    limit: Option<u64>,
    /// The `nextCursor` of the previous page.
    cursor: Option<String>,
}

/// Where a listing newest first goes on: after the entry `id` at `time`. Microseconds, as the database keeps them,
/// so that entries of one millisecond are neither skipped nor repeated.
struct Cursor {
    time: DateTime<Utc>,
    id: i64,
}

impl Cursor {
    fn parse(text: &str) -> Result<Self, String> {
        let invalid = || "Invalid cursor".to_string();
        let (micros, id) = text.split_once('_').ok_or_else(invalid)?;
        let micros = micros.parse().map_err(|_| invalid())?;
        Ok(Self {
            time: DateTime::from_timestamp_micros(micros).ok_or_else(invalid)?,
            id: id.parse().map_err(|_| invalid())?,
        })
    }

    fn of(shown: &Shown) -> String {
        format!("{}_{}", shown.time.timestamp_micros(), shown.entry.id)
    }
}

/// Clauses after [`TIMELINE`] for a page of `limit` of what `conditions` select, ordered by `time` newest first,
/// with one more entry when there are more.
fn paginated(
    conditions: &str,
    time: &str,
    cursor: Option<&Cursor>,
    params: &mut Params,
    limit: u64,
) -> String {
    let mut sql = format!("WHERE {conditions}");
    if let Some(cursor) = cursor {
        let (at, id) = (params.bind(cursor.time), params.bind(cursor.id));
        sql += &format!(" AND ({time}, e.id) < ({at}, {id})");
    }
    sql + &format!(" ORDER BY {time} DESC, e.id DESC LIMIT {}", limit + 1)
}

/// The page of `limit` from what [`paginated`] selected, and the cursor to the rest.
fn page(mut shown: Vec<Shown>, limit: u64) -> (Vec<Shown>, Option<String>) {
    let more = shown.len() as u64 > limit;
    shown.truncate(limit as usize);
    let next = more.then(|| shown.last().map(Cursor::of)).flatten();
    (shown, next)
}

/// An entry as the user's rules show it, what they did with it, and the time its listing orders it by.
struct Shown {
    entry: entry::Model,
    marks: Marks,
    feed: feed::Model,
    time: DateTime<Utc>,
}

impl Shown {
    fn summary(&self) -> Summary {
        let entry = &self.entry;
        let feed_title = self.marks.subscription_title.clone();
        Summary {
            id: entry.id.to_string(),
            feed_id: entry.feed_id.to_string(),
            feed_title: feed_title.or_else(|| self.feed.title.clone()),
            title: entry.title.clone(),
            url: entry.url.clone(),
            author: entry.author.clone(),
            published_at: iso(entry.published_at),
            read: self.marks.read,
            starred: self.marks.collected_at.is_some(),
            excerpt: entry.description.clone(),
        }
    }

    /// The entry's text as a reader sees it, a line per paragraph.
    fn text(&self) -> String {
        let entry = &self.entry;
        let html = entry
            .content
            .as_deref()
            .filter(|content| !content.trim().is_empty())
            .or(entry.description.as_deref())
            .unwrap_or_default();
        let lines: Vec<String> = html::visible(html)
            .lines()
            .map(|line| line.split_whitespace().collect::<Vec<_>>().join(" "))
            .filter(|line| !line.is_empty())
            .collect();
        lines.join("\n")
    }
}

/// The entries `clauses` select on [`TIMELINE`] with the `time` they are ordered by, in order, as the user's rules
/// show them; with their content only if `content`.
async fn shown(
    db: &DatabaseConnection,
    user_id: &str,
    clauses: &str,
    time: &str,
    params: Params,
    content: bool,
) -> Result<Vec<Shown>, DbErr> {
    let rules = Rules::load(db, user_id).await?;
    let columns = entries::marked_columns(content || rules.reads_content());
    let sql = format!("SELECT {columns}, {time} AS time {TIMELINE} {clauses}");
    let statement = Statement::from_sql_and_values(DbBackend::Postgres, sql, params.0);
    let rows = db.query_all_raw(statement).await?;
    let mut marked = Vec::new();
    for row in &rows {
        let time: DateTime<Utc> = row.try_get("", "time")?;
        marked.push((entries::marked(row)?, time));
    }
    let feeds = entries::feeds(db, marked.iter().map(|((entry, _), _)| entry.feed_id)).await?;
    let shown = marked
        .into_iter()
        .map(|((entry, marks), time)| {
            let feed = feeds[&entry.feed_id].clone();
            let (entry, _) = entries::personalize(&rules, &feed, entry, &marks);
            Shown {
                entry,
                marks,
                feed,
                time,
            }
        })
        .collect();
    Ok(shown)
}

/// A search of the feeds the user follows, or of one of them.
struct Followed {
    feed_id: Option<i64>,
}

impl search::Scope for Followed {
    async fn within(
        &self,
        db: &DatabaseConnection,
        user_id: &str,
    ) -> Result<Option<Within>, DbErr> {
        let mut params = Params(vec![user_id.into()]);
        let mut sql =
            "SELECT 'f' || feed_id AS source FROM subscriptions WHERE user_id = $1".to_string();
        if let Some(feed_id) = self.feed_id {
            sql += &format!(" AND feed_id = {}", params.bind(feed_id));
        }
        let sources = entries::column(db, sql, params, "source").await?;
        Ok(Some(Within::Sources(sources)))
    }

    async fn readable(
        &self,
        db: &DatabaseConnection,
        user_id: &str,
        ids: &[i64],
    ) -> Result<HashSet<i64>, DbErr> {
        let sql = format!(
            "SELECT e.id {TIMELINE} WHERE e.id = ANY($2) AND s.feed_id IS NOT NULL AND b.entry_id IS NULL"
        );
        let params = Params(vec![user_id.into(), ids.to_vec().into()]);
        let ids: Vec<i64> = entries::column(db, sql, params, "id").await?;
        Ok(ids.into_iter().collect())
    }
}

#[tool_router(router = tool_router, vis = "pub(super)")]
impl Server {
    /// The feeds the user follows, with how many of their entries are unread.
    #[tool(annotations(read_only_hint = true))]
    async fn list_feeds(&self, Extension(parts): Extension<Parts>) -> ToolResult<Feeds> {
        let sql = "SELECT s.feed_id, COALESCE(NULLIF(s.title, ''), f.title) AS title, s.category, s.view,
                f.site_url, s.hide_from_timeline IS TRUE AS hidden, f.error_message,
                (SELECT count(*) FROM unreads u WHERE u.user_id = s.user_id AND u.feed_id = s.feed_id) AS unread
            FROM subscriptions s JOIN feeds f ON f.id = s.feed_id
            WHERE s.user_id = $1 ORDER BY s.created_at, s.feed_id";
        let values = [principal(&parts).user_id.clone().into()];
        let statement = Statement::from_sql_and_values(DbBackend::Postgres, sql, values);
        let rows = FollowedFeed::find_by_statement(statement)
            .all(&self.state.db)
            .await
            .map_err(internal)?;
        let feeds = rows
            .into_iter()
            .map(|row| Feed {
                id: row.feed_id.to_string(),
                title: row.title,
                category: row.category,
                view: row.view.into(),
                site_url: row.site_url,
                unread: row.unread,
                hidden_from_timeline: row.hidden,
                error: row.error_message,
            })
            .collect();
        Ok(Json(Feeds { feeds }))
    }

    /// A page of entries in short, newest first: of one feed, or of every followed feed not hidden from the
    /// timeline.
    #[tool(annotations(read_only_hint = true))]
    async fn list_entries(
        &self,
        Extension(parts): Extension<Parts>,
        Parameters(args): Parameters<ListEntries>,
    ) -> ToolResult<Entries> {
        let (db, user_id) = (&self.state.db, &principal(&parts).user_id);
        let limit = page_size(args.limit);
        let cursor = args.cursor.as_deref().map(Cursor::parse).transpose()?;
        let mut params = Params(vec![user_id.clone().into()]);
        let mut conditions = vec!["b.entry_id IS NULL".to_string()];
        let time = if args.starred_only {
            conditions.push("c.entry_id IS NOT NULL".into());
            "c.created_at"
        } else {
            conditions.push("s.feed_id IS NOT NULL".into());
            "e.published_at"
        };
        match args
            .feed_id
            .as_deref()
            .map(|id| parse_id(id, "feed id"))
            .transpose()?
        {
            Some(feed_id) => {
                if !args.starred_only {
                    let followed = subscription::Entity::find_by_id((user_id.clone(), feed_id))
                        .one(db)
                        .await
                        .map_err(internal)?;
                    followed.ok_or("The user does not follow this feed")?;
                }
                conditions.push(format!("e.feed_id = {}", params.bind(feed_id)));
            }
            None if !args.starred_only => {
                conditions.push("s.hide_from_timeline IS NOT TRUE".into());
            }
            None => {}
        }
        if args.unread_only {
            conditions.push("u.entry_id IS NOT NULL".into());
        }
        let clauses = paginated(
            &conditions.join(" AND "),
            time,
            cursor.as_ref(),
            &mut params,
            limit,
        );
        let shown = shown(db, user_id, &clauses, time, params, false)
            .await
            .map_err(internal)?;
        let (shown, next_cursor) = page(shown, limit);
        Ok(Json(Entries {
            entries: shown.iter().map(Shown::summary).collect(),
            next_cursor,
        }))
    }

    /// A page of the entries of followed feeds that have all the words of the query, those with the most of them
    /// in their title first, then newest. New entries take a moment to become searchable.
    #[tool(annotations(read_only_hint = true))]
    async fn search_entries(
        &self,
        Extension(parts): Extension<Parts>,
        Parameters(args): Parameters<SearchEntries>,
    ) -> ToolResult<FoundEntries> {
        let (db, user_id) = (&self.state.db, &principal(&parts).user_id);
        let query = args.query.trim();
        if query.is_empty() {
            return Err("The query is empty".into());
        }
        let limit = page_size(args.limit) as usize;
        let after = args
            .cursor
            .as_deref()
            .map(|id| parse_id(id, "cursor"))
            .transpose()?;
        let feed_id = args
            .feed_id
            .as_deref()
            .map(|id| parse_id(id, "feed id"))
            .transpose()?;
        let scope = Followed { feed_id };
        let find = search::find(
            db,
            &self.state.search,
            user_id,
            query,
            &scope,
            after,
            limit + 1,
        );
        let mut found = tokio::time::timeout(SEARCH_TIME, find)
            .await
            .map_err(|_| "The search took too long; try again".to_string())?
            .map_err(internal)?;
        let more = found.len() > limit;
        found.truncate(limit);
        let next_cursor = more
            .then(|| found.last().map(|found| found.id.to_string()))
            .flatten();
        let ids: Vec<i64> = found.iter().map(|found| found.id).collect();
        let mut params = Params(vec![user_id.clone().into()]);
        let clauses = format!("WHERE e.id = ANY({}) AND {VISIBLE}", params.bind(ids));
        let shown = shown(db, user_id, &clauses, "e.published_at", params, false)
            .await
            .map_err(internal)?;
        let mut shown: HashMap<i64, Shown> = shown
            .into_iter()
            .map(|shown| (shown.entry.id, shown))
            .collect();
        let entries = found
            .into_iter()
            .filter_map(|found| {
                Some(Found {
                    summary: shown.remove(&found.id)?.summary(),
                    snippet: found.highlight.snippet.map(|pieces| pieces.concat()),
                })
            })
            .collect();
        Ok(Json(FoundEntries {
            entries,
            next_cursor,
        }))
    }

    /// One entry with its text, as plain text a piece at a time; reading it does not mark it read.
    #[tool(annotations(read_only_hint = true))]
    async fn get_entry(
        &self,
        Extension(parts): Extension<Parts>,
        Parameters(args): Parameters<GetEntry>,
    ) -> ToolResult<EntryText> {
        let (db, user_id) = (&self.state.db, &principal(&parts).user_id);
        let id = id::parse(&args.id).ok_or(ENTRY_NOT_FOUND)?;
        let mut params = Params(vec![user_id.clone().into()]);
        let clauses = format!("WHERE e.id = {} AND {VISIBLE}", params.bind(id));
        let shown = shown(db, user_id, &clauses, "e.published_at", params, true)
            .await
            .map_err(internal)?
            .pop()
            .ok_or(ENTRY_NOT_FOUND)?;
        let text = shown.text();
        let offset = args.offset.unwrap_or(0);
        let content: String = text.chars().skip(offset).take(TEXT_PAGE).collect();
        let next = offset + TEXT_PAGE;
        Ok(Json(EntryText {
            summary: shown.summary(),
            content,
            next_offset: (next < text.chars().count()).then_some(next),
        }))
    }

    /// A page of the entries the user opened in the reader lately, last opened first.
    #[tool(annotations(read_only_hint = true))]
    async fn list_recent_reads(
        &self,
        Extension(parts): Extension<Parts>,
        Parameters(args): Parameters<ListRecentReads>,
    ) -> ToolResult<OpenedEntries> {
        let (db, user_id) = (&self.state.db, &principal(&parts).user_id);
        let limit = page_size(args.limit);
        let cursor = args.cursor.as_deref().map(Cursor::parse).transpose()?;
        let mut params = Params(vec![user_id.clone().into()]);
        let time = "h.opened_at";
        let clauses = "JOIN reading_history h ON h.user_id = $1 AND h.entry_id = e.id ".to_string()
            + &paginated(VISIBLE, time, cursor.as_ref(), &mut params, limit);
        let shown = shown(db, user_id, &clauses, time, params, false)
            .await
            .map_err(internal)?;
        let (shown, next_cursor) = page(shown, limit);
        let entries = shown
            .iter()
            .map(|shown| Opened {
                summary: shown.summary(),
                opened_at: iso(shown.time),
            })
            .collect();
        Ok(Json(OpenedEntries {
            entries,
            next_cursor,
        }))
    }
}
