use dom_smoothie::Readability;

use super::{FetchError, http};
use crate::AppState;

/// The readable part of the page at `url`, as HTML.
pub async fn extract(state: &AppState, url: &str) -> Result<String, FetchError> {
    let page = http::get(&state.http, url, &http::Validators::default())
        .await
        .map_err(FetchError::Fetch)?
        .ok_or(FetchError::Fetch("HTTP 304".into()))?;
    let html = String::from_utf8_lossy(&page.body).into_owned();
    // Links in the page are relative to where redirects led.
    let url = page.url;
    // `Readability` is not `Send`, so it lives and dies on a blocking thread.
    tokio::task::spawn_blocking(move || {
        let mut readability =
            Readability::new(html, Some(&url), None).map_err(|err| err.to_string())?;
        let article = readability.parse().map_err(|err| err.to_string())?;
        Ok(article.content.to_string())
    })
    .await
    .expect("extraction does not panic")
    .map_err(FetchError::Fetch)
}
