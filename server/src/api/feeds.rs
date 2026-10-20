use axum::{Json, extract::State};
use chrono::Utc;
use sea_orm::{
    ColumnTrait, DatabaseConnection, DbErr, EntityTrait, QueryFilter, QueryOrder, QuerySelect,
    sea_query::Expr,
};
use serde::Deserialize;
use serde_json::{Value, json};

use super::{
    error::{ApiError, ApiQuery, ApiResult, ExceptionCode},
    response::{done, ok},
    session::AuthUser,
};
use crate::{
    AppState,
    entity::{entry, feed, subscription},
    fetch, id, wire,
};

/// The newest entries of a feed, without content, as previews show them.
pub async fn latest_entries(
    db: &DatabaseConnection,
    feed_id: i64,
    limit: u64,
) -> Result<Vec<wire::Entry>, DbErr> {
    let entries = entry::Entity::find()
        .filter(entry::Column::FeedId.eq(feed_id))
        .order_by_desc(entry::Column::PublishedAt)
        .order_by_desc(entry::Column::Id)
        .limit(limit)
        .all(db)
        .await?;
    Ok(entries
        .into_iter()
        .map(|entry| wire::Entry::new(entry, false))
        .collect())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetQuery {
    id: Option<String>,
    url: Option<String>,
    entries_limit: Option<u64>,
}

/// `GET /feeds`: a feed with its newest entries, also for signed-out visitors. A new `url` is fetched first.
pub async fn get(
    State(state): State<AppState>,
    user: Option<AuthUser>,
    ApiQuery(query): ApiQuery<GetQuery>,
) -> ApiResult<Json<Value>> {
    let limit = query.entries_limit.unwrap_or(4);
    if !(1..=12).contains(&limit) {
        let message = "entriesLimit must be from 1 to 12";
        return Err(ApiError::new(ExceptionCode::UnprocessableContent, message));
    }
    let feed = match (query.id, query.url) {
        (Some(id), _) => {
            let id = id::parse(&id).ok_or_else(ApiError::feed_not_found)?;
            feed::Entity::find_by_id(id)
                .one(&state.db)
                .await?
                .ok_or_else(ApiError::feed_not_found)?
        }
        (None, Some(url)) => fetch::add_feed(&state, &url).await?,
        (None, None) => return Err(ApiError::feed_missing_id()),
    };
    // Followers and read counts are feed statistics, which are not kept.
    let mut data = json!({
        "feed": wire::Feed::from(&feed),
        "entries": latest_entries(&state.db, feed.id, limit).await?,
        "readCount": 0,
        "subscriptionCount": 0,
    });
    if let Some(user) = user {
        let subscription = subscription::Entity::find_by_id((user.id, feed.id))
            .one(&state.db)
            .await?;
        if let Some(subscription) = subscription {
            data["subscription"] = json!(wire::Subscription::new(subscription, &feed));
        }
    }
    Ok(ok(data))
}

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
    let id = id::parse(&query.id).ok_or_else(ApiError::feed_not_found)?;
    let enqueued = feed::Entity::update_many()
        .col_expr(feed::Column::RefreshEnqueuedAt, Expr::value(Utc::now()))
        .filter(feed::Column::Id.eq(id))
        .exec(&state.db)
        .await?;
    if enqueued.rows_affected == 0 {
        return Err(ApiError::feed_not_found());
    }
    fetch::refresh_feed(&state, id).await?;
    Ok(done())
}
