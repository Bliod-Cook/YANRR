use axum::{Json, extract::State};
use sea_orm::{
    ColumnTrait, Condition, EntityTrait, IntoActiveModel, QueryFilter, QueryOrder,
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
    push::{self, Notification},
    sync,
};

const CHANNELS: [&str; 7] = [
    "macos", "windows", "linux", "ios", "android", "web", "desktop",
];

/// `GET /messaging`: the user's devices.
pub async fn list(State(state): State<AppState>, user: AuthUser) -> ApiResult<Json<Value>> {
    let tokens = messaging_token::Entity::find()
        .filter(messaging_token::Column::UserId.eq(user.id))
        .order_by_asc(messaging_token::Column::Channel)
        .order_by_asc(messaging_token::Column::Token)
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

/// `POST /messaging`: registers a device's token; each device of the user gets their notifications. A token
/// registered before by another account or on another channel moves here, so a device signed into a new account
/// stops getting the old one's notifications.
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
        .map(|row| push::change(row, "D"))
        .collect();
    let row = messaging_token::Model {
        token: body.token,
        user_id: user.id,
        channel: body.channel,
    };
    let inserted = messaging_token::Entity::insert(row.clone().into_active_model())
        .on_conflict(
            OnConflict::column(messaging_token::Column::Token)
                .do_nothing()
                .to_owned(),
        )
        .exec_without_returning(&txn)
        .await?;
    if inserted == 1 {
        actions.push(push::change(row, "U"));
    }
    let last_sync_id = sync::record(&txn, actions).await?;
    txn.commit().await?;
    Ok(synced(last_sync_id))
}

#[derive(Deserialize)]
pub struct DeleteBody {
    token: String,
}

/// `DELETE /messaging`: unregisters the device with `token`.
pub async fn delete(
    State(state): State<AppState>,
    user: AuthUser,
    ApiJson(body): ApiJson<DeleteBody>,
) -> ApiResult<Json<Value>> {
    let txn = state.db.begin().await?;
    let deleted = messaging_token::Entity::delete_many()
        .filter(messaging_token::Column::UserId.eq(&user.id))
        .filter(messaging_token::Column::Token.eq(&body.token))
        .exec_with_returning(&txn)
        .await?;
    let actions = deleted
        .into_iter()
        .map(|row| push::change(row, "D"))
        .collect();
    let last_sync_id = sync::record(&txn, actions).await?;
    txn.commit().await?;
    Ok(synced(last_sync_id))
}

#[derive(Deserialize)]
pub struct TestQuery {
    channel: Option<String>,
}

/// `GET /messaging/test`: a notification to each of the user's devices, or to those on `channel`. Devices FCM no
/// longer knows are forgotten; it fails when it failed on any other.
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
    let mut select = messaging_token::Entity::find()
        .filter(messaging_token::Column::UserId.eq(user.id.as_str()));
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
    let sent = fcm
        .send(&state.db, &state.http, &user.id, &tokens, &notification)
        .await
        .map_err(|err| {
            tracing::warn!("test push failed: {err}");
            ApiError::new(ExceptionCode::InternalError, "Push failed")
        })?;
    tracing::info!(
        "test push: {} delivered, {} unregistered device(s) forgotten, {} failed",
        sent.delivered,
        sent.forgotten,
        sent.failures.len()
    );
    if !sent.failures.is_empty() {
        tracing::warn!("test push failed: {}", sent.failures.join("; "));
        let message = format!("Push failed on {} device(s)", sent.failures.len());
        return Err(ApiError::new(ExceptionCode::InternalError, message));
    }
    Ok(done())
}
