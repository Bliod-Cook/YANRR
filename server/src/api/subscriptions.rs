use axum::{Json, extract::State};
use sea_orm::{ColumnTrait, Condition, EntityTrait, QueryFilter, QueryOrder, TransactionTrait};
use serde::Deserialize;
use serde_json::{Value, json};

use super::{
    error::{ApiError, ApiJson, ApiQuery, ApiResult, ExceptionCode, view},
    response::{ok, synced},
    session::AuthUser,
};
use crate::{
    AppState,
    entity::{feed, subscription},
    fetch, id,
    subscription::{self as subscriptions, Changes, Form},
    sync, wire,
};

#[derive(Deserialize)]
pub struct ListQuery {
    view: Option<i16>,
}

/// `GET /subscriptions`
pub async fn list(
    State(state): State<AppState>,
    user: AuthUser,
    ApiQuery(query): ApiQuery<ListQuery>,
) -> ApiResult<Json<Value>> {
    let mut select = subscription::Entity::find()
        .filter(subscription::Column::UserId.eq(user.id))
        .order_by_asc(subscription::Column::CreatedAt);
    if let Some(view) = query.view {
        select = select.filter(subscription::Column::View.eq(view));
    }
    let rows = select
        .find_also_related(feed::Entity)
        .all(&state.db)
        .await?;
    let subscriptions: Vec<_> = rows
        .into_iter()
        .filter_map(|(subscription, feed)| Some(wire::Subscription::new(subscription, &feed?)))
        .collect();
    Ok(ok(subscriptions))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateBody {
    feed_id: Option<String>,
    url: Option<String>,
    #[serde(default)]
    view: i16,
    category: Option<String>,
    title: Option<String>,
    hide_from_timeline: Option<bool>,
}

/// `POST /subscriptions`: by `feedId` first, as clients expect, else by `url`, fetching a new feed.
pub async fn create(
    State(state): State<AppState>,
    user: AuthUser,
    ApiJson(body): ApiJson<CreateBody>,
) -> ApiResult<Json<Value>> {
    let view = view(body.view)?;
    let feed_id = match (body.feed_id, body.url) {
        (Some(feed_id), _) => id::parse(&feed_id).ok_or_else(ApiError::feed_not_found)?,
        (None, Some(url)) => fetch::add_feed(&state, &url).await?.id,
        (None, None) => return Err(ApiError::feed_missing_id()),
    };
    let txn = state.db.begin().await?;
    let feed = subscriptions::resolve(&txn, feed_id)
        .await?
        .ok_or_else(ApiError::feed_not_found)?;
    let form = Form {
        view,
        category: body.category,
        title: body.title,
        hide_from_timeline: body.hide_from_timeline,
    };
    let subscribed = subscriptions::subscribe(&txn, &user.id, &feed, form).await?;
    let last_sync_id = sync::record(&txn, vec![subscribed.action]).await?;
    txn.commit().await?;
    let mut unread = serde_json::Map::new();
    unread.insert(feed.id.to_string(), subscribed.unread.into());
    Ok(Json(json!({
        "code": 0,
        "feed": wire::Feed::from(&feed),
        "list": null,
        "unread": unread,
        "lastSyncId": last_sync_id,
    })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateBody {
    feed_id: Option<String>,
    #[serde(flatten)]
    changes: Changes,
}

/// `PATCH /subscriptions`: changes only the fields sent.
pub async fn update(
    State(state): State<AppState>,
    user: AuthUser,
    ApiJson(body): ApiJson<UpdateBody>,
) -> ApiResult<Json<Value>> {
    body.changes.view.map(view).transpose()?;
    let not_found = || ApiError::new(ExceptionCode::NotFound, "Subscription not found");
    let feed_id = body
        .feed_id
        .as_deref()
        .and_then(id::parse)
        .ok_or_else(not_found)?;
    let txn = state.db.begin().await?;
    let filter = Condition::all().add(subscription::Column::FeedId.eq(feed_id));
    let actions = subscriptions::update(&txn, &user.id, filter, body.changes).await?;
    if actions.is_empty() {
        let exists = subscription::Entity::find_by_id((user.id.clone(), feed_id))
            .one(&txn)
            .await?;
        exists.ok_or_else(not_found)?;
    }
    let last_sync_id = sync::record(&txn, actions).await?;
    txn.commit().await?;
    Ok(synced(last_sync_id))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchBody {
    feed_ids: Vec<String>,
    #[serde(flatten)]
    changes: Changes,
}

/// `PATCH /subscriptions/batch`: feeds the user does not follow are skipped.
pub async fn update_batch(
    State(state): State<AppState>,
    user: AuthUser,
    ApiJson(body): ApiJson<BatchBody>,
) -> ApiResult<Json<Value>> {
    body.changes.view.map(view).transpose()?;
    let feed_ids = body.feed_ids.iter().filter_map(|id| id::parse(id));
    let filter = Condition::all().add(subscription::Column::FeedId.is_in(feed_ids));
    let txn = state.db.begin().await?;
    let actions = subscriptions::update(&txn, &user.id, filter, body.changes).await?;
    let last_sync_id = sync::record(&txn, actions).await?;
    txn.commit().await?;
    Ok(synced(last_sync_id))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteBody {
    feed_id: Option<String>,
    #[serde(default)]
    feed_id_list: Vec<String>,
    url: Option<String>,
}

/// `DELETE /subscriptions`
pub async fn delete(
    State(state): State<AppState>,
    user: AuthUser,
    ApiJson(body): ApiJson<DeleteBody>,
) -> ApiResult<Json<Value>> {
    let mut feed_ids: Vec<_> = body
        .feed_id_list
        .iter()
        .chain(&body.feed_id)
        .filter_map(|id| id::parse(id))
        .collect();
    if let Some(url) = body.url {
        let feed = feed::Entity::find()
            .filter(feed::Column::Url.eq(url))
            .one(&state.db)
            .await?;
        feed_ids.extend(feed.map(|feed| feed.id));
    }
    let txn = state.db.begin().await?;
    let actions = subscriptions::unsubscribe(&txn, &user.id, &feed_ids).await?;
    let last_sync_id = sync::record(&txn, actions).await?;
    txn.commit().await?;
    Ok(synced(last_sync_id))
}
