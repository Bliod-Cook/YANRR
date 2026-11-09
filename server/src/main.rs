use std::error::Error;

use tracing_subscriber::EnvFilter;
use yanrr::config::Config;

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error + Send + Sync>> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();

    let path = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "config.toml".into());
    let config = Config::load(&path)?;
    let listener = tokio::net::TcpListener::bind(config.server.listen).await?;
    let state = yanrr::init(config).await?;

    yanrr::fetch::scheduler::spawn(state.clone());
    yanrr::sync::spawn_cleaner(state.db.clone());
    yanrr::search::spawn_indexer(state.clone());
    tracing::info!("listening on {}", listener.local_addr()?);
    axum::serve(listener, yanrr::router(state)).await?;
    Ok(())
}
