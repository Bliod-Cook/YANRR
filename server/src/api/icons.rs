use axum::{
    extract::{Path, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use reqwest::Url;
use sea_orm::{ConnectionTrait, DbBackend, DbErr, Statement};

use super::{
    error::{ApiError, ApiResult, ExceptionCode},
    session::AuthUser,
};
use crate::{AppState, icons};

/// Icons seldom change; a site without one is asked again sooner.
const FOUND: &str = "public, max-age=2592000";
const MISSING: &str = "public, max-age=86400";

/// `GET /icons/{host}`: the icon of the site at `host`, or an empty 404 that lets clients draw their own.
pub async fn get(
    State(state): State<AppState>,
    user: Option<AuthUser>,
    Path(host): Path<String>,
) -> ApiResult<Response> {
    let is_hostname = Url::parse(&format!("https://{host}/"))
        .is_ok_and(|url| url.domain() == Some(host.as_str()));
    if !is_hostname {
        return Err(ApiError::new(ExceptionCode::InvalidInput, "Not a hostname"));
    }
    // Signed-out requests, such as the mobile app's image loads, get only sites the server already fetches feeds
    // from, so that nobody can have it fetch any site.
    if user.is_none() && !has_feeds(&state.db, &host).await? {
        return Ok(empty(StatusCode::NOT_FOUND, "no-store"));
    }
    let response = match icons::find(&state.http, &state.config.icons, &host).await {
        Ok(Some(icon)) => {
            let headers = [
                (header::CONTENT_TYPE, icon.content_type),
                (header::CACHE_CONTROL, FOUND),
                (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
            ];
            (headers, icon.body).into_response()
        }
        Ok(None) => empty(StatusCode::NOT_FOUND, MISSING),
        Err(err) => {
            tracing::warn!("icon lookup for {host} failed: {err}");
            empty(StatusCode::BAD_GATEWAY, "no-store")
        }
    };
    Ok(response)
}

fn empty(status: StatusCode, cache_control: &'static str) -> Response {
    (status, [(header::CACHE_CONTROL, cache_control)]).into_response()
}

/// Whether a stored feed's site is at `host`.
async fn has_feeds(db: &impl ConnectionTrait, host: &str) -> Result<bool, DbErr> {
    let sql = "SELECT EXISTS (SELECT 1 FROM feeds WHERE substring(site_url FROM '^https?://([^/:?#]+)') = $1) AS found";
    let statement = Statement::from_sql_and_values(DbBackend::Postgres, sql, [host.into()]);
    let row = db.query_one_raw(statement).await?;
    Ok(row.is_some_and(|row| row.try_get("", "found").unwrap_or(false)))
}
