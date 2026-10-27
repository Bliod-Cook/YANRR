mod m20261020_000001_init;
mod m20261021_000001_sync;
mod m20261022_000001_subscriptions;
mod m20261023_000001_messaging;
mod m20261023_000002_inboxes;
mod m20261026_000001_orphaned_unreads;
mod m20261026_000002_actions;
mod m20261027_000001_timeline_index;

use sea_orm_migration::prelude::*;

pub struct Migrator;

#[async_trait::async_trait]
impl MigratorTrait for Migrator {
    fn migrations() -> Vec<Box<dyn MigrationTrait>> {
        vec![
            Box::new(m20261020_000001_init::Migration),
            Box::new(m20261021_000001_sync::Migration),
            Box::new(m20261022_000001_subscriptions::Migration),
            Box::new(m20261023_000001_messaging::Migration),
            Box::new(m20261023_000002_inboxes::Migration),
            Box::new(m20261026_000001_orphaned_unreads::Migration),
            Box::new(m20261026_000002_actions::Migration),
            Box::new(m20261027_000001_timeline_index::Migration),
        ]
    }
}
