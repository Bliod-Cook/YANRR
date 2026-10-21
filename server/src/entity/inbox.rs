use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "inboxes")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub handle: String,
    pub user_id: String,
    pub title: Option<String>,
    pub secret: String,
    pub created_at: DateTimeUtc,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
