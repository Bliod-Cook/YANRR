use std::path::Path;

use axum::{
    Router,
    http::{HeaderValue, Response, header},
};
use tower_http::{
    services::{ServeDir, ServeFile},
    set_header::SetResponseHeader,
};

/// Serves the web client build. Bundled assets have hashed names, so they are cached for good and a missing one
/// is a 404; unknown paths elsewhere get `index.html` so client-side routes survive a reload, revalidated each
/// time so an upgrade reaches the browser.
pub fn service(dir: &Path) -> Router {
    let assets = SetResponseHeader::overriding(
        ServeDir::new(dir.join("assets")),
        header::CACHE_CONTROL,
        |response: &Response<_>| {
            let immutable = HeaderValue::from_static("public, max-age=31536000, immutable");
            response.status().is_success().then_some(immutable)
        },
    );
    let pages = SetResponseHeader::overriding(
        ServeDir::new(dir).fallback(ServeFile::new(dir.join("index.html"))),
        header::CACHE_CONTROL,
        HeaderValue::from_static("no-cache"),
    );
    Router::new()
        .nest_service("/assets", assets)
        .fallback_service(pages)
}
