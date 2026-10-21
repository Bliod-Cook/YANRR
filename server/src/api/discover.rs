use std::sync::Arc;

use axum::{Json, extract::State};
use serde::Deserialize;
use serde_json::{Value, json};

use super::{
    error::{ApiError, ApiJson, ApiQuery, ApiResult, ExceptionCode},
    feeds::latest_entries,
    response::ok,
    session::AuthUser,
};
use crate::{
    AppState, fetch,
    rsshub::{self, Filter, Namespaces},
    wire,
};

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

/// `GET /discover/rsshub`: routes of the configured RSSHub instance.
pub async fn rsshub(
    State(state): State<AppState>,
    _user: AuthUser,
    ApiQuery(filter): ApiQuery<Filter>,
) -> ApiResult<Json<Value>> {
    let namespaces = catalog(&state).await?;
    Ok(ok(rsshub::select(&namespaces, &filter)))
}

#[derive(Deserialize)]
pub struct RouteQuery {
    route: String,
}

/// `GET /discover/rsshub/route`: one route with its namespace, by a path like `/github/issue/:user/:repo?`.
pub async fn rsshub_route(
    State(state): State<AppState>,
    _user: AuthUser,
    ApiQuery(query): ApiQuery<RouteQuery>,
) -> ApiResult<Json<Value>> {
    let namespaces = catalog(&state).await?;
    let (prefix, namespace, route) = rsshub::find(&namespaces, &query.route)
        .ok_or_else(|| ApiError::new(ExceptionCode::RSSHubRouteError, "RSSHub route not found"))?;
    Ok(ok(json!({
        "route": route,
        "prefix": prefix,
        "name": namespace.name,
        "description": namespace.description,
        "url": namespace.url,
    })))
}

async fn catalog(state: &AppState) -> ApiResult<Arc<Namespaces>> {
    state
        .rsshub
        .namespaces(&state.http, &state.config.rsshub.url)
        .await
        .map_err(|err| {
            ApiError::new(
                ExceptionCode::RSSHubUnavailable,
                format!("RSSHub is unavailable: {err}"),
            )
        })
}
