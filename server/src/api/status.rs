use axum::{Json, extract::State};
use serde_json::{Value, json};

use super::response::ok;
use crate::AppState;

/// `GET /status/configs`: what the server offers, which decides what clients show. Also the clients' reachability
/// probe, so it needs no session.
pub async fn configs(State(state): State<AppState>) -> Json<Value> {
    ok(json!({
        "ai": state.config.ai.is_some(),
        "registration": state.config.auth.registration,
        "push": state.push.is_some(),
        "mcp": state.config.mcp.enabled,
    }))
}
