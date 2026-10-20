mod m20261020_000001_init;
mod m20261021_000001_sync;
mod m20261022_000001_subscriptions;

use sea_orm_migration::prelude::*;

pub struct Migrator;

#[async_trait::async_trait]
impl MigratorTrait for Migrator {
    fn migrations() -> Vec<Box<dyn MigrationTrait>> {
        vec![
            Box::new(m20261020_000001_init::Migration),
            Box::new(m20261021_000001_sync::Migration),
            Box::new(m20261022_000001_subscriptions::Migration),
        ]
    }
}
