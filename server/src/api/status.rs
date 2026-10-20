use axum::Json;
use serde_json::{Value, json};

use super::response::ok;

/// `GET /status/configs`: also the clients' reachability probe, so it needs no session.
pub async fn configs() -> Json<Value> {
    ok(json!({}))
}
