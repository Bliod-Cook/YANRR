pub mod api;
pub mod auth;
pub mod config;
pub mod entity;
pub mod fetch;
mod id;
mod migration;
mod subscription;
pub mod sync;
mod time;
mod web;
mod wire;

use std::{error::Error, sync::Arc};

use axum::{Router, extract::FromRef};
use sea_orm::{Database, DatabaseConnection};
use sea_orm_migration::MigratorTrait;

use crate::{auth::Auth, config::Config, migration::Migrator};

#[derive(Clone)]
pub struct AppState {
    pub db: DatabaseConnection,
    pub auth: Arc<Auth>,
    pub config: Arc<Config>,
    pub http: reqwest::Client,
}

impl FromRef<AppState> for Arc<Auth> {
    fn from_ref(state: &AppState) -> Self {
        state.auth.clone()
    }
}

pub async fn init(config: Config) -> Result<AppState, Box<dyn Error + Send + Sync>> {
    let db = Database::connect(&config.database.url).await?;
    Migrator::up(&db, None).await?;
    let auth = Arc::new(auth::build(&config, db.clone()).await?);
    Ok(AppState {
        db,
        auth,
        config: Arc::new(config),
        http: fetch::http_client(),
    })
}

pub fn router(state: AppState) -> Router {
    let mut app = Router::new().nest("/api", api::router(state.auth.clone()));
    if let Some(dir) = &state.config.server.web_dir {
        app = app.fallback_service(web::service(dir));
    }
    app.with_state(state)
}
