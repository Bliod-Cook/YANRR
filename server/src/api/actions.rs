use std::collections::HashSet;

use axum::{Json, extract::State};
use chrono::{DateTime, SubsecRound, Utc};
use regex::Regex;
use reqwest::Url;
use sea_orm::{ConnectionTrait, DbBackend, EntityTrait, Statement, TransactionTrait};
use serde::{Deserialize, Deserializer};
use serde_json::{Value, json};

use super::{
    error::{ApiError, ApiJson, ApiResult, ExceptionCode},
    response::ok,
    session::AuthUser,
};
use crate::{
    AppState,
    entity::action_rule,
    rules::{self, ConditionItem, Operator, Rule},
    sync::{self, Action},
    time::iso,
};

/// `GET /actions`: `null` until the user first saves rules.
pub async fn get(State(state): State<AppState>, user: AuthUser) -> ApiResult<Json<Value>> {
    let row = action_rule::Entity::find_by_id(user.id)
        .one(&state.db)
        .await?;
    Ok(ok(row.map(|row| {
        json!({
            "createdAt": iso(row.created_at),
            "updatedAt": iso(row.updated_at),
            "userId": row.user_id,
            "rules": row.rules,
        })
    })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PutBody {
    rules: Vec<Rule>,
    /// `None` when left out, which saves unconditionally; `Some(None)` when no rules were stored.
    #[serde(default, deserialize_with = "present")]
    expected_updated_at: Option<Option<DateTime<Utc>>>,
}

/// Tells a `null` apart from a missing field.
fn present<'de, D: Deserializer<'de>, T: Deserialize<'de>>(
    deserializer: D,
) -> Result<Option<T>, D::Error> {
    T::deserialize(deserializer).map(Some)
}

/// `PUT /actions`: replaces the rules, unless `expectedUpdatedAt` says which rules it replaces and they changed since.
pub async fn put(
    State(state): State<AppState>,
    user: AuthUser,
    ApiJson(body): ApiJson<PutBody>,
) -> ApiResult<Json<Value>> {
    let stored = action_rule::Entity::find_by_id(&user.id)
        .one(&state.db)
        .await?;
    validate(&body.rules, stored)?;

    let rules = json!(body.rules);
    // Stored as the clients write times, so the `updatedAt` they send back compares equal.
    let now = Utc::now().trunc_subsecs(3);
    let mut values = vec![user.id.clone().into(), rules.clone().into(), now.into()];
    let guard = match body.expected_updated_at {
        None => "",
        Some(None) => "WHERE FALSE",
        Some(Some(expected)) => {
            values.push(expected.into());
            "WHERE action_rules.updated_at = $4"
        }
    };
    let sql = format!(
        "INSERT INTO action_rules (user_id, rules, created_at, updated_at) VALUES ($1, $2, $3, $3)
        ON CONFLICT (user_id) DO UPDATE SET rules = excluded.rules, updated_at = excluded.updated_at
        {guard} RETURNING user_id"
    );
    let txn = state.db.begin().await?;
    let saved = txn
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            sql,
            values,
        ))
        .await?;
    if saved.is_none() {
        return Err(ApiError::new(
            ExceptionCode::ActionRulesConflict,
            "The action rules were changed elsewhere",
        ));
    }
    let updated_at = iso(now);
    let action = Action {
        user_id: user.id,
        model: "action",
        model_id: None,
        action: "U",
        data: json!({ "rules": rules, "updatedAt": updated_at }),
    };
    let last_sync_id = sync::record(&txn, vec![action]).await?;
    txn.commit().await?;
    Ok(Json(
        json!({ "code": 0, "lastSyncId": last_sync_id, "updatedAt": updated_at }),
    ))
}

/// Refuses webhooks that are no web address and regex conditions that do not compile. Conditions stored before are
/// not checked again: a pattern an older version accepted must not keep the user from saving other edits.
fn validate(rules: &[Rule], stored: Option<action_rule::Model>) -> ApiResult<()> {
    let stored = match stored {
        Some(row) => rules::parse(row.rules).map_err(|err| {
            tracing::error!("stored action rules do not parse: {err}");
            ApiError::internal()
        })?,
        None => Vec::new(),
    };
    let stored: HashSet<&ConditionItem> = stored
        .iter()
        .flat_map(|rule| rule.condition.0.iter().flatten())
        .collect();
    let invalid = |message: String| ApiError::new(ExceptionCode::UnprocessableContent, message);
    for (i, rule) in rules.iter().enumerate() {
        for (j, webhook) in rule.result.webhooks.iter().flatten().enumerate() {
            let url = Url::parse(webhook);
            if !url.is_ok_and(|url| matches!(url.scheme(), "http" | "https")) {
                return Err(invalid(format!(
                    "`rules.{i}.result.webhooks.{j}`: Invalid URL"
                )));
            }
        }
        for (g, group) in rule.condition.0.iter().enumerate() {
            for (k, item) in group.iter().enumerate() {
                if item.operator != Operator::Regex || stored.contains(item) {
                    continue;
                }
                if let Err(err) = Regex::new(&item.value) {
                    return Err(invalid(format!(
                        "`rules.{i}.condition.{g}.{k}.value`: Invalid regex: {err}"
                    )));
                }
            }
        }
    }
    Ok(())
}
