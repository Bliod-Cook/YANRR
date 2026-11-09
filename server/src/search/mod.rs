//! Full-text search of entries: an index of candidate terms, with PostgreSQL deciding what a user may see.

pub(crate) mod index;
pub(crate) mod text;

use std::{
    collections::HashSet,
    error::Error,
    fs,
    path::Path,
    sync::{Mutex, PoisonError},
    time::Duration,
};

use chrono::{DateTime, Utc};
use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, DbErr, FromQueryResult, Statement};
use tantivy::{Index, IndexReader, IndexWriter, ReloadPolicy, indexer::IndexWriterOptions};
use tokio::sync::Notify;

use self::index::{Entry, Fields, Key};
use crate::AppState;

/// The index format; an index of another one is built anew from the database.
const VERSION: &str = "v1";
/// Entries read from the database at a time.
const BATCH: usize = 1000;
/// Queued entries indexed at a time.
const QUEUE_BATCH: usize = 500;
/// How long the indexer waits for news before looking at the queue anyway, e.g. after a crash.
const IDLE: Duration = Duration::from_secs(30);

pub struct Search {
    fields: Fields,
    reader: IndexReader,
    writer: Mutex<IndexWriter>,
    queued: Notify,
}

impl Search {
    /// The index in `dir`, built from the database first when it isn't there.
    pub async fn open(
        dir: &Path,
        db: &DatabaseConnection,
    ) -> Result<Self, Box<dyn Error + Send + Sync>> {
        let path = dir.join(VERSION);
        if !path.exists() {
            build(dir, &path, db).await?;
        }
        let index = Index::open_in_dir(&path)?;
        let options = IndexWriterOptions::builder()
            .memory_budget_per_thread(50_000_000)
            .num_merge_threads(1)
            .build();
        Ok(Self {
            fields: Fields::new(&index.schema()),
            reader: index
                .reader_builder()
                .reload_policy(ReloadPolicy::Manual)
                .try_into()?,
            writer: Mutex::new(index.writer_with_options(options)?),
            queued: Notify::new(),
        })
    }

    /// Has the indexer index what was queued; call it once the transaction queuing entries is committed.
    pub fn wake(&self) {
        self.queued.notify_one();
    }

    /// Replaces the documents of `ids` with those of `rows`, dropping the ones whose entry is gone, and makes
    /// them searchable.
    fn index(&self, ids: &[i64], rows: Vec<Row>) -> tantivy::Result<()> {
        let mut writer = self.writer.lock().unwrap_or_else(PoisonError::into_inner);
        let found: HashSet<i64> = rows.iter().map(|row| row.id).collect();
        for id in ids.iter().filter(|id| !found.contains(id)) {
            self.fields.delete(&writer, *id as u64);
        }
        for row in rows {
            self.fields.add(&writer, &row.entry())?;
        }
        writer.commit()?;
        self.reader.reload()
    }
}

/// Queues entries for the index; call it in the transaction storing them.
pub(crate) async fn enqueue(db: &impl ConnectionTrait, ids: &[i64]) -> Result<(), DbErr> {
    if ids.is_empty() {
        return Ok(());
    }
    let sql = "INSERT INTO search_queue SELECT unnest($1::bigint[]) ON CONFLICT DO NOTHING";
    db.execute_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        sql,
        [ids.to_vec().into()],
    ))
    .await?;
    Ok(())
}

/// Indexes the queued entries. An entry leaves the queue only once it is searchable, so that one indexed again
/// after a failure is merely replaced.
pub async fn index_pending(state: &AppState) -> Result<(), Box<dyn Error + Send + Sync>> {
    let claim = format!("SELECT entry_id FROM search_queue ORDER BY entry_id LIMIT {QUEUE_BATCH}");
    let select = rows("id = ANY($1)");
    loop {
        let statement = Statement::from_string(DbBackend::Postgres, &claim);
        let ids = state
            .db
            .query_all_raw(statement)
            .await?
            .iter()
            .map(|row| row.try_get::<i64>("", "entry_id"))
            .collect::<Result<Vec<_>, _>>()?;
        if ids.is_empty() {
            return Ok(());
        }
        let statement =
            Statement::from_sql_and_values(DbBackend::Postgres, &select, [ids.clone().into()]);
        let rows = Row::find_by_statement(statement).all(&state.db).await?;
        let (search, indexed) = (state.search.clone(), ids.clone());
        tokio::task::spawn_blocking(move || search.index(&indexed, rows)).await??;
        let sql = "DELETE FROM search_queue WHERE entry_id = ANY($1)";
        state
            .db
            .execute_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                sql,
                [ids.into()],
            ))
            .await?;
    }
}

/// Indexes queued entries as they are stored.
pub fn spawn_indexer(state: AppState) {
    tokio::spawn(async move {
        loop {
            if let Err(err) = index_pending(&state).await {
                tracing::error!("indexing entries failed: {err}");
            }
            let _ = tokio::time::timeout(IDLE, state.search.queued.notified()).await;
        }
    });
}

/// Builds the index of every entry in `path`, next to it first so that an interrupted build is started over.
async fn build(
    dir: &Path,
    path: &Path,
    db: &DatabaseConnection,
) -> Result<(), Box<dyn Error + Send + Sync>> {
    let building = dir.join(format!("{VERSION}.building"));
    if building.exists() {
        fs::remove_dir_all(&building)?;
    }
    fs::create_dir_all(&building)?;
    let index = Index::create_in_dir(&building, index::schema())?;
    let fields = Fields::new(&index.schema());
    let mut writer: IndexWriter = index.writer_with_num_threads(2, 128_000_000)?;
    let sql = format!("{} ORDER BY id LIMIT {BATCH}", rows("id > $1"));
    let (mut after, mut count) = (0_i64, 0);
    loop {
        let statement = Statement::from_sql_and_values(DbBackend::Postgres, &sql, [after.into()]);
        let rows = Row::find_by_statement(statement).all(db).await?;
        let Some(last) = rows.last() else { break };
        after = last.id;
        let entries =
            tokio::task::spawn_blocking(|| rows.into_iter().map(Row::entry).collect::<Vec<_>>())
                .await?;
        for entry in &entries {
            fields.add(&writer, entry)?;
        }
        count += entries.len();
        tracing::info!("search index: {count} entries");
    }
    writer.commit()?;
    writer.wait_merging_threads()?;
    fs::rename(&building, path)?;
    // Indexes of other formats, finished or not, are dropped; nothing else in `dir` is touched.
    for found in fs::read_dir(dir)? {
        let found = found?;
        let name = found.file_name();
        if name != VERSION && found.file_type()?.is_dir() && name.to_str().is_some_and(is_index) {
            fs::remove_dir_all(found.path())?;
        }
    }
    Ok(())
}

/// Whether `name` is that of an index folder: `v<number>`, or `v<number>.building` while being built.
fn is_index(name: &str) -> bool {
    let name = name.strip_suffix(".building").unwrap_or(name);
    name.strip_prefix('v').is_some_and(|number| {
        !number.is_empty() && number.bytes().all(|byte| byte.is_ascii_digit())
    })
}

/// The text of an entry to index.
#[derive(FromQueryResult)]
struct Row {
    id: i64,
    source: String,
    title: Option<String>,
    description: Option<String>,
    content: Option<String>,
    published_at: DateTime<Utc>,
}

impl Row {
    fn document(&self) -> text::Document {
        text::document(
            self.title.as_deref(),
            self.description.as_deref(),
            self.content.as_deref(),
        )
    }

    fn entry(self) -> Entry {
        Entry {
            key: Key {
                published: self.published_at.timestamp_micros(),
                id: self.id as u64,
            },
            document: self.document(),
            source: self.source,
        }
    }
}

/// Feed and inbox entries to index that pass `filter`.
fn rows(filter: &str) -> String {
    format!(
        "SELECT id, 'f' || feed_id AS source, title, description, content, published_at FROM entries WHERE {filter}
        UNION ALL
        SELECT id, 'i' || inbox_handle, title, description, content, published_at FROM inbox_entries WHERE {filter}"
    )
}
