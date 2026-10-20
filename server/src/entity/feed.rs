use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "feeds")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: i64,
    #[sea_orm(unique)]
    pub url: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub image: Option<String>,
    pub site_url: Option<String>,
    pub language: Option<String>,
    pub ttl: Option<i32>,
    pub etag_header: Option<String>,
    pub last_modified_header: Option<String>,
    pub checked_at: DateTimeUtc,
    pub refresh_enqueued_at: Option<DateTimeUtc>,
    pub error_message: Option<String>,
    pub error_at: Option<DateTimeUtc>,
    pub migrate_to: Option<i64>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
