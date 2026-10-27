//! What rules send out about entries as they arrive or are collected.

use futures::{FutureExt, StreamExt, future::BoxFuture, stream};
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};
use serde_json::json;

use super::{EntrySettings, Subject};
use crate::{
    AppState,
    entity::{entry, feed, messaging_token},
    push::{Fcm, Notification},
    wire,
};

/// An entry for a user's webhooks or devices.
pub struct Delivery {
    user_id: String,
    view: i16,
    /// The feed's title as the user names it.
    title: String,
    /// The entry as the user's rules rewrote it.
    entry: entry::Model,
    webhooks: Vec<String>,
    notify: bool,
}

impl Delivery {
    /// What `sent` sends out to the user about the subject's entry, rewritten as `shown` shows it, if anything.
    pub fn of(
        user_id: &str,
        subject: &Subject,
        sent: &EntrySettings,
        shown: &EntrySettings,
    ) -> Option<Self> {
        let webhooks = sent.webhooks.clone().unwrap_or_default();
        let notify = sent.new_entry_notification == Some(true);
        if webhooks.is_empty() && !notify {
            return None;
        }
        let mut entry = subject.entry.clone();
        shown.rewrite(&mut entry);
        let title = subject.title.or(subject.feed.title.as_deref());
        Some(Self {
            user_id: user_id.to_string(),
            view: subject.view.unwrap_or_default(),
            title: title.unwrap_or_default().to_string(),
            entry,
            webhooks,
            notify,
        })
    }
}

/// How many webhook calls and pushes are sent at once.
const CONCURRENCY: usize = 8;

/// Sends the deliveries in the background, logging what fails; nothing is retried, and nothing waits for a slow
/// webhook but its own call.
pub fn spawn(state: &AppState, feed: &feed::Model, deliveries: Vec<Delivery>) {
    let sends: Vec<_> = deliveries
        .into_iter()
        .flat_map(|delivery| sends(state, feed, delivery))
        .collect();
    if sends.is_empty() {
        return;
    }
    tokio::spawn(stream::iter(sends).for_each_concurrent(CONCURRENCY, |send| send));
}

/// The webhook calls and the push of a delivery, each sent on its own.
fn sends(state: &AppState, feed: &feed::Model, delivery: Delivery) -> Vec<BoxFuture<'static, ()>> {
    let entry_id = delivery.entry.id;
    let notification = Notification {
        title: delivery.title,
        description: delivery.entry.title.clone().unwrap_or_default(),
        feed_id: feed.id.to_string(),
        entry_id: entry_id.to_string(),
        view: delivery.view,
    };
    // Unlike the API's entries, a webhook's entry names its feed.
    let mut entry = json!(wire::Entry::new(delivery.entry, true));
    entry["feedId"] = json!(feed.id.to_string());
    let payload = json!({
        "entry": entry,
        "feed": wire::Feed::from(feed),
        "view": delivery.view,
    });
    let mut sends: Vec<BoxFuture<'static, ()>> = delivery
        .webhooks
        .into_iter()
        .map(|url| {
            let (http, payload) = (state.http.clone(), payload.clone());
            async move {
                let sent = http.post(&url).json(&payload).send().await;
                if let Err(err) = sent.and_then(|response| response.error_for_status()) {
                    tracing::warn!(entry = entry_id, "webhook {url} failed: {err}");
                }
            }
            .boxed()
        })
        .collect();
    if delivery.notify
        && let Some(fcm) = state.push.clone()
    {
        let (state, user_id) = (state.clone(), delivery.user_id);
        sends.push(
            async move {
                if let Err(err) = notify(&state, &fcm, &user_id, &notification).await {
                    tracing::warn!(entry = entry_id, "push notification failed: {err}");
                }
            }
            .boxed(),
        );
    }
    sends
}

/// Pushes the notification to each of the user's devices.
async fn notify(
    state: &AppState,
    fcm: &Fcm,
    user_id: &str,
    notification: &Notification,
) -> Result<(), String> {
    let tokens: Vec<_> = messaging_token::Entity::find()
        .filter(messaging_token::Column::UserId.eq(user_id))
        .all(&state.db)
        .await
        .map_err(|err| err.to_string())?
        .into_iter()
        .map(|row| row.token)
        .collect();
    if tokens.is_empty() {
        return Ok(());
    }
    fcm.send(&state.db, &state.http, user_id, &tokens, notification)
        .await
}
