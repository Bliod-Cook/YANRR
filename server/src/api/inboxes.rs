use axum::{Json, extract::State};
use chrono::Utc;
use sea_orm::{
    ActiveModelTrait,
    ActiveValue::{Set, Unchanged},
    ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, QueryOrder, TransactionTrait,
    sea_query::OnConflict,
};
use serde::Deserialize;
use serde_json::{Value, json};

use super::{
    error::{ApiError, ApiJson, ApiQuery, ApiResult, ExceptionCode},
    response::{ok, synced},
    session::AuthUser,
};
use crate::{
    AppState,
    entity::inbox,
    subscription::blank_to_none,
    sync::{self, Action},
    wire,
};

/// Handles are the local part of email addresses: 3 to 32 lowercase letters, digits, `_` or `-`.
fn check_handle(handle: &str) -> ApiResult<()> {
    let valid = (3..=32).contains(&handle.len())
        && handle
            .bytes()
            .all(|byte| matches!(byte, b'a'..=b'z' | b'0'..=b'9' | b'_' | b'-'));
    if valid {
        Ok(())
    } else {
        Err(ApiError::validation(format!("Invalid handle: {handle}")))
    }
}

/// The inbox at `handle`, which must be the user's.
async fn owned(db: &impl ConnectionTrait, user_id: &str, handle: &str) -> ApiResult<inbox::Model> {
    let inbox = inbox::Entity::find_by_id(handle)
        .one(db)
        .await?
        .ok_or_else(|| ApiError::new(ExceptionCode::InboxNotFound, "Inbox not found"))?;
    if inbox.user_id != user_id {
        return Err(ApiError::new(
            ExceptionCode::InboxPermissionDenied,
            "Inbox permission denied",
        ));
    }
    Ok(inbox)
}

fn changed(user_id: String, handle: String, action: &'static str, data: Value) -> Action {
    Action {
        user_id,
        model: "inbox",
        model_id: Some(handle),
        action,
        data,
    }
}

#[derive(Deserialize)]
pub struct HandleQuery {
    handle: String,
}

/// `GET /inboxes`
pub async fn get(
    State(state): State<AppState>,
    user: AuthUser,
    ApiQuery(query): ApiQuery<HandleQuery>,
) -> ApiResult<Json<Value>> {
    let inbox = owned(&state.db, &user.id, &query.handle).await?;
    Ok(ok(wire::Inbox::from(&inbox)))
}

/// `GET /inboxes/list`
pub async fn list(State(state): State<AppState>, user: AuthUser) -> ApiResult<Json<Value>> {
    let inboxes = inbox::Entity::find()
        .filter(inbox::Column::UserId.eq(user.id))
        .order_by_asc(inbox::Column::CreatedAt)
        .all(&state.db)
        .await?;
    let inboxes: Vec<_> = inboxes.iter().map(wire::Inbox::from).collect();
    Ok(ok(inboxes))
}

#[derive(Deserialize)]
pub struct CreateBody {
    handle: String,
    title: Option<String>,
}

/// `POST /inboxes`: the database draws the secret.
pub async fn create(
    State(state): State<AppState>,
    user: AuthUser,
    ApiJson(body): ApiJson<CreateBody>,
) -> ApiResult<Json<Value>> {
    check_handle(&body.handle)?;
    let row = inbox::ActiveModel {
        handle: Set(body.handle.clone()),
        user_id: Set(user.id.clone()),
        title: Set(blank_to_none(body.title)),
        created_at: Set(Utc::now()),
        ..Default::default()
    };
    let txn = state.db.begin().await?;
    let inserted = inbox::Entity::insert(row)
        .on_conflict(
            OnConflict::column(inbox::Column::Handle)
                .do_nothing()
                .to_owned(),
        )
        .exec_without_returning(&txn)
        .await?;
    if inserted == 0 {
        return Err(ApiError::new(
            ExceptionCode::InboxAlreadyExists,
            "Inbox already exists",
        ));
    }
    let inbox = owned(&txn, &user.id, &body.handle).await?;
    let data = json!(wire::InboxSubscription::from(&inbox));
    let action = changed(user.id, inbox.handle, "I", data);
    let last_sync_id = sync::record(&txn, vec![action]).await?;
    txn.commit().await?;
    Ok(synced(last_sync_id))
}

#[derive(Deserialize)]
pub struct UpdateBody {
    handle: String,
    title: String,
}

/// `PUT /inboxes`
pub async fn update(
    State(state): State<AppState>,
    user: AuthUser,
    ApiJson(body): ApiJson<UpdateBody>,
) -> ApiResult<Json<Value>> {
    let txn = state.db.begin().await?;
    let inbox = owned(&txn, &user.id, &body.handle).await?;
    let title = blank_to_none(Some(body.title));
    inbox::ActiveModel {
        handle: Unchanged(inbox.handle.clone()),
        title: Set(title.clone()),
        ..Default::default()
    }
    .update(&txn)
    .await?;
    let action = changed(user.id, inbox.handle, "U", json!({ "title": title }));
    let last_sync_id = sync::record(&txn, vec![action]).await?;
    txn.commit().await?;
    Ok(synced(last_sync_id))
}

#[derive(Deserialize)]
pub struct DeleteBody {
    handle: String,
}

/// `DELETE /inboxes`: its entries go with it.
pub async fn delete(
    State(state): State<AppState>,
    user: AuthUser,
    ApiJson(body): ApiJson<DeleteBody>,
) -> ApiResult<Json<Value>> {
    let txn = state.db.begin().await?;
    let inbox = owned(&txn, &user.id, &body.handle).await?;
    inbox::Entity::delete_by_id(&inbox.handle)
        .exec(&txn)
        .await?;
    let action = changed(user.id, inbox.handle, "D", Value::Null);
    let last_sync_id = sync::record(&txn, vec![action]).await?;
    txn.commit().await?;
    Ok(synced(last_sync_id))
}
