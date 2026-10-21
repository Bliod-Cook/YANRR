use std::{error::Error, net::SocketAddr, path::PathBuf};

use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct Config {
    pub server: ServerConfig,
    pub database: DatabaseConfig,
    pub auth: AuthConfig,
    #[serde(default)]
    pub rsshub: RsshubConfig,
    /// Push notifications are sent only when configured.
    pub push: Option<PushConfig>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ServerConfig {
    pub listen: SocketAddr,
    /// The URL clients use to reach this server; decides cookie security and trusted origin.
    pub public_url: String,
    /// Directory of the web client build, served for every non-API path.
    pub web_dir: Option<PathBuf>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DatabaseConfig {
    pub url: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AuthConfig {
    pub secret: String,
    #[serde(default = "enabled")]
    pub registration: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RsshubConfig {
    pub url: String,
}

impl Default for RsshubConfig {
    fn default() -> Self {
        Self {
            url: "https://rsshub.app".into(),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct PushConfig {
    /// Service account key (JSON) of the Firebase project the clients are built with.
    pub firebase_service_account: PathBuf,
    /// Where the FCM API is; only tests change it.
    #[serde(default = "fcm_url")]
    pub fcm_url: String,
}

fn fcm_url() -> String {
    "https://fcm.googleapis.com".into()
}

fn enabled() -> bool {
    true
}

impl Config {
    pub fn load(path: &str) -> Result<Self, Box<dyn Error + Send + Sync>> {
        Ok(toml::from_str(&std::fs::read_to_string(path)?)?)
    }
}
