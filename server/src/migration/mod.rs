use sea_orm_migration::prelude::*;

/// A migration that runs a SQL script; `name` is its id in `seaql_migrations`.
struct Sql {
    name: &'static str,
    script: &'static str,
}

impl MigrationName for Sql {
    fn name(&self) -> &str {
        self.name
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Sql {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .get_connection()
            .execute_unprepared(self.script)
            .await?;
        Ok(())
    }
}

macro_rules! sql {
    ($name:literal, $file:literal) => {
        Box::new(Sql {
            name: $name,
            script: include_str!($file),
        })
    };
}

pub struct Migrator;

#[async_trait::async_trait]
impl MigratorTrait for Migrator {
    fn migrations() -> Vec<Box<dyn MigrationTrait>> {
        vec![
            sql!("m20261020_000001_init", "init.sql"),
            sql!("m20261021_000001_sync", "sync.sql"),
            sql!("m20261022_000001_subscriptions", "subscriptions.sql"),
            sql!("m20261023_000001_messaging", "messaging.sql"),
            sql!("m20261023_000002_inboxes", "inboxes.sql"),
            sql!("m20261026_000001_orphaned_unreads", "orphaned_unreads.sql"),
            sql!("m20261026_000002_actions", "actions.sql"),
            sql!("m20261027_000001_timeline_index", "timeline_index.sql"),
            sql!("m20261030_000001_ai_cache", "ai_cache.sql"),
            sql!("m20261109_000001_search_queue", "search_queue.sql"),
            sql!(
                "m20261112_000001_unread_subscriptions",
                "unread_subscriptions.sql"
            ),
            sql!(
                "m20261112_000101_messaging_devices",
                "messaging_devices.sql"
            ),
            sql!("m20261112_000102_search_deletions", "search_deletions.sql"),
            sql!("m20261112_000103_ai_cache_keys", "ai_cache_keys.sql"),
        ]
    }
}
