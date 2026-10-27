pub mod api;
pub mod auth;
pub mod config;
pub mod entity;
pub mod fetch;
mod id;
mod migration;
pub mod opml;
mod push;
mod rsshub;
mod rules;
mod subscription;
pub mod sync;
mod time;
mod web;
mod wire;

use std::{error::Error, sync::Arc, time::Duration};

use axum::{Router, extract::FromRef};
use log::LevelFilter;
use sea_orm::{ConnectOptions, Database, DatabaseConnection};
use sea_orm_migration::MigratorTrait;
use tower_http::compression::CompressionLayer;

use crate::{auth::Auth, config::Config, migration::Migrator};

#[derive(Clone)]
pub struct AppState {
    pub db: DatabaseConnection,
    pub auth: Arc<Auth>,
    pub config: Arc<Config>,
    pub http: reqwest::Client,
    pub rsshub: Arc<rsshub::Catalog>,
    pub push: Option<Arc<push::Fcm>>,
}

impl FromRef<AppState> for Arc<Auth> {
    fn from_ref(state: &AppState) -> Self {
        state.auth.clone()
    }
}

pub async fn init(config: Config) -> Result<AppState, Box<dyn Error + Send + Sync>> {
    // Statements log at DEBUG, slow ones at WARN; a connection is pinged only after sitting idle.
    let mut options = ConnectOptions::new(&config.database.url);
    options
        .sqlx_logging_level(LevelFilter::Debug)
        .sqlx_slow_statements_logging_settings(LevelFilter::Warn, Duration::from_millis(500))
        .test_before_acquire_if_idle_for(Duration::from_secs(30));
    let db = Database::connect(options).await?;
    Migrator::up(&db, None).await?;
    let auth = Arc::new(auth::build(&config, db.clone()).await?);
    let push = config
        .push
        .as_ref()
        .map(push::Fcm::load)
        .transpose()?
        .map(Arc::new);
    Ok(AppState {
        db,
        auth,
        config: Arc::new(config),
        http: fetch::http_client(),
        rsshub: Arc::default(),
        push,
    })
}

pub fn router(state: AppState) -> Router {
    let mut app = Router::new().nest("/api", api::router(state.auth.clone()));
    if let Some(dir) = &state.config.server.web_dir {
        app = app.fallback_service(web::service(dir));
    }
    // Leaves out images, event streams and tiny bodies.
    app.with_state(state).layer(CompressionLayer::new())
}
