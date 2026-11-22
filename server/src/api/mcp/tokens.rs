//! The bearer tokens of the MCP server, which users issue and revoke.

use axum::{Json, extract::State};
use chrono::{TimeDelta, Utc};
use sea_orm::{
    ActiveValue::Set, ColumnTrait, DatabaseConnection, DbErr, EntityTrait, QueryFilter, QueryOrder,
    sea_query::Expr,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use super::{
    super::{
        error::{ApiError, ApiJson, ApiResult},
        response::{done, ok},
        session::AuthUser,
    },
    enabled,
};
use crate::{AppState, entity::mcp_token, id, time::iso};

/// What a token lets an agent read.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Scope {
    Feeds,
    Entries,
    History,
}

impl Scope {
    const ALL: [Self; 3] = [Self::Feeds, Self::Entries, Self::History];

    pub fn name(self) -> &'static str {
        match self {
            Self::Feeds => "feeds:read",
            Self::Entries => "entries:read",
            Self::History => "history:read",
        }
    }

    fn parse(name: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|scope| scope.name() == name)
    }
}

/// The user an MCP request acts for, and what their token lets it do.
#[derive(Clone, Debug)]
pub struct Principal {
    pub user_id: String,
    pub scopes: Vec<Scope>,
}

/// How stale a token's last use may be before a request notes it again.
const USE_PRECISION: TimeDelta = TimeDelta::minutes(15);

fn hash(token: &str) -> Vec<u8> {
    Sha256::digest(token.as_bytes()).to_vec()
}

/// A new token: 256 random bits.
fn generate() -> String {
    let bytes: [u8; 32] = rand::random();
    let hex: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
    format!("yanrr_{hex}")
}

/// Who `token` acts for, noting that it was used; `None` when it was never issued or is revoked.
pub(super) async fn principal(
    db: &DatabaseConnection,
    token: &str,
) -> Result<Option<Principal>, DbErr> {
    let Some(row) = mcp_token::Entity::find()
        .filter(mcp_token::Column::TokenHash.eq(hash(token)))
        .one(db)
        .await?
    else {
        return Ok(None);
    };
    let now = Utc::now();
    if row
        .last_used_at
        .is_none_or(|used| now - used > USE_PRECISION)
    {
        mcp_token::Entity::update_many()
            .col_expr(mcp_token::Column::LastUsedAt, Expr::value(now))
            .filter(mcp_token::Column::Id.eq(row.id))
            .exec(db)
            .await?;
    }
    let scopes = row.scopes.iter().filter_map(|name| Scope::parse(name));
    Ok(Some(Principal {
        user_id: row.user_id,
        scopes: scopes.collect(),
    }))
}

/// A token as its owner sees it, which never includes the token itself.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Issued {
    id: String,
    name: String,
    scopes: Vec<String>,
    created_at: String,
    last_used_at: Option<String>,
}

impl From<mcp_token::Model> for Issued {
    fn from(row: mcp_token::Model) -> Self {
        Self {
            id: row.id.to_string(),
            name: row.name,
            scopes: row.scopes,
            created_at: iso(row.created_at),
            last_used_at: row.last_used_at.map(iso),
        }
    }
}

/// `GET /mcp/tokens`: the user's tokens, oldest first.
pub async fn list(State(state): State<AppState>, user: AuthUser) -> ApiResult<Json<Value>> {
    enabled(&state)?;
    let rows = mcp_token::Entity::find()
        .filter(mcp_token::Column::UserId.eq(user.id))
        .order_by_asc(mcp_token::Column::CreatedAt)
        .all(&state.db)
        .await?;
    Ok(ok(rows.into_iter().map(Issued::from).collect::<Vec<_>>()))
}

#[derive(Deserialize)]
pub struct CreateBody {
    name: String,
    scopes: Vec<String>,
}

/// `POST /mcp/tokens`: answers the token itself, which is shown this once.
pub async fn create(
    State(state): State<AppState>,
    user: AuthUser,
    ApiJson(body): ApiJson<CreateBody>,
) -> ApiResult<Json<Value>> {
    enabled(&state)?;
    let name = body.name.trim();
    if name.is_empty() {
        return Err(ApiError::validation("A token needs a name".into()));
    }
    let mut scopes = body
        .scopes
        .iter()
        .map(|name| {
            Scope::parse(name).ok_or_else(|| ApiError::validation(format!("Unknown scope {name}")))
        })
        .collect::<ApiResult<Vec<_>>>()?;
    scopes.sort();
    scopes.dedup();
    if scopes.is_empty() {
        return Err(ApiError::validation("A token needs a scope".into()));
    }
    let token = generate();
    let row = mcp_token::ActiveModel {
        id: Set(id::next_id()),
        user_id: Set(user.id),
        name: Set(name.into()),
        token_hash: Set(hash(&token)),
        scopes: Set(scopes.iter().map(|scope| scope.name().into()).collect()),
        created_at: Set(Utc::now()),
        last_used_at: Set(None),
    };
    let row = mcp_token::Entity::insert(row)
        .exec_with_returning(&state.db)
        .await?;
    let mut issued = json!(Issued::from(row));
    issued["token"] = token.into();
    Ok(ok(issued))
}

#[derive(Deserialize)]
pub struct DeleteBody {
    id: String,
}

/// `DELETE /mcp/tokens`: revokes one of the user's tokens.
pub async fn delete(
    State(state): State<AppState>,
    user: AuthUser,
    ApiJson(body): ApiJson<DeleteBody>,
) -> ApiResult<Json<Value>> {
    enabled(&state)?;
    if let Some(id) = id::parse(&body.id) {
        mcp_token::Entity::delete_many()
            .filter(mcp_token::Column::UserId.eq(user.id))
            .filter(mcp_token::Column::Id.eq(id))
            .exec(&state.db)
            .await?;
    }
    Ok(done())
}
