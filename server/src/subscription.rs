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
    search,
    sync::Action,
    wire,
};

/// How far [`resolve`] follows `migrate_to`; longer chains only come from redirect loops.
const MAX_MIGRATIONS: usize = 5;

/// How many of a feed's latest entries a new subscription marks unread; older ones count as read.
const UNREAD_ON_FOLLOW: u64 = 100;

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
    /// False when the user already followed the feed.
    pub created: bool,
}

/// Subscribes `user_id` to `feed`, taken from [`resolve`] in the same transaction, and marks its latest stored
/// entries unread.
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
        let sql = format!(
            "INSERT INTO unreads (user_id, entry_id, feed_id)
            SELECT $1, id, feed_id FROM entries WHERE feed_id = $2
                AND id NOT IN (SELECT entry_id FROM blocked_entries WHERE user_id = $1)
            ORDER BY published_at DESC, id DESC LIMIT {UNREAD_ON_FOLLOW}"
        );
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
        created,
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

/// Unsubscribes `user_id` from `feed_ids`, whose unread marks go with them; logs one `D` per subscription removed.
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
    Ok(removed
        .into_iter()
        .map(|subscription| deleted(subscription.user_id, subscription.feed_id))
        .collect())
}

/// Moves the subscriptions of `old`, which just migrated, to `target`, along with the entries of `old` that `target`
/// lacks.
///
/// Moved users keep what they blocked and what they left unread, and get `target`'s latest entries unread as a new
/// subscription does, except those whose guid they already read on `old`. Users who already followed `target` only
/// lose the old subscription.
pub async fn migrate(
    txn: &DatabaseTransaction,
    old: i64,
    target: &feed::Model,
) -> Result<Vec<Action>, DbErr> {
    // `$1` is the old feed, `$2` the target, and `$3` the users moved, if given.
    let statement = |sql: &str, users: Option<&Vec<String>>| {
        let mut params = vec![old.into(), target.id.into()];
        params.extend(users.map(|users| users.clone().into()));
        Statement::from_sql_and_values(DbBackend::Postgres, sql, params)
    };
    let moved_sql = "INSERT INTO subscriptions
            (user_id, feed_id, view, category, title, hide_from_timeline, created_at)
        SELECT user_id, $2, view, category, title, hide_from_timeline, created_at
        FROM subscriptions WHERE feed_id = $1
        ON CONFLICT DO NOTHING
        RETURNING *";
    let moved = subscription::Model::find_by_statement(statement(moved_sql, None))
        .all(txn)
        .await?;
    let users: Vec<_> = moved.iter().map(|row| row.user_id.clone()).collect();
    let blocks_sql = "INSERT INTO blocked_entries (user_id, entry_id)
        SELECT b.user_id, e.id
        FROM blocked_entries b
        JOIN entries old_entry ON old_entry.id = b.entry_id AND old_entry.feed_id = $1
        JOIN entries e ON e.feed_id = $2 AND e.guid = old_entry.guid
        WHERE b.user_id = ANY($3)
        ON CONFLICT DO NOTHING";
    txn.execute_raw(statement(blocks_sql, Some(&users))).await?;
    let unread_sql = format!(
        "INSERT INTO unreads (user_id, entry_id, feed_id)
        SELECT u.id, e.id, e.feed_id
        FROM unnest($3::text[]) AS u (id)
        CROSS JOIN LATERAL (
            SELECT id, feed_id, guid FROM entries
            WHERE feed_id = $2
              AND id NOT IN (SELECT entry_id FROM blocked_entries WHERE user_id = u.id)
            ORDER BY published_at DESC, id DESC LIMIT {UNREAD_ON_FOLLOW}
        ) e
        WHERE NOT EXISTS (
            SELECT 1 FROM entries old_entry
            WHERE old_entry.feed_id = $1 AND old_entry.guid = e.guid
              AND NOT EXISTS (SELECT 1 FROM unreads WHERE user_id = u.id AND entry_id = old_entry.id)
        )"
    );
    txn.execute_raw(statement(&unread_sql, Some(&users)))
        .await?;
    // What they left unread on `old` stays so, however old: the marks on `old` itself go with its subscriptions.
    let kept_sql = "INSERT INTO unreads (user_id, entry_id, feed_id)
        SELECT r.user_id, e.id, e.feed_id
        FROM unreads r
        JOIN entries old_entry ON old_entry.id = r.entry_id AND old_entry.feed_id = $1
        JOIN entries e ON e.feed_id = $2 AND e.guid = old_entry.guid
        WHERE r.user_id = ANY($3)
          AND e.id NOT IN (SELECT entry_id FROM blocked_entries WHERE user_id = r.user_id)
        ON CONFLICT DO NOTHING";
    txn.execute_raw(statement(kept_sql, Some(&users))).await?;
    // Unread marks of the entries that move follow them; those of the ones left behind go with the subscriptions.
    let entries_sql = "WITH moved AS (
            UPDATE entries e SET feed_id = $2
            WHERE e.feed_id = $1
              AND NOT EXISTS (SELECT 1 FROM entries t WHERE t.feed_id = $2 AND t.guid = e.guid)
            RETURNING id
        ), marks AS (
            UPDATE unreads SET feed_id = $2 WHERE entry_id IN (SELECT id FROM moved)
        )
        SELECT id FROM moved";
    let moved_entries = txn.query_all_raw(statement(entries_sql, None)).await?;
    let moved_entries: Vec<i64> = moved_entries
        .iter()
        .map(|row| row.try_get("", "id"))
        .collect::<Result<_, _>>()?;
    // The index files entries by feed.
    search::enqueue(txn, &moved_entries).await?;
    let removed = subscription::Entity::delete_many()
        .filter(subscription::Column::FeedId.eq(old))
        .exec_with_returning(txn)
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
