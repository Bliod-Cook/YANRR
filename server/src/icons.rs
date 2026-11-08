//! Icons of the sites whose feeds declare no image, looked up for the clients so that they reach neither the sites
//! nor a third party for them.

use std::{sync::LazyLock, time::Duration};

use reqwest::{Client, StatusCode, Url};
use scraper::{Html, Selector};

use crate::{
    config::{IconProvider, IconsConfig},
    fetch::http::{self, Fetched, Limits, Validators},
};

/// Twice the largest size clients draw site icons at.
const SIZE: u32 = 64;
/// Bounds a whole lookup and each request in it; pages and icons above the body size are skipped.
const LIMITS: Limits = Limits {
    timeout: Duration::from_secs(10),
    max_body: 1 << 20,
};
/// How many of the icons a page links to are tried before its `/favicon.ico`.
const MAX_LINKED: usize = 3;

static LINKS: LazyLock<Selector> = LazyLock::new(|| Selector::parse("link[rel][href]").unwrap());

/// A raster image, typed by its leading bytes rather than by what the site claimed.
pub struct Icon {
    pub content_type: &'static str,
    pub body: Vec<u8>,
}

impl Icon {
    /// `None` for anything else, SVG included, which runs its scripts when opened from the server's origin.
    fn sniff(body: Vec<u8>) -> Option<Self> {
        let content_type = match body.as_slice() {
            [0x89, b'P', b'N', b'G', ..] => "image/png",
            [0, 0, 1, 0, ..] => "image/x-icon",
            [b'G', b'I', b'F', b'8', ..] => "image/gif",
            [0xFF, 0xD8, 0xFF, ..] => "image/jpeg",
            [
                b'R',
                b'I',
                b'F',
                b'F',
                _,
                _,
                _,
                _,
                b'W',
                b'E',
                b'B',
                b'P',
                ..,
            ] => "image/webp",
            _ => return None,
        };
        Some(Self { content_type, body })
    }
}

/// The icon of the site at `host`; `None` when it has none, an error when the provider failed.
pub async fn find(
    client: &Client,
    config: &IconsConfig,
    host: &str,
) -> Result<Option<Icon>, String> {
    let lookup = async {
        let google = match config.provider {
            IconProvider::Google => "https://t0.gstatic.com",
            IconProvider::GoogleCn => "https://t0.gstatic.cn",
            IconProvider::Direct => return Ok(from_site(client, &format!("https://{host}/")).await),
        };
        let origin = config.google_url.as_deref().unwrap_or(google);
        from_google(client, origin, host).await
    };
    tokio::time::timeout(LIMITS.timeout, lookup)
        .await
        .map_err(|_| "Timed out".to_string())?
}

/// Google answers a miss with a 404 and a globe placeholder, which is dropped so that clients draw their own icon.
async fn from_google(client: &Client, origin: &str, host: &str) -> Result<Option<Icon>, String> {
    // Without every fallback option, Google misses even icons it has.
    let url = format!(
        "{origin}/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&size={SIZE}&url=https://{host}"
    );
    let response = client.get(url).send().await.map_err(http::describe)?;
    if response.status() == StatusCode::NOT_FOUND {
        return Ok(None);
    }
    let body = http::successful(response)
        .await?
        .bytes()
        .await
        .map_err(http::describe)?;
    let icon = Icon::sniff(body.to_vec()).ok_or("Google answered with no image")?;
    Ok(Some(icon))
}

/// The best icon the page at `home` links to that is an image, else its `/favicon.ico`.
async fn from_site(client: &Client, home: &str) -> Option<Icon> {
    let home = Url::parse(home).ok()?;
    // Sites that turn away the page may still serve their favicon.
    let mut candidates = match get(client, &home).await {
        Some(page) => linked(&String::from_utf8_lossy(&page.body), &home),
        None => Vec::new(),
    };
    candidates.truncate(MAX_LINKED);
    let favicon = home.join("/favicon.ico").ok()?;
    if !candidates.contains(&favicon) {
        candidates.push(favicon);
    }
    for url in candidates {
        if let Some(icon) = get(client, &url)
            .await
            .and_then(|icon| Icon::sniff(icon.body))
        {
            return Some(icon);
        }
    }
    None
}

async fn get(client: &Client, url: &Url) -> Option<Fetched> {
    let fetched = http::get_within(client, url.as_str(), &Validators::default(), &LIMITS).await;
    fetched.ok().flatten()
}

/// Raster icons the page links to, best first: favicons from the smallest of at least [`SIZE`] down to the largest
/// below it, then those of unknown size, then Apple touch icons, which are drawn for home screens.
fn linked(html: &str, base: &Url) -> Vec<Url> {
    let mut icons: Vec<_> = Html::parse_document(html)
        .select(&LINKS)
        .filter_map(|link| {
            let attr = |name| {
                link.value()
                    .attr(name)
                    .unwrap_or_default()
                    .to_ascii_lowercase()
            };
            let rel = attr("rel");
            let rel: Vec<_> = rel.split_ascii_whitespace().collect();
            let touch = rel.iter().any(|kind| kind.starts_with("apple-touch-icon"));
            if !touch && !rel.contains(&"icon") {
                return None;
            }
            let href = link.value().attr("href")?;
            let url = base.join(href).ok()?;
            let svg =
                attr("type").contains("svg") || url.path().to_ascii_lowercase().ends_with(".svg");
            if svg || !matches!(url.scheme(), "http" | "https") {
                return None;
            }
            let size = attr("sizes")
                .split_ascii_whitespace()
                .filter_map(|size| size.split_once('x')?.0.parse::<u32>().ok())
                .max();
            let rank = match (touch, size) {
                (true, _) => (3, 0),
                (false, Some(size)) if size >= SIZE => (0, size),
                (false, Some(size)) => (1, SIZE - size),
                (false, None) => (2, 0),
            };
            Some((rank, url))
        })
        .collect();
    icons.sort_by_key(|(rank, _)| *rank);
    icons.into_iter().map(|(_, url)| url).collect()
}

#[cfg(test)]
mod tests {
    use axum::{Router, routing::get as route};
    use tokio::net::TcpListener;

    use super::*;

    const PNG: &[u8] = b"\x89PNG\r\n\x1a\n";
    const ICO: &[u8] = &[0, 0, 1, 0, 1, 0];

    /// The home page of a site that `router` serves.
    async fn serve(router: Router) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let home = format!("http://{}/", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
        home
    }

    #[test]
    fn ranks_the_raster_icons_a_page_links_to() {
        let html = r#"<head>
            <link rel="apple-touch-icon" href="/touch.png">
            <link rel="shortcut icon" href="/favicon.png">
            <link rel="icon" sizes="16x16" href="/16.png">
            <link rel="icon" sizes="32x32" href="/32.png">
            <link rel="icon" sizes="192x192" href="/192.png">
            <link rel="icon" sizes="96x96" href="/96.png">
            <link rel="icon" type="image/svg+xml" href="/icon">
            <link rel="icon" href="/icon.svg">
            <link rel="icon" href="data:image/png;base64,iVBORw0KGgo=">
            <link rel="mask-icon" href="/mask.png">
            <link rel="stylesheet" href="/style.css">
        </head>"#;
        let base = Url::parse("https://example.com/").unwrap();

        let paths: Vec<_> = linked(html, &base)
            .iter()
            .map(|url| url.path().to_owned())
            .collect();

        let best_first = [
            "/96.png",
            "/192.png",
            "/32.png",
            "/16.png",
            "/favicon.png",
            "/touch.png",
        ];
        assert_eq!(paths, best_first);
    }

    #[tokio::test]
    async fn takes_the_best_linked_icon_that_is_an_image() {
        let page = r#"<link rel="icon" sizes="96x96" href="/gone.png">
            <link rel="icon" sizes="32x32" href="/page.png">
            <link rel="icon" href="/icon.png">"#;
        let router = Router::new()
            .route("/", route(move || async move { page }))
            .route("/page.png", route(|| async { "<html>Not here</html>" }))
            .route("/icon.png", route(|| async { PNG }))
            .route("/favicon.ico", route(|| async { ICO }));

        let icon = from_site(&http::client(), &serve(router).await)
            .await
            .unwrap();

        assert_eq!(icon.content_type, "image/png");
        assert_eq!(icon.body, PNG);
    }

    #[tokio::test]
    async fn falls_back_to_the_favicon_when_the_page_is_refused() {
        let router = Router::new()
            .route("/", route(|| async { StatusCode::FORBIDDEN }))
            .route("/favicon.ico", route(|| async { ICO }));

        let icon = from_site(&http::client(), &serve(router).await)
            .await
            .unwrap();

        assert_eq!(icon.content_type, "image/x-icon");
    }
}
