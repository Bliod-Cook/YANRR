//! What the user opened in the clients, which agents list as their recent reads.

use axum::{Json, extract::State};
use sea_orm::{ConnectionTrait, DbBackend, Statement};
use serde::Deserialize;
use serde_json::Value;

use super::{
    super::{
        entries::TIMELINE,
        error::{ApiJson, ApiResult},
        response::done,
        session::AuthUser,
    },
    VISIBLE, enabled,
};
use crate::{AppState, id};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedBody {
    entry_id: String,
}

/// `POST /reading-history`: the user opened the entry. Only entries the tools show are noted, so inbox entries
/// are not.
pub async fn opened(
    State(state): State<AppState>,
    user: AuthUser,
    ApiJson(body): ApiJson<OpenedBody>,
) -> ApiResult<Json<Value>> {
    enabled(&state)?;
    if let Some(entry_id) = id::parse(&body.entry_id) {
        let sql = format!(
            "INSERT INTO reading_history (user_id, entry_id, opened_at)
            SELECT $1, e.id, now() {TIMELINE} WHERE e.id = $2 AND {VISIBLE}
            ON CONFLICT (user_id, entry_id) DO UPDATE SET opened_at = EXCLUDED.opened_at"
        );
        let values = [user.id.into(), entry_id.into()];
        let statement = Statement::from_sql_and_values(DbBackend::Postgres, sql, values);
        state.db.execute_raw(statement).await?;
    }
    Ok(done())
}
