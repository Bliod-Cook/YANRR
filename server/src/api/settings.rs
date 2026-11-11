use axum::{
    Json,
    body::Bytes,
    extract::{Path, State},
};
use chrono::Utc;
use sea_orm::{
    ActiveValue::Set,
    ColumnTrait, EntityTrait, QueryFilter, TransactionTrait,
    sea_query::{Expr, OnConflict},
};
use serde::Deserialize;
use serde_json::{Map, Value, json};

use super::{
    error::{ApiError, ApiQuery, ApiResult, ExceptionCode},
    response::synced,
    session::AuthUser,
};
use crate::{
    AppState,
    entity::setting,
    sync::{self, Action},
    time::iso,
};

const TABS: [&str; 3] = ["ai", "general", "appearance"];

#[derive(Deserialize)]
pub struct GetQuery {
    tab: Option<String>,
}

/// `GET /settings`: only tabs that were written, so a new account gets empty objects.
pub async fn get(
    State(state): State<AppState>,
    user: AuthUser,
    ApiQuery(query): ApiQuery<GetQuery>,
) -> ApiResult<Json<Value>> {
    let mut select = setting::Entity::find().filter(setting::Column::UserId.eq(user.id));
    if let Some(tab) = query.tab {
        select = select.filter(setting::Column::Tab.eq(tab));
    }
    let (mut settings, mut updated) = (Map::new(), Map::new());
    for row in select.all(&state.db).await? {
        updated.insert(row.tab.clone(), iso(row.updated_at).into());
        settings.insert(row.tab, row.payload);
    }
    Ok(Json(
        json!({ "code": 0, "settings": settings, "updated": updated }),
    ))
}

/// `PATCH /settings/{tab}`: merges the given keys into the stored tab, as clients send only what changed.
pub async fn update(
    State(state): State<AppState>,
    user: AuthUser,
    Path(tab): Path<String>,
    body: Bytes,
) -> ApiResult<Json<Value>> {
    if !TABS.contains(&tab.as_str()) {
        return Err(ApiError::new(
            ExceptionCode::SettingInvalidTab,
            "Invalid setting tab",
        ));
    }
    let patch: Map<String, Value> = if body.is_empty() {
        Map::new()
    } else {
        serde_json::from_slice(&body).map_err(|_| {
            ApiError::new(
                ExceptionCode::SettingPayloadInvalid,
                "Invalid setting payload",
            )
        })?
    };

    let txn = state.db.begin().await?;
    let row = setting::ActiveModel {
        user_id: Set(user.id.clone()),
        tab: Set(tab.clone()),
        payload: Set(Value::Object(patch)),
        updated_at: Set(Utc::now()),
    };
    let merge = OnConflict::columns([setting::Column::UserId, setting::Column::Tab])
        .value(
            setting::Column::Payload,
            Expr::cust("settings.payload || excluded.payload"),
        )
        .update_column(setting::Column::UpdatedAt)
        .to_owned();
    let row = setting::Entity::insert(row)
        .on_conflict(merge)
        .exec_with_returning(&txn)
        .await?;
    let updated_at = iso(row.updated_at);
    // The ai tab holds API keys, which must not be copied into the log.
    let data = if tab == "ai" {
        json!({ "updatedAt": updated_at })
    } else {
        json!({ "payload": row.payload, "updatedAt": updated_at })
    };
    let action = Action {
        user_id: user.id,
        model: "setting",
        model_id: Some(tab),
        action: "U",
        data,
    };
    let last_sync_id = sync::record(&txn, vec![action]).await?;
    txn.commit().await?;
    Ok(synced(last_sync_id))
}
