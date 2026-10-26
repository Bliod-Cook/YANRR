//! What rules send out about new entries once they are stored.

use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};
use serde_json::json;

use super::EntrySettings;
use crate::{
    AppState,
    entity::{entry, feed, messaging_token, subscription},
    push::{Fcm, Notification},
    wire,
};

/// A new entry for a user's webhooks or devices.
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
    /// What `settings` send out about an entry arriving in `subscription`, if anything.
    pub fn of(
        settings: &EntrySettings,
        feed: &feed::Model,
        entry: &entry::Model,
        subscription: &subscription::Model,
    ) -> Option<Self> {
        let webhooks = settings.webhooks.clone().unwrap_or_default();
        let notify = settings.new_entry_notification == Some(true);
        if webhooks.is_empty() && !notify {
            return None;
        }
        let mut entry = entry.clone();
        settings.rewrite(&mut entry);
        let title = subscription.title.as_ref().or(feed.title.as_ref());
        Some(Self {
            user_id: subscription.user_id.clone(),
            view: subscription.view,
            title: title.cloned().unwrap_or_default(),
            entry,
            webhooks,
            notify,
        })
    }
}

/// Sends the deliveries in the background, logging what fails; nothing is retried.
pub fn spawn(state: &AppState, feed: &feed::Model, deliveries: Vec<Delivery>) {
    if deliveries.is_empty() {
        return;
    }
    let (state, feed) = (state.clone(), feed.clone());
    tokio::spawn(async move {
        for delivery in deliveries {
            send(&state, &feed, delivery).await;
        }
    });
}

async fn send(state: &AppState, feed: &feed::Model, delivery: Delivery) {
    let entry_id = delivery.entry.id;
    let notification = Notification {
        title: delivery.title,
        description: delivery.entry.title.clone().unwrap_or_default(),
        feed_id: feed.id.to_string(),
        entry_id: entry_id.to_string(),
        view: delivery.view,
    };
    let payload = json!({
        "entry": wire::Entry::new(delivery.entry, true),
        "feed": wire::Feed::from(feed),
        "view": delivery.view,
    });
    for url in &delivery.webhooks {
        let sent = state.http.post(url).json(&payload).send().await;
        if let Err(err) = sent.and_then(|response| response.error_for_status()) {
            tracing::warn!(entry = entry_id, "webhook {url} failed: {err}");
        }
    }
    if delivery.notify
        && let Some(fcm) = &state.push
        && let Err(err) = notify(state, fcm, &delivery.user_id, &notification).await
    {
        tracing::warn!(entry = entry_id, "push notification failed: {err}");
    }
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
    fcm.send(&state.http, &tokens, notification).await
}
