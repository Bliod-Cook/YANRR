//! The image proxy on its own, without a database: `yanrr-image-proxy [config.toml]`. It reads the `[image_proxy]`
//! table, whose keys `YANRR_IMAGE_PROXY__<KEY>` environment variables override.

use std::error::Error;

use yanrr::{
    config::{self, StandaloneImageProxyConfig},
    image_proxy::{self, ImageProxy},
};

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error + Send + Sync>> {
    yanrr::init_logging();

    let path = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "config.toml".into());
    let StandaloneImageProxyConfig {
        image_proxy: config,
    } = config::load(&path)?;
    let proxy = ImageProxy::new(&config.key)?;
    let listener = tokio::net::TcpListener::bind(config.listen).await?;
    tracing::info!("listening on {}", listener.local_addr()?);
    axum::serve(listener, image_proxy::router(proxy))
        .with_graceful_shutdown(yanrr::stopped())
        .await?;
    Ok(())
}
