use axum::{Json, extract::State};
use serde::Deserialize;
use serde_json::{Value, json};

use super::{
    error::{ApiQuery, ApiResult},
    response::ok,
    session::AuthUser,
};
use crate::{AppState, sync};

/// `GET /sync/state`: the cursor a client stores before taking a snapshot.
pub async fn state(State(state): State<AppState>, _user: AuthUser) -> ApiResult<Json<Value>> {
    let last_sync_id = sync::state(&state.db).await?;
    Ok(ok(json!({ "lastSyncId": last_sync_id })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeltaQuery {
    last_sync_id: i64,
    limit: Option<u64>,
}

/// `GET /sync/delta`
pub async fn delta(
    State(state): State<AppState>,
    user: AuthUser,
    ApiQuery(query): ApiQuery<DeltaQuery>,
) -> ApiResult<Json<Value>> {
    let delta = sync::delta(&state.db, &user.id, query.last_sync_id, query.limit).await?;
    Ok(ok(delta))
}
