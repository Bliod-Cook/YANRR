use axum::{
    Json,
    extract::State,
    http::{HeaderMap, header},
};
use chrono::{DateTime, SubsecRound, Utc};
use reqwest::Url;
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
    response::{done, ok, synced},
    session::AuthUser,
};
use crate::{
    AppState,
    entity::{inbox, inbox_entry},
    fetch::{html, language, parse},
    id::next_id,
    subscription::blank_to_none,
    sync::{self, Action},
    time::iso,
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

/// An entry for an inbox, as webhooks post it.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewEntry {
    guid: String,
    published_at: DateTime<Utc>,
    title: Option<String>,
    url: Option<String>,
    description: Option<String>,
    content: Option<String>,
    author: Option<String>,
    author_url: Option<String>,
    author_avatar: Option<String>,
    categories: Option<Vec<String>>,
    media: Option<Value>,
    attachments: Option<Value>,
    extra: Option<Value>,
    language: Option<String>,
    /// Whether it arrives read.
    read: Option<bool>,
}

/// Stores `entry` in `inbox` unless the inbox has one with its guid, and tells the owner with a `timeline N`. A
/// description or media left out are taken from the content, as for feeds.
async fn deliver(state: &AppState, inbox: &inbox::Model, entry: NewEntry) -> ApiResult<()> {
    let read = entry.read.unwrap_or(false);
    let content = entry.content.as_deref();
    let description = entry
        .description
        .or_else(|| content.and_then(parse::describe));
    let media = entry.media.or_else(|| {
        let base = entry.url.as_deref().and_then(|url| Url::parse(url).ok());
        let media = html::media(content?, base.as_ref());
        (!media.is_empty()).then(|| json!(media))
    });
    // Clients send timestamps back as cursors with millisecond precision.
    let published_at = entry.published_at.trunc_subsecs(3);
    let row = inbox_entry::ActiveModel {
        id: Set(next_id()),
        inbox_handle: Set(inbox.handle.clone()),
        guid: Set(entry.guid),
        title: Set(entry.title),
        url: Set(entry.url),
        description: Set(description),
        content: Set(entry.content),
        author: Set(entry.author),
        author_url: Set(entry.author_url),
        author_avatar: Set(entry.author_avatar),
        categories: Set(entry.categories),
        media: Set(media),
        attachments: Set(entry.attachments),
        extra: Set(entry.extra),
        language: Set(entry.language),
        read: Set(read),
        published_at: Set(published_at),
        inserted_at: Set(Utc::now().trunc_subsecs(3)),
    };
    let key = [inbox_entry::Column::InboxHandle, inbox_entry::Column::Guid];
    let txn = state.db.begin().await?;
    let inserted = inbox_entry::Entity::insert(row)
        .on_conflict(OnConflict::columns(key).do_nothing().to_owned())
        .exec_without_returning(&txn)
        .await?;
    let actions = (inserted == 1).then(|| Action {
        user_id: inbox.user_id.clone(),
        model: "timeline",
        model_id: Some(inbox.handle.clone()),
        action: "N",
        data: json!({
            "inboxId": inbox.handle,
            "isInbox": true,
            "count": 1,
            "unread": u8::from(!read),
            "latestPublishedAt": iso(published_at),
            "from": ["inbox"],
        }),
    });
    sync::record(&txn, actions.into_iter().collect()).await?;
    txn.commit().await?;
    Ok(())
}

fn bearer(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(header::AUTHORIZATION)?
        .to_str()
        .ok()?
        .strip_prefix("Bearer ")
}

/// `POST /inboxes/webhook`: the bearer token is the secret of the inbox the entry goes to.
pub async fn webhook(
    State(state): State<AppState>,
    headers: HeaderMap,
    ApiJson(entry): ApiJson<NewEntry>,
) -> ApiResult<Json<Value>> {
    let secret = bearer(&headers).ok_or_else(ApiError::unauthorized)?;
    let inbox = inbox::Entity::find()
        .filter(inbox::Column::Secret.eq(secret))
        .one(&state.db)
        .await?
        .ok_or_else(ApiError::unauthorized)?;
    deliver(&state, &inbox, entry).await?;
    Ok(done())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Email {
    from: Sender,
    to: Recipient,
    subject: Option<String>,
    message_id: String,
    date: DateTime<Utc>,
    html: Option<String>,
}

#[derive(Deserialize)]
pub struct Sender {
    name: Option<String>,
    address: Option<String>,
}

#[derive(Deserialize)]
pub struct Recipient {
    address: String,
}

/// The largest email body accepted, against the default 2 MB that newsletters easily pass.
pub const EMAIL_BODY_LIMIT: usize = 25 << 20;

/// `POST /inboxes/email`: an email the inbound mail service received, sent with the configured secret. The local
/// part of the recipient's address is the inbox handle; the domain is not checked.
pub async fn email(
    State(state): State<AppState>,
    headers: HeaderMap,
    ApiJson(email): ApiJson<Email>,
) -> ApiResult<Json<Value>> {
    let secret = state.config.inbox.email_secret.as_deref();
    if secret.is_none() || bearer(&headers) != secret {
        return Err(ApiError::unauthorized());
    }
    let local_part = email.to.address.split('@').next().unwrap_or_default();
    let inbox = inbox::Entity::find_by_id(local_part.to_lowercase())
        .one(&state.db)
        .await?
        .ok_or_else(|| ApiError::new(ExceptionCode::InboxNotFound, "Inbox not found"))?;
    let description = email.html.as_deref().and_then(parse::describe);
    let text = [email.subject.as_deref(), description.as_deref()]
        .into_iter()
        .flatten();
    let language = language::detect(&text.collect::<Vec<_>>().join(" "));
    let entry = NewEntry {
        guid: email.message_id,
        published_at: email.date,
        title: email.subject,
        url: None,
        description,
        content: email.html,
        author: email.from.name.or_else(|| email.from.address.clone()),
        // Clients take the sender's address from a `mailto:` link.
        author_url: email
            .from
            .address
            .map(|address| format!("mailto:{address}")),
        author_avatar: None,
        categories: None,
        media: None,
        attachments: None,
        extra: None,
        language,
        read: None,
    };
    deliver(&state, &inbox, entry).await?;
    Ok(done())
}

/// Whether a timeline of `view` shows inbox entries: clients keep inboxes in Articles, which All includes.
pub fn in_view(view: Option<i16>) -> bool {
    view.is_none_or(|view| view == 0 || view == -1)
}
