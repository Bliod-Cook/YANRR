use axum::{Json, extract::State};
use chrono::{SubsecRound, Utc};
use sea_orm::{
    ActiveValue::Set, ColumnTrait, ConnectionTrait, DbErr, EntityTrait, QueryFilter,
    TransactionTrait, sea_query::OnConflict,
};
use serde::Deserialize;
use serde_json::{Value, json};

use super::{
    entries::find_marked,
    error::{ApiError, ApiJson, ApiResult, view},
    response::synced,
    session::AuthUser,
};
use crate::{
    AppState,
    entity::{collection, entry, feed},
    id,
    rules::{
        Rules,
        deliver::{self, Delivery},
    },
    sync::{self, Action},
    time::iso,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectBody {
    entry_id: String,
    view: Option<i16>,
}

/// `POST /collections`: collecting an entry twice keeps the first time. Rules matching the entry once it is
/// collected forward it.
pub async fn collect(
    State(state): State<AppState>,
    user: AuthUser,
    ApiJson(body): ApiJson<CollectBody>,
) -> ApiResult<Json<Value>> {
    let view = view(body.view.unwrap_or(0))?;
    let entry_id = id::parse(&body.entry_id).ok_or_else(ApiError::entry_not_found)?;
    let entry = entry::Entity::find_by_id(entry_id)
        .one(&state.db)
        .await?
        .ok_or_else(ApiError::entry_not_found)?;
    // Collection times are timeline cursors, which clients send back in milliseconds.
    let created_at = Utc::now().trunc_subsecs(3);
    let row = collection::ActiveModel {
        user_id: Set(user.id.clone()),
        entry_id: Set(entry.id),
        view: Set(view),
        created_at: Set(created_at),
    };
    let key = [collection::Column::UserId, collection::Column::EntryId];
    let txn = state.db.begin().await?;
    let inserted = collection::Entity::insert(row)
        .on_conflict(OnConflict::columns(key).do_nothing().to_owned())
        .exec_without_returning(&txn)
        .await?;
    let delivery = if inserted == 1 {
        starred(&txn, &user.id, entry.id).await?
    } else {
        None
    };
    let actions = (inserted == 1).then(|| Action {
        user_id: user.id,
        model: "collection",
        model_id: Some(entry.id.to_string()),
        action: "I",
        data: json!({
            "entryId": entry.id.to_string(),
            "feedId": entry.feed_id.to_string(),
            "view": view,
            "createdAt": iso(created_at),
        }),
    });
    let last_sync_id = sync::record(&txn, actions.into_iter().collect()).await?;
    txn.commit().await?;
    if let Some((feed, delivery)) = delivery {
        deliver::spawn(&state, &feed, vec![delivery]);
    }
    Ok(synced(last_sync_id))
}

/// What the user's rules send out about an entry just collected: only those matching it because it is collected
/// do, so that the others do not send it again.
async fn starred(
    db: &impl ConnectionTrait,
    user_id: &str,
    entry_id: i64,
) -> Result<Option<(feed::Model, Delivery)>, DbErr> {
    let Some((entry, marks)) = find_marked(db, user_id, entry_id).await? else {
        return Ok(None);
    };
    let Some(feed) = feed::Entity::find_by_id(entry.feed_id).one(db).await? else {
        return Ok(None);
    };
    let rules = Rules::load(db, user_id).await?;
    let subject = marks.subject(&feed, &entry);
    let Some(sent) = rules.apply_collected(&subject) else {
        return Ok(None);
    };
    let shown = rules.apply(&subject).unwrap_or_default();
    let delivery = Delivery::of(user_id, &subject, &sent, &shown);
    Ok(delivery.map(|delivery| (feed, delivery)))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UncollectBody {
    entry_id: String,
}

/// `DELETE /collections`
pub async fn uncollect(
    State(state): State<AppState>,
    user: AuthUser,
    ApiJson(body): ApiJson<UncollectBody>,
) -> ApiResult<Json<Value>> {
    let entry_id = id::parse(&body.entry_id).ok_or_else(ApiError::entry_not_found)?;
    let txn = state.db.begin().await?;
    let deleted = collection::Entity::delete_many()
        .filter(collection::Column::UserId.eq(&user.id))
        .filter(collection::Column::EntryId.eq(entry_id))
        .exec(&txn)
        .await?;
    let actions = (deleted.rows_affected == 1).then(|| Action {
        user_id: user.id,
        model: "collection",
        model_id: Some(entry_id.to_string()),
        action: "D",
        data: Value::Null,
    });
    let last_sync_id = sync::record(&txn, actions.into_iter().collect()).await?;
    txn.commit().await?;
    Ok(synced(last_sync_id))
}
