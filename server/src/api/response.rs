use axum::Json;
use serde::Serialize;
use serde_json::{Value, json};

/// `{ code: 0, data }`
pub fn ok(data: impl Serialize) -> Json<Value> {
    Json(json!({ "code": 0, "data": data }))
}

/// `{ code: 0 }`
pub fn done() -> Json<Value> {
    Json(json!({ "code": 0 }))
}

/// `{ code: 0, lastSyncId }`, the answer of a logged mutation.
pub fn synced(last_sync_id: i64) -> Json<Value> {
    Json(json!({ "code": 0, "lastSyncId": last_sync_id }))
}
