use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "sync_actions")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i64,
    pub user_id: String,
    pub model: String,
    pub model_id: Option<String>,
    pub action: String,
    pub data: Json,
    pub created_at: DateTimeUtc,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
