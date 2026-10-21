use axum::{Json, extract::State};
use sea_orm::{
    ActiveValue::Set, ColumnTrait, Condition, EntityTrait, QueryFilter, QueryOrder,
    TransactionTrait, sea_query::OnConflict,
};
use serde::Deserialize;
use serde_json::{Value, json};

use super::{
    error::{ApiError, ApiJson, ApiQuery, ApiResult, ExceptionCode},
    response::{done, ok, synced},
    session::AuthUser,
};
use crate::{
    AppState,
    entity::messaging_token,
    push::Notification,
    sync::{self, Action},
};

const CHANNELS: [&str; 7] = [
    "macos", "windows", "linux", "ios", "android", "web", "desktop",
];

/// A `messaging` change, which names the channel but never carries the token.
fn changed(user_id: String, channel: String, action: &'static str) -> Action {
    Action {
        user_id,
        model: "messaging",
        model_id: Some(channel.clone()),
        action,
        data: json!({ "channel": channel }),
    }
}

/// `GET /messaging`
pub async fn list(State(state): State<AppState>, user: AuthUser) -> ApiResult<Json<Value>> {
    let tokens = messaging_token::Entity::find()
        .filter(messaging_token::Column::UserId.eq(user.id))
        .order_by_asc(messaging_token::Column::Channel)
        .all(&state.db)
        .await?;
    let tokens: Vec<_> = tokens
        .into_iter()
        .map(|row| json!({ "userId": row.user_id, "token": row.token, "channel": row.channel }))
        .collect();
    Ok(ok(tokens))
}

#[derive(Deserialize)]
pub struct CreateBody {
    token: String,
    channel: String,
}

/// `POST /messaging`: one token per user and channel. A token registered before by another account or channel
/// moves here, so a device signed into a new account stops getting the old one's notifications.
pub async fn create(
    State(state): State<AppState>,
    user: AuthUser,
    ApiJson(body): ApiJson<CreateBody>,
) -> ApiResult<Json<Value>> {
    if !CHANNELS.contains(&body.channel.as_str()) {
        return Err(ApiError::validation(format!(
            "Invalid channel: {}",
            body.channel
        )));
    }
    let txn = state.db.begin().await?;
    let elsewhere = Condition::any()
        .add(messaging_token::Column::UserId.ne(&user.id))
        .add(messaging_token::Column::Channel.ne(&body.channel));
    let moved = messaging_token::Entity::delete_many()
        .filter(messaging_token::Column::Token.eq(&body.token))
        .filter(elsewhere)
        .exec_with_returning(&txn)
        .await?;
    let mut actions: Vec<_> = moved
        .into_iter()
        .map(|row| changed(row.user_id, row.channel, "D"))
        .collect();
    let row = messaging_token::ActiveModel {
        user_id: Set(user.id.clone()),
        channel: Set(body.channel.clone()),
        token: Set(body.token),
    };
    let key = [
        messaging_token::Column::UserId,
        messaging_token::Column::Channel,
    ];
    messaging_token::Entity::insert(row)
        .on_conflict(
            OnConflict::columns(key)
                .update_column(messaging_token::Column::Token)
                .to_owned(),
        )
        .exec_without_returning(&txn)
        .await?;
    actions.push(changed(user.id, body.channel, "U"));
    let last_sync_id = sync::record(&txn, actions).await?;
    txn.commit().await?;
    Ok(synced(last_sync_id))
}

#[derive(Deserialize)]
pub struct DeleteBody {
    channel: String,
}

/// `DELETE /messaging`
pub async fn delete(
    State(state): State<AppState>,
    user: AuthUser,
    ApiJson(body): ApiJson<DeleteBody>,
) -> ApiResult<Json<Value>> {
    let txn = state.db.begin().await?;
    let deleted = messaging_token::Entity::delete_many()
        .filter(messaging_token::Column::UserId.eq(&user.id))
        .filter(messaging_token::Column::Channel.eq(&body.channel))
        .exec(&txn)
        .await?;
    let actions = (deleted.rows_affected == 1).then(|| changed(user.id, body.channel, "D"));
    let last_sync_id = sync::record(&txn, actions.into_iter().collect()).await?;
    txn.commit().await?;
    Ok(synced(last_sync_id))
}

#[derive(Deserialize)]
pub struct TestQuery {
    channel: Option<String>,
}

/// `GET /messaging/test`: a notification to each of the user's devices, or to those on `channel`.
pub async fn test(
    State(state): State<AppState>,
    user: AuthUser,
    ApiQuery(query): ApiQuery<TestQuery>,
) -> ApiResult<Json<Value>> {
    let fcm = state.push.as_ref().ok_or_else(|| {
        ApiError::new(
            ExceptionCode::MissingConfiguration,
            "Push notifications are not configured",
        )
    })?;
    let mut select =
        messaging_token::Entity::find().filter(messaging_token::Column::UserId.eq(user.id));
    if let Some(channel) = query.channel {
        select = select.filter(messaging_token::Column::Channel.eq(channel));
    }
    let tokens: Vec<_> = select
        .all(&state.db)
        .await?
        .into_iter()
        .map(|row| row.token)
        .collect();
    let notification = Notification {
        title: "Yanrr".into(),
        description: "Test notification".into(),
        feed_id: String::new(),
        entry_id: String::new(),
        view: 0,
    };
    fcm.send(&state.http, &tokens, &notification)
        .await
        .map_err(|err| ApiError::new(ExceptionCode::InternalError, err))?;
    Ok(done())
}
