//! Push notifications through Firebase Cloud Messaging, which every client receives them with.

use std::error::Error;

use chrono::Utc;
use jsonwebtoken::{Algorithm, EncodingKey, Header};
use reqwest::{Client, Response};
use serde::Deserialize;
use serde_json::json;

use crate::config::PushConfig;

const SCOPE: &str = "https://www.googleapis.com/auth/firebase.messaging";
const JWT_BEARER: &str = "urn:ietf:params:oauth:grant-type:jwt-bearer";

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
        })
    }

    /// Sends `notification` to each token, stopping at the first one FCM rejects.
    pub async fn send(
        &self,
        http: &Client,
        tokens: &[String],
        notification: &Notification,
    ) -> Result<(), String> {
        let access_token = self.access_token(http).await?;
        for token in tokens {
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
                .bearer_auth(&access_token)
                .json(&message)
                .send()
                .await
                .map_err(|err| err.to_string())?;
            successful(response).await?;
        }
        Ok(())
    }

    /// An OAuth access token for the service account, exchanged for a JWT signed with its key.
    async fn access_token(&self, http: &Client) -> Result<String, String> {
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
        Ok(token.access_token)
    }
}

/// The response, or Google's explanation of why it failed.
async fn successful(response: Response) -> Result<Response, String> {
    let status = response.status();
    if status.is_success() {
        return Ok(response);
    }
    let body = response.text().await.unwrap_or_default();
    Err(format!("HTTP {}: {body}", status.as_u16()))
}
