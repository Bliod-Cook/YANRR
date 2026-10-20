use std::path::Path;

use tower_http::services::{ServeDir, ServeFile};

/// Serves the web client build; unknown paths get `index.html` so client-side routes survive a reload.
pub fn service(dir: &Path) -> ServeDir<ServeFile> {
    ServeDir::new(dir).fallback(ServeFile::new(dir.join("index.html")))
}
