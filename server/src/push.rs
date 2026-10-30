//! Push notifications through Firebase Cloud Messaging, which every client receives them with.

use std::{
    error::Error,
    time::{Duration, Instant},
};

use chrono::Utc;
use jsonwebtoken::{Algorithm, EncodingKey, Header};
use reqwest::Client;
use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter};
use serde::Deserialize;
use serde_json::json;
use tokio::sync::Mutex;

use crate::{config::PushConfig, entity::messaging_token, fetch::http::successful};

const SCOPE: &str = "https://www.googleapis.com/auth/firebase.messaging";
const JWT_BEARER: &str = "urn:ietf:params:oauth:grant-type:jwt-bearer";
/// How long before it expires an access token is replaced.
const TOKEN_MARGIN: Duration = Duration::from_secs(60);

/// The fields of a service account key that sending needs.
#[derive(Deserialize)]
struct ServiceAccount {
    project_id: String,
    client_email: String,
    private_key: String,
    token_uri: String,
}

#[derive(Deserialize)]
struct AccessToken {
    access_token: String,
    expires_in: u64,
}

/// A notification of an entry, the only kind clients handle; opening it opens the entry.
pub struct Notification {
    pub title: String,
    pub description: String,
    pub feed_id: String,
    pub entry_id: String,
    pub view: i16,
}

pub struct Fcm {
    account: ServiceAccount,
    key: EncodingKey,
    send_url: String,
    /// The access token and when it expires; the lock lets one request at a time exchange it.
    token: Mutex<Option<(String, Instant)>>,
}

impl Fcm {
    pub fn load(config: &PushConfig) -> Result<Self, Box<dyn Error + Send + Sync>> {
        let account: ServiceAccount =
            serde_json::from_str(&std::fs::read_to_string(&config.firebase_service_account)?)?;
        let key = EncodingKey::from_rsa_pem(account.private_key.as_bytes())?;
        let send_url = format!(
            "{}/v1/projects/{}/messages:send",
            config.fcm_url.trim_end_matches('/'),
            account.project_id
        );
        Ok(Self {
            account,
            key,
            send_url,
            token: Mutex::default(),
        })
    }

    /// Sends `notification` to each of the user's `tokens`, forgetting those FCM reports as no longer registered;
    /// fails with what went wrong on any device, once all were tried.
    pub async fn send(
        &self,
        db: &DatabaseConnection,
        http: &Client,
        user_id: &str,
        tokens: &[String],
        notification: &Notification,
    ) -> Result<(), String> {
        let access_token = self.access_token(http).await?;
        let (mut unregistered, mut failures) = (Vec::new(), Vec::new());
        for token in tokens {
            match self
                .send_one(http, &access_token, token, notification)
                .await
            {
                Ok(()) => {}
                // A device that uninstalled the app or dropped its token; any other error might be ours.
                Err(err) if err.contains("\"UNREGISTERED\"") => unregistered.push(token.clone()),
                Err(err) => failures.push(err),
            }
        }
        if !unregistered.is_empty() {
            messaging_token::Entity::delete_many()
                .filter(messaging_token::Column::UserId.eq(user_id))
                .filter(messaging_token::Column::Token.is_in(unregistered.iter().cloned()))
                .exec(db)
                .await
                .map_err(|err| err.to_string())?;
            failures.push(format!(
                "{} unregistered device(s) removed",
                unregistered.len()
            ));
        }
        match failures.is_empty() {
            true => Ok(()),
            false => Err(failures.join("; ")),
        }
    }

    async fn send_one(
        &self,
        http: &Client,
        access_token: &str,
        token: &str,
        notification: &Notification,
    ) -> Result<(), String> {
        let message = json!({ "message": {
            "token": token,
            // Mobile clients only show what the system shows for them.
            "notification": { "title": notification.title, "body": notification.description },
            // Desktop and web clients show their own from this; FCM wants every value a string.
            "data": {
                "type": "new-entry",
                "feedId": notification.feed_id,
                "entryId": notification.entry_id,
                "view": notification.view.to_string(),
                "title": notification.title,
                "description": notification.description,
            },
        }});
        let response = http
            .post(&self.send_url)
            .bearer_auth(access_token)
            .json(&message)
            .send()
            .await
            .map_err(|err| err.to_string())?;
        successful(response).await.map(drop)
    }

    /// An OAuth access token for the service account, exchanged for a JWT signed with its key while the last one
    /// is not about to expire.
    async fn access_token(&self, http: &Client) -> Result<String, String> {
        let mut cached = self.token.lock().await;
        if let Some((token, expires)) = &*cached
            && Instant::now() + TOKEN_MARGIN < *expires
        {
            return Ok(token.clone());
        }
        let now = Utc::now().timestamp();
        let claims = json!({
            "iss": self.account.client_email,
            "scope": SCOPE,
            "aud": self.account.token_uri,
            "iat": now,
            "exp": now + 3600,
        });
        let assertion = jsonwebtoken::encode(&Header::new(Algorithm::RS256), &claims, &self.key)
            .map_err(|err| err.to_string())?;
        let response = http
            .post(&self.account.token_uri)
            .form(&[("grant_type", JWT_BEARER), ("assertion", &assertion)])
            .send()
            .await
            .map_err(|err| err.to_string())?;
        let token: AccessToken = successful(response)
            .await?
            .json()
            .await
            .map_err(|err| err.to_string())?;
        let expires = Instant::now() + Duration::from_secs(token.expires_in);
        *cached = Some((token.access_token.clone(), expires));
        Ok(token.access_token)
    }
}
