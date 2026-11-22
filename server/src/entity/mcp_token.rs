use sea_orm::entity::prelude::*;

/// A bearer token of the MCP server, kept as the SHA-256 of the token.
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "mcp_tokens")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: i64,
    pub user_id: String,
    pub name: String,
    #[sea_orm(unique)]
    pub token_hash: Vec<u8>,
    pub scopes: Vec<String>,
    pub created_at: DateTimeUtc,
    pub last_used_at: Option<DateTimeUtc>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
