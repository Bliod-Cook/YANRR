//! What rules send out about entries as they arrive or are collected.

use futures::{FutureExt, StreamExt, future::BoxFuture, stream};
use reqwest::{Client, Url};
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};
use serde_json::{Value, json};

use super::{EntrySettings, Subject};
use crate::{
    AppState,
    entity::{entry, feed, messaging_token},
    fetch::http::describe,
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
                if let Err(err) = post(&http, &url, &payload).await {
                    // Only the host: the address of a Slack or Discord webhook is its secret.
                    let host = Url::parse(&url).ok();
                    let host = host.as_ref().and_then(Url::host_str).unwrap_or_default();
                    tracing::warn!(entry = entry_id, "webhook to {host} failed: {err}");
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

/// Posts `payload` to a webhook. Only a 2xx answer delivers it: redirects are not followed, so they fail too.
async fn post(http: &Client, url: &str, payload: &Value) -> Result<(), String> {
    let response = http
        .post(url)
        .json(payload)
        .send()
        .await
        .map_err(describe)?;
    let status = response.status();
    match status.is_success() {
        true => Ok(()),
        false => Err(format!("HTTP {}", status.as_u16())),
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
    fcm.send(&state.db, &state.http, user_id, &tokens, notification)
        .await
}

#[cfg(test)]
mod tests {
    use axum::{Router, http::StatusCode, response::Redirect, routing::post as route};
    use tokio::net::TcpListener;

    use super::*;

    #[tokio::test]
    async fn webhooks_fail_unless_they_answer_with_success() {
        let router = Router::new()
            .route("/hook", route(|| async { StatusCode::NO_CONTENT }))
            .route("/moved", route(|| async { Redirect::permanent("/hook") }));
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
        let (http, payload) = (crate::fetch::http_client(), json!({}));

        assert_eq!(post(&http, &format!("{url}/hook"), &payload).await, Ok(()));
        let moved = post(&http, &format!("{url}/moved"), &payload).await;
        assert_eq!(moved, Err("HTTP 308".into()));
    }
}
