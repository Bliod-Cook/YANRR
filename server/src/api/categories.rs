use axum::{Json, extract::State};
use sea_orm::{ColumnTrait, Condition, TransactionTrait};
use serde::Deserialize;
use serde_json::Value;

use super::{
    error::{ApiError, ApiJson, ApiResult, ExceptionCode},
    response::synced,
    session::AuthUser,
};
use crate::{
    AppState,
    entity::subscription,
    id,
    subscription::{self as subscriptions, Changes},
    sync,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateBody {
    from: Option<String>,
    to: Option<String>,
    view: Option<i16>,
    feed_id_list: Option<Vec<String>>,
    category: Option<String>,
}

fn feeds(ids: &[String]) -> Condition {
    let ids = ids.iter().filter_map(|id| id::parse(id));
    Condition::all().add(subscription::Column::FeedId.is_in(ids))
}

/// `PATCH /categories`: renames `from` to `to`, in one view or all of them, or puts `feedIdList` in `category`.
pub async fn update(
    State(state): State<AppState>,
    user: AuthUser,
    ApiJson(body): ApiJson<UpdateBody>,
) -> ApiResult<Json<Value>> {
    let (filter, category) = match body {
        UpdateBody {
            from: Some(from),
            to: Some(to),
            view,
            ..
        } => {
            let mut filter = Condition::all().add(subscription::Column::Category.eq(from));
            if let Some(view) = view.filter(|view| *view != -1) {
                filter = filter.add(subscription::Column::View.eq(view));
            }
            (filter, to)
        }
        UpdateBody {
            feed_id_list: Some(ids),
            category: Some(category),
            ..
        } => (feeds(&ids), category),
        _ => {
            let message = "from and to, or feedIdList and category required";
            return Err(ApiError::new(ExceptionCode::InvalidInput, message));
        }
    };
    let changes = Changes {
        category: Some(Some(category)),
        ..Default::default()
    };
    let txn = state.db.begin().await?;
    let actions = subscriptions::update(&txn, &user.id, filter, changes).await?;
    let last_sync_id = sync::record(&txn, actions).await?;
    txn.commit().await?;
    Ok(synced(last_sync_id))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteBody {
    feed_id_list: Vec<String>,
    delete_subscriptions: bool,
}

/// `DELETE /categories`: takes the feeds out of their category, or unsubscribes from them.
pub async fn delete(
    State(state): State<AppState>,
    user: AuthUser,
    ApiJson(body): ApiJson<DeleteBody>,
) -> ApiResult<Json<Value>> {
    let txn = state.db.begin().await?;
    let actions = if body.delete_subscriptions {
        let ids: Vec<_> = body
            .feed_id_list
            .iter()
            .filter_map(|id| id::parse(id))
            .collect();
        subscriptions::unsubscribe(&txn, &user.id, &ids).await?
    } else {
        let changes = Changes {
            category: Some(None),
            ..Default::default()
        };
        subscriptions::update(&txn, &user.id, feeds(&body.feed_id_list), changes).await?
    };
    let last_sync_id = sync::record(&txn, actions).await?;
    txn.commit().await?;
    Ok(synced(last_sync_id))
}
