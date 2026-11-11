use std::collections::{HashMap, HashSet};

use axum::{Json, extract::State};
use chrono::{DateTime, SubsecRound, Utc};
use regex::Regex;
use reqwest::Url;
use sea_orm::{
    ColumnTrait, ConnectionTrait, DatabaseTransaction, DbBackend, DbErr, EntityTrait,
    FromQueryResult, QueryFilter, Statement, TransactionTrait,
};
use serde::{Deserialize, Deserializer};
use serde_json::{Value, json};

use super::{
    error::{ApiError, ApiJson, ApiResult, ExceptionCode},
    response::ok,
    session::AuthUser,
};
use crate::{
    AppState,
    entity::{action_rule, blocked_entry, entry, feed, subscription},
    rules::{self, BlockField, BlockRule, ConditionItem, Operator, Rule, Rules, Subject},
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
    // Stored as the clients write times, so the `updatedAt` they send back compares equal. Each save gets a later
    // time than the one before, which tells the rules apart in conflicts and in the cache of compiled rules.
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
        ON CONFLICT (user_id) DO UPDATE SET rules = excluded.rules,
            updated_at = GREATEST(excluded.updated_at, action_rules.updated_at + interval '1 millisecond')
        {guard} RETURNING updated_at"
    );
    let txn = state.db.begin().await?;
    let saved = txn
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            sql,
            values,
        ))
        .await?;
    let Some(saved) = saved else {
        return Err(ApiError::new(
            ExceptionCode::ActionRulesConflict,
            "The action rules were changed elsewhere",
        ));
    };
    unblock(&txn, &user.id, &Rules::new(body.rules)).await?;
    let updated_at = iso(saved.try_get("", "updated_at")?);
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

/// Refuses webhooks that are no web address, regex conditions and block rules that do not compile, and block rules
/// on `order`. Conditions and block rules stored before are not checked again: one an older version accepted must
/// not keep the user from saving other edits.
fn validate(rules: &[Rule], stored: Option<action_rule::Model>) -> ApiResult<()> {
    let stored = match stored {
        Some(row) => rules::parse(row.rules).map_err(|err| {
            tracing::error!("stored action rules do not parse: {err}");
            ApiError::internal()
        })?,
        None => Vec::new(),
    };
    let stored_conditions: HashSet<&ConditionItem> = stored
        .iter()
        .flat_map(|rule| rule.condition.0.iter().flatten())
        .collect();
    let stored_blocks: Vec<&BlockRule> = stored
        .iter()
        .flat_map(|rule| rule.result.block_rules.iter().flatten())
        .collect();
    let invalid = |message: String| ApiError::new(ExceptionCode::UnprocessableContent, message);
    let pattern = |path: String, pattern: &str| {
        Regex::new(pattern).map_err(|err| invalid(format!("`{path}`: Invalid regex: {err}")))
    };
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
                if item.operator == Operator::Regex && !stored_conditions.contains(item) {
                    pattern(format!("rules.{i}.condition.{g}.{k}.value"), &item.value)?;
                }
            }
        }
        for (j, block) in rule.result.block_rules.iter().flatten().enumerate() {
            if stored_blocks.contains(&block) {
                continue;
            }
            let path = format!("rules.{i}.result.blockRules.{j}");
            if block.field == BlockField::Order {
                return Err(invalid(format!("`{path}.field`: Unsupported field")));
            }
            if block.operator == Operator::Regex {
                pattern(format!("{path}.value"), &block.value())?;
            }
        }
    }
    Ok(())
}

/// Unblocks the entries the user's rules blocked on arrival that `rules` would not block.
async fn unblock(txn: &DatabaseTransaction, user_id: &str, rules: &Rules) -> Result<(), DbErr> {
    let sql = "SELECT * FROM entries WHERE id IN (SELECT entry_id FROM blocked_entries WHERE user_id = $1)";
    let statement = Statement::from_sql_and_values(DbBackend::Postgres, sql, [user_id.into()]);
    let entries = entry::Model::find_by_statement(statement).all(txn).await?;
    if entries.is_empty() {
        return Ok(());
    }
    let feed_ids: HashSet<i64> = entries.iter().map(|entry| entry.feed_id).collect();
    let feeds: HashMap<i64, feed::Model> = feed::Entity::find()
        .filter(feed::Column::Id.is_in(feed_ids))
        .all(txn)
        .await?
        .into_iter()
        .map(|feed| (feed.id, feed))
        .collect();
    // Blocks stay after unsubscribing; those entries are judged without a subscription.
    let subscriptions: HashMap<i64, subscription::Model> = subscription::Entity::find()
        .filter(subscription::Column::UserId.eq(user_id))
        .all(txn)
        .await?
        .into_iter()
        .map(|subscription| (subscription.feed_id, subscription))
        .collect();
    let unblocked = entries.iter().filter(|entry| {
        let subscription = subscriptions.get(&entry.feed_id);
        let subject = Subject::arriving(&feeds[&entry.feed_id], entry, subscription);
        !rules
            .apply(&subject)
            .is_some_and(|settings| rules.blocks(&settings, entry))
    });
    blocked_entry::Entity::delete_many()
        .filter(blocked_entry::Column::UserId.eq(user_id))
        .filter(blocked_entry::Column::EntryId.is_in(unblocked.map(|entry| entry.id)))
        .exec(txn)
        .await?;
    Ok(())
}
