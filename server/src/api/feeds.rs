use axum::{Json, extract::State};
use chrono::Utc;
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, sea_query::Expr};
use serde::Deserialize;
use serde_json::Value;

use super::{
    error::{ApiError, ApiQuery, ApiResult, ExceptionCode},
    response::done,
    session::AuthUser,
};
use crate::{AppState, entity::feed, fetch};

#[derive(Deserialize)]
pub struct RefreshQuery {
    id: String,
}

/// `GET /feeds/refresh`: refetches a feed and waits for the result, so a following timeline request sees new entries.
pub async fn refresh(
    State(state): State<AppState>,
    _user: AuthUser,
    ApiQuery(query): ApiQuery<RefreshQuery>,
) -> ApiResult<Json<Value>> {
    let not_found = || ApiError::new(ExceptionCode::FeedNoFound, "Feed not found");
    let id: i64 = query.id.parse().map_err(|_| not_found())?;
    let enqueued = feed::Entity::update_many()
        .col_expr(feed::Column::RefreshEnqueuedAt, Expr::value(Utc::now()))
        .filter(feed::Column::Id.eq(id))
        .exec(&state.db)
        .await?;
    if enqueued.rows_affected == 0 {
        return Err(not_found());
    }
    fetch::refresh_feed(&state, id).await?;
    Ok(done())
}
