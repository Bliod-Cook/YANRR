use sea_orm_migration::prelude::*;

/// Drops unread marks left without a subscription by marking an entry unread while unsubscribing; they made
/// following the feed again fail.
#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .get_connection()
            .execute_unprepared(
                "DELETE FROM unreads u WHERE NOT EXISTS (
                    SELECT 1 FROM subscriptions s WHERE s.user_id = u.user_id AND s.feed_id = u.feed_id
                )",
            )
            .await?;
        Ok(())
    }
}
