use axum::{Json, extract::State};
use serde::Deserialize;
use serde_json::{Value, json};

use super::{
    error::{ApiJson, ApiResult},
    feeds::latest_entries,
    response::ok,
    session::AuthUser,
};
use crate::{AppState, fetch, wire};

const PREVIEW_ENTRIES: u64 = 4;

#[derive(Deserialize)]
pub struct DiscoverBody {
    keyword: String,
    target: Option<String>,
}

/// `POST /discover`: feeds at an address. Lists are not supported, so a list search finds nothing.
pub async fn discover(
    State(state): State<AppState>,
    _user: AuthUser,
    ApiJson(body): ApiJson<DiscoverBody>,
) -> ApiResult<Json<Value>> {
    if body.target.as_deref() == Some("lists") {
        return Ok(ok(json!([])));
    }
    let mut results = Vec::new();
    for feed in fetch::discover(&state, &body.keyword).await? {
        let entries = latest_entries(&state.db, feed.id, PREVIEW_ENTRIES).await?;
        results.push(json!({ "feed": wire::Feed::from(&feed), "entries": entries }));
    }
    Ok(ok(results))
}
