use std::sync::LazyLock;

use dom_smoothie::Readability;
use encoding_rs::{Encoding, UTF_8};
use regex::bytes::Regex;

use super::{FetchError, blocking, http};
use crate::AppState;

/// How far into a page browsers look for the charset it declares.
const PRESCAN: usize = 1024;
/// A charset declared in a `<meta>`, as `charset="…"` or as the parameter of a `Content-Type`.
static CHARSET: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?i-u)<meta[^>]*charset\s*=\s*["']?([a-z0-9_:.\-]+)"#).unwrap());

/// The readable part of the page at `url`, as HTML.
pub async fn extract(state: &AppState, url: &str) -> Result<String, FetchError> {
    let page = http::get(&state.http, url, &http::Validators::default())
        .await
        .map_err(FetchError::Fetch)?
        .ok_or(FetchError::Fetch("HTTP 304".into()))?;
    // Links in the page are relative to where redirects led.
    let url = page.url;
    // `Readability` is not `Send`, so it lives and dies on a blocking thread.
    let extracted = blocking(move || {
        let mut readability = Readability::new(decode(&page.body), Some(&url), None)
            .map_err(|err| err.to_string())?;
        let article = readability.parse().map_err(|err| err.to_string())?;
        Ok::<_, String>(article.content.to_string())
    })
    .await;
    extracted
        .and_then(|article| article)
        .map_err(FetchError::Fetch)
}

/// The page as text in the charset it declares near its start, as browsers read it, else in UTF-8; a byte order
/// mark wins over both.
fn decode(page: &[u8]) -> String {
    let start = &page[..page.len().min(PRESCAN)];
    let declared = CHARSET
        .captures(start)
        .and_then(|found| Encoding::for_label(&found[1]));
    let (text, _, _) = declared.unwrap_or(UTF_8).decode(page);
    text.into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pages_are_read_in_the_charset_they_declare() {
        // "你好" in GBK
        let gbk = b"<html><head><meta charset=\"gbk\"></head><body>\xc4\xe3\xba\xc3</body></html>";
        let declared = b"<meta http-equiv=\"Content-Type\" content=\"text/html; charset=Shift_JIS\">\x82\xb1\x82\xf1";

        assert!(decode(gbk).contains("<body>你好</body>"));
        assert!(decode(declared).ends_with("こん"));
        assert_eq!(decode("<p>Grüße</p>".as_bytes()), "<p>Grüße</p>");
    }
}
