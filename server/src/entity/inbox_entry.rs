use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "inbox_entries")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: i64,
    pub inbox_handle: String,
    pub guid: String,
    pub title: Option<String>,
    pub url: Option<String>,
    pub description: Option<String>,
    pub content: Option<String>,
    pub author: Option<String>,
    pub author_url: Option<String>,
    pub author_avatar: Option<String>,
    pub categories: Option<Vec<String>>,
    pub media: Option<Json>,
    pub attachments: Option<Json>,
    pub extra: Option<Json>,
    pub language: Option<String>,
    pub read: bool,
    pub published_at: DateTimeUtc,
    pub inserted_at: DateTimeUtc,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
