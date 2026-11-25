use axum::{Json, extract::State};
use serde_json::{Value, json};

use super::{response::ok, session::AuthUser};
use crate::AppState;

/// `GET /image-proxy`: the image proxy signed-in clients may load images through, and the key they sign image URLs
/// with; `null` when there is none.
pub async fn get(State(state): State<AppState>, _user: AuthUser) -> Json<Value> {
    let proxy = state.config.image_proxy.as_ref();
    ok(proxy.map(|proxy| json!({ "url": proxy.url, "key": proxy.key })))
}
