//! Subscriptions and the unread entries they bring, shared by the API and the fetcher.

use chrono::Utc;
use sea_orm::{
    ActiveValue::Set,
    ColumnTrait, Condition, ConnectionTrait, DatabaseTransaction, DbBackend, DbErr, EntityTrait,
    FromQueryResult, PaginatorTrait, QueryFilter, QuerySelect, Statement,
    sea_query::{Expr, OnConflict},
};
use serde::{Deserialize, Deserializer};
use serde_json::{Map, Value, json};

use crate::{
    entity::{feed, subscription, unread},
    sync::Action,
    wire,
};

/// How far [`resolve`] follows `migrate_to`; longer chains only come from redirect loops.
const MAX_MIGRATIONS: usize = 5;

/// What a new subscription is created with.
pub struct Form {
    pub view: i16,
    pub category: Option<String>,
    pub title: Option<String>,
    pub hide_from_timeline: Option<bool>,
}

/// Fields of a subscription update; a field left out is kept, `null` clears it.
#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Changes {
    pub view: Option<i16>,
    #[serde(default, deserialize_with = "nullable")]
    pub category: Option<Option<String>>,
    #[serde(default, deserialize_with = "nullable")]
    pub title: Option<Option<String>>,
    #[serde(default, deserialize_with = "nullable")]
    pub hide_from_timeline: Option<Option<bool>>,
}

fn nullable<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::deserialize(deserializer).map(Some)
}

/// Clients send an empty category or title to clear it.
pub fn blank_to_none(value: Option<String>) -> Option<String> {
    value.filter(|value| !value.is_empty())
}

/// The feed at the end of `feed_id`'s `migrate_to` chain, which is the one still refreshed.
///
/// Every feed on the way is locked with `FOR SHARE`. A refresh updates its feed row first, so subscribing and
/// refreshing the same feed run one after the other; otherwise each misses the other's uncommitted rows, and new
/// entries or a migration slip past the subscriber.
pub async fn resolve(
    db: &impl ConnectionTrait,
    feed_id: i64,
) -> Result<Option<feed::Model>, DbErr> {
    let find = |id| feed::Entity::find_by_id(id).lock_shared().one(db);
    let Some(mut feed) = find(feed_id).await? else {
        return Ok(None);
    };
    for _ in 0..MAX_MIGRATIONS {
        let Some(target) = feed.migrate_to else {
            break;
        };
        match find(target).await? {
            Some(next) => feed = next,
            None => break,
        }
    }
    Ok(Some(feed))
}

pub struct Subscribed {
    pub action: Action,
    pub unread: u64,
}

/// Subscribes `user_id` to `feed`, taken from [`resolve`] in the same transaction, and marks its stored entries
/// unread.
///
/// Subscribing again changes nothing but still logs the subscription: the client treats its own copy as
/// confirmed up to the returned id and skips older rows of the feed, which could hide another device's change.
pub async fn subscribe(
    txn: &DatabaseTransaction,
    user_id: &str,
    feed: &feed::Model,
    form: Form,
) -> Result<Subscribed, DbErr> {
    let row = subscription::ActiveModel {
        user_id: Set(user_id.into()),
        feed_id: Set(feed.id),
        view: Set(form.view),
        category: Set(blank_to_none(form.category)),
        title: Set(blank_to_none(form.title)),
        hide_from_timeline: Set(form.hide_from_timeline),
        created_at: Set(Utc::now()),
    };
    let key = [subscription::Column::UserId, subscription::Column::FeedId];
    let created = subscription::Entity::insert(row)
        .on_conflict(OnConflict::columns(key).do_nothing().to_owned())
        .exec_without_returning(txn)
        .await?
        == 1;
    if created {
        let sql = "INSERT INTO unreads (user_id, entry_id, feed_id)
            SELECT $1, id, feed_id FROM entries WHERE feed_id = $2";
        txn.execute_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            sql,
            [user_id.into(), feed.id.into()],
        ))
        .await?;
    }
    let subscription = subscription::Entity::find_by_id((user_id.to_string(), feed.id))
        .one(txn)
        .await?
        .ok_or_else(|| DbErr::RecordNotFound("subscription".into()))?;
    let unread = unread::Entity::find()
        .filter(unread::Column::UserId.eq(user_id))
        .filter(unread::Column::FeedId.eq(feed.id))
        .count(txn)
        .await?;
    Ok(Subscribed {
        action: inserted(subscription, feed),
        unread,
    })
}

fn inserted(subscription: subscription::Model, feed: &feed::Model) -> Action {
    Action {
        user_id: subscription.user_id.clone(),
        model: "subscription",
        model_id: Some(feed.id.to_string()),
        action: "I",
        data: json!(wire::Subscription::new(subscription, feed)),
    }
}

fn deleted(user_id: String, feed_id: i64) -> Action {
    Action {
        user_id,
        model: "subscription",
        model_id: Some(feed_id.to_string()),
        action: "D",
        data: Value::Null,
    }
}

/// Applies `changes` to the user's subscriptions matching `filter`; logs one `U` per subscription changed.
pub async fn update(
    txn: &DatabaseTransaction,
    user_id: &str,
    filter: Condition,
    changes: Changes,
) -> Result<Vec<Action>, DbErr> {
    let mut update = subscription::Entity::update_many();
    let mut data = Map::new();
    if let Some(view) = changes.view {
        update = update.col_expr(subscription::Column::View, Expr::value(view));
        data.insert("view".into(), view.into());
    }
    if let Some(category) = changes.category {
        let category = blank_to_none(category);
        update = update.col_expr(
            subscription::Column::Category,
            Expr::value(category.clone()),
        );
        data.insert("category".into(), category.into());
    }
    if let Some(title) = changes.title {
        let title = blank_to_none(title);
        update = update.col_expr(subscription::Column::Title, Expr::value(title.clone()));
        data.insert("title".into(), title.into());
    }
    if let Some(hide) = changes.hide_from_timeline {
        update = update.col_expr(subscription::Column::HideFromTimeline, Expr::value(hide));
        data.insert("hideFromTimeline".into(), hide.into());
    }
    if data.is_empty() {
        return Ok(Vec::new());
    }
    let updated = update
        .filter(subscription::Column::UserId.eq(user_id))
        .filter(filter)
        .exec_with_returning(txn)
        .await?;
    Ok(updated
        .into_iter()
        .map(|subscription| Action {
            user_id: subscription.user_id,
            model: "subscription",
            model_id: Some(subscription.feed_id.to_string()),
            action: "U",
            data: Value::Object(data.clone()),
        })
        .collect())
}

/// Unsubscribes `user_id` from `feed_ids` and drops their unread entries; logs one `D` per subscription removed.
pub async fn unsubscribe(
    txn: &DatabaseTransaction,
    user_id: &str,
    feed_ids: &[i64],
) -> Result<Vec<Action>, DbErr> {
    // The same lock as `resolve`: a refresh in flight must not add unread rows or an `N` after the delete.
    feed::Entity::find()
        .filter(feed::Column::Id.is_in(feed_ids.iter().copied()))
        .lock_shared()
        .all(txn)
        .await?;
    let removed = subscription::Entity::delete_many()
        .filter(subscription::Column::UserId.eq(user_id))
        .filter(subscription::Column::FeedId.is_in(feed_ids.iter().copied()))
        .exec_with_returning(txn)
        .await?;
    unread::Entity::delete_many()
        .filter(unread::Column::UserId.eq(user_id))
        .filter(unread::Column::FeedId.is_in(feed_ids.iter().copied()))
        .exec(txn)
        .await?;
    Ok(removed
        .into_iter()
        .map(|subscription| deleted(subscription.user_id, subscription.feed_id))
        .collect())
}

/// Moves the subscriptions of `old`, which just migrated, to `target`.
///
/// Moved users get `target`'s entries unread, except those whose guid they already read on `old`. Users who
/// already followed `target` only lose the old subscription.
pub async fn migrate(
    txn: &DatabaseTransaction,
    old: i64,
    target: &feed::Model,
) -> Result<Vec<Action>, DbErr> {
    let moved_sql = "WITH moved AS (
            INSERT INTO subscriptions
                (user_id, feed_id, view, category, title, hide_from_timeline, created_at)
            SELECT user_id, $2, view, category, title, hide_from_timeline, created_at
            FROM subscriptions WHERE feed_id = $1
            ON CONFLICT DO NOTHING
            RETURNING *
        ), unread AS (
            INSERT INTO unreads (user_id, entry_id, feed_id)
            SELECT moved.user_id, entry.id, entry.feed_id
            FROM moved JOIN entries entry ON entry.feed_id = moved.feed_id
            WHERE NOT EXISTS (
                SELECT 1 FROM entries old_entry
                WHERE old_entry.feed_id = $1 AND old_entry.guid = entry.guid
                  AND NOT EXISTS (
                      SELECT 1 FROM unreads WHERE user_id = moved.user_id AND entry_id = old_entry.id
                  )
            )
        )
        SELECT * FROM moved";
    let moved = subscription::Model::find_by_statement(Statement::from_sql_and_values(
        DbBackend::Postgres,
        moved_sql,
        [old.into(), target.id.into()],
    ))
    .all(txn)
    .await?;
    let removed = subscription::Entity::delete_many()
        .filter(subscription::Column::FeedId.eq(old))
        .exec_with_returning(txn)
        .await?;
    unread::Entity::delete_many()
        .filter(unread::Column::FeedId.eq(old))
        .exec(txn)
        .await?;
    let mut actions: Vec<_> = removed
        .into_iter()
        .map(|subscription| deleted(subscription.user_id, old))
        .collect();
    actions.extend(
        moved
            .into_iter()
            .map(|subscription| inserted(subscription, target)),
    );
    Ok(actions)
}
