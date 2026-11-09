use std::{
    error::Error,
    net::SocketAddr,
    path::{Path, PathBuf},
};

use figment::{
    Figment,
    providers::{Env, Format, Toml},
};
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct Config {
    pub server: ServerConfig,
    pub database: DatabaseConfig,
    pub auth: AuthConfig,
    #[serde(default)]
    pub rsshub: RsshubConfig,
    #[serde(default)]
    pub inbox: InboxConfig,
    #[serde(default)]
    pub icons: IconsConfig,
    #[serde(default)]
    pub search: SearchConfig,
    /// Push notifications are sent only when configured.
    pub push: Option<PushConfig>,
    /// AI summaries and translations are offered only when configured.
    pub ai: Option<AiConfig>,
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
pub struct SearchConfig {
    /// Directory of the search index, which is built from the database when missing.
    pub dir: PathBuf,
}

impl Default for SearchConfig {
    fn default() -> Self {
        Self {
            dir: "data/search".into(),
        }
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct InboxConfig {
    /// Bearer token the inbound mail service posts emails with; emails are refused without one.
    pub email_secret: Option<String>,
}

/// Icons of the sites whose feeds declare no image, which the server looks up for the clients.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct IconsConfig {
    #[serde(default)]
    pub provider: IconProvider,
    /// Where the Google providers' favicon service is; only tests change it.
    pub google_url: Option<String>,
}

#[derive(Debug, Clone, Copy, Default, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum IconProvider {
    /// Google's favicon service.
    #[default]
    Google,
    /// The same service on Google's mainland China domain, for servers that cannot reach Google.
    GoogleCn,
    /// The site itself: the icons its home page links to, else its `/favicon.ico`.
    Direct,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PushConfig {
    /// Service account key (JSON) of the Firebase project the clients are built with.
    pub firebase_service_account: PathBuf,
    /// Where the FCM API is; only tests change it.
    #[serde(default = "fcm_url")]
    pub fcm_url: String,
}

/// A model behind an OpenAI-compatible Chat Completions API.
#[derive(Debug, Clone, Deserialize)]
pub struct AiConfig {
    /// Where the API is, e.g. `https://api.openai.com/v1`.
    pub base_url: String,
    /// Sent as a bearer token; servers such as Ollama need none.
    pub api_key: Option<String>,
    pub model: String,
}

fn fcm_url() -> String {
    "https://fcm.googleapis.com".into()
}

fn enabled() -> bool {
    true
}

impl Config {
    /// Reads the TOML file at `path` if it exists; `YANRR_<SECTION>__<KEY>` environment variables override it.
    pub fn load(path: &str) -> Result<Self, Box<dyn Error + Send + Sync>> {
        let mut figment = Figment::new();
        if Path::new(path).exists() {
            figment = figment.merge(Toml::file_exact(path));
        }
        Ok(figment
            .merge(Env::prefixed("YANRR_").split("__"))
            .extract()?)
    }
}

#[cfg(test)]
mod tests {
    use figment::Jail;

    use super::*;

    #[test]
    fn environment_overrides_and_extends_the_file() {
        Jail::expect_with(|jail| {
            jail.create_file(
                "config.toml",
                r#"
                [server]
                listen = "0.0.0.0:3000"
                public_url = "http://localhost:3000"
                [database]
                url = "postgres://localhost/yanrr"
                "#,
            )?;
            jail.set_env("YANRR_SERVER__PUBLIC_URL", "https://rss.example.com");
            jail.set_env(
                "YANRR_AUTH__SECRET",
                "a-secret-that-is-at-least-32-characters",
            );
            jail.set_env("YANRR_AUTH__REGISTRATION", "false");

            let config = Config::load("config.toml").unwrap();

            assert_eq!(config.server.public_url, "https://rss.example.com");
            assert_eq!(config.database.url, "postgres://localhost/yanrr");
            assert_eq!(
                config.auth.secret,
                "a-secret-that-is-at-least-32-characters"
            );
            assert!(!config.auth.registration);
            Ok(())
        });
    }

    #[test]
    fn environment_alone_is_enough() {
        Jail::expect_with(|jail| {
            jail.set_env("YANRR_SERVER__LISTEN", "0.0.0.0:3000");
            jail.set_env("YANRR_SERVER__PUBLIC_URL", "https://rss.example.com");
            jail.set_env("YANRR_SERVER__WEB_DIR", "web");
            jail.set_env(
                "YANRR_DATABASE__URL",
                "postgres://yanrr:yanrr@postgres/yanrr",
            );
            jail.set_env(
                "YANRR_AUTH__SECRET",
                "a-secret-that-is-at-least-32-characters",
            );

            let config = Config::load("config.toml").unwrap();

            assert_eq!(config.server.listen, "0.0.0.0:3000".parse().unwrap());
            assert_eq!(config.server.web_dir, Some(PathBuf::from("web")));
            assert_eq!(config.database.url, "postgres://yanrr:yanrr@postgres/yanrr");
            Ok(())
        });
    }
}
