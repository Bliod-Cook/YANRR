use sea_orm_migration::prelude::*;

use crate::auth::create_auth_tables;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        create_auth_tables(db).await?;
        db.execute_unprepared(include_str!("init.sql")).await?;
        Ok(())
    }
}
