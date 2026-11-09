//! Full-text search of entries: an index of candidate terms, with PostgreSQL deciding what a user may see.

pub(crate) mod index;
pub(crate) mod text;

use std::{error::Error, fs, path::Path, sync::Mutex};

use chrono::{DateTime, Utc};
use sea_orm::{DatabaseConnection, DbBackend, FromQueryResult, Statement};
use tantivy::{Index, IndexReader, IndexWriter, ReloadPolicy, indexer::IndexWriterOptions};

use self::index::{Entry, Fields, Key};

/// The index format; an index of another one is built anew from the database.
const VERSION: &str = "v1";
/// Entries read from the database at a time.
const BATCH: usize = 1000;

pub struct Search {
    fields: Fields,
    reader: IndexReader,
    writer: Mutex<IndexWriter>,
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
        })
    }
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
