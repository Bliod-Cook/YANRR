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
