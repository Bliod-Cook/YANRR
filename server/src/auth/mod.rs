mod schema;

pub use schema::{AppAuthSchema, create_auth_tables};

use better_auth::{
    AuthConfig, AuthResult, BetterAuth,
    plugins::{EmailPasswordPlugin, PasswordManagementPlugin, SessionManagementPlugin},
    seaorm::{DatabaseConnection, SeaOrmStore},
};

use crate::config::Config;

pub type Auth = BetterAuth<AppAuthSchema>;

pub const BASE_PATH: &str = "/api/better-auth";

/// Routes the plugins mount that the plan does not cover.
const UNUSED_PATHS: &[&str] = &[
    "/ok",
    "/error",
    "/openapi.json",
    "/update-session",
    "/list-sessions",
    "/revoke-session",
    "/revoke-sessions",
    "/revoke-other-sessions",
    "/request-password-reset",
    "/reset-password",
    "/reset-password/{token}",
    "/verify-password",
];

pub async fn build(config: &Config, db: DatabaseConnection) -> AuthResult<Auth> {
    let auth_config = auth_config(config);
    let store = SeaOrmStore::<AppAuthSchema>::new(auth_config.clone(), db);
    BetterAuth::new(auth_config)
        .store(store)
        .plugin(EmailPasswordPlugin::new().enable_signup(config.auth.registration))
        .plugin(SessionManagementPlugin::new())
        .plugin(PasswordManagementPlugin::new())
        .build()
        .await
}

fn auth_config(config: &Config) -> AuthConfig {
    let mut auth_config = AuthConfig::new(&config.auth.secret)
        .base_url(&config.server.public_url)
        .base_path(BASE_PATH)
        .disabled_paths(UNUSED_PATHS.iter().map(|path| path.to_string()).collect());
    // Upstream Better Auth and Folo clients expect the `__Secure-` prefix on HTTPS.
    if auth_config.session.cookie_secure {
        auth_config.session.cookie_name = "__Secure-better-auth.session_token".into();
    }
    auth_config
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(public_url: &str) -> Config {
        toml::from_str(&format!(
            r#"
            [server]
            listen = "127.0.0.1:0"
            public_url = "{public_url}"
            [database]
            url = ""
            [auth]
            secret = "test-secret-that-is-at-least-32-characters"
            "#
        ))
        .unwrap()
    }

    #[test]
    fn https_uses_secure_cookie_prefix() {
        let https = auth_config(&config("https://rss.example.com"));
        let http = auth_config(&config("http://localhost:3000"));

        assert_eq!(
            https.session.cookie_name,
            "__Secure-better-auth.session_token"
        );
        assert_eq!(http.session.cookie_name, "better-auth.session_token");
    }
}
