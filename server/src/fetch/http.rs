use std::{error::Error, time::Duration};

use reqwest::{Client, StatusCode, Url, header, redirect};

const MAX_REDIRECTS: usize = 5;
/// Bounds every redirect and the body together.
const TIMEOUT: Duration = Duration::from_secs(60);
/// Counted after decompression; large podcast feeds and the RSSHub catalog stay well below it.
const MAX_BODY: usize = 32 << 20;

#[derive(Default)]
pub struct Validators {
    pub etag: Option<String>,
    pub last_modified: Option<String>,
}

pub struct Fetched {
    pub body: Vec<u8>,
    pub validators: Validators,
    /// Final URL when every redirect on the way was permanent.
    pub moved_to: Option<String>,
}

pub fn client() -> Client {
    Client::builder()
        .user_agent(concat!("YANRR/", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(30))
        // Followed by hand to tell permanent redirects apart.
        .redirect(redirect::Policy::none())
        .build()
        .expect("TLS backend initializes")
}

/// Conditional GET; `None` means not modified.
pub async fn get(
    client: &Client,
    url: &str,
    validators: &Validators,
) -> Result<Option<Fetched>, String> {
    get_within(client, url, validators, TIMEOUT).await
}

async fn get_within(
    client: &Client,
    url: &str,
    validators: &Validators,
    timeout: Duration,
) -> Result<Option<Fetched>, String> {
    tokio::time::timeout(timeout, follow(client, url, validators, timeout))
        .await
        .map_err(|_| format!("Timed out after {timeout:?}"))?
}

async fn follow(
    client: &Client,
    url: &str,
    validators: &Validators,
    timeout: Duration,
) -> Result<Option<Fetched>, String> {
    let mut url = Url::parse(url).map_err(|err| err.to_string())?;
    let mut permanent = None;
    for _ in 0..=MAX_REDIRECTS {
        // Lifts the client's 30 s, which would otherwise cut a slow body short.
        let mut request = client.get(url.clone()).timeout(timeout);
        if let Some(etag) = &validators.etag {
            request = request.header(header::IF_NONE_MATCH, etag);
        }
        if let Some(last_modified) = &validators.last_modified {
            request = request.header(header::IF_MODIFIED_SINCE, last_modified);
        }
        let mut response = request.send().await.map_err(describe)?;
        let status = response.status();
        if status == StatusCode::NOT_MODIFIED {
            return Ok(None);
        }
        let value = |name| {
            response
                .headers()
                .get(name)
                .and_then(|value| value.to_str().ok())
                .map(String::from)
        };
        if status.is_redirection() {
            let location = value(header::LOCATION).ok_or("Redirect without Location")?;
            url = url.join(&location).map_err(|err| err.to_string())?;
            let is_permanent = matches!(
                status,
                StatusCode::MOVED_PERMANENTLY | StatusCode::PERMANENT_REDIRECT
            );
            permanent = Some(permanent.unwrap_or(true) && is_permanent);
            continue;
        }
        if !status.is_success() {
            return Err(format!("HTTP {}", status.as_u16()));
        }
        let validators = Validators {
            etag: value(header::ETAG),
            last_modified: value(header::LAST_MODIFIED),
        };
        let mut body = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(describe)? {
            if body.len() + chunk.len() > MAX_BODY {
                return Err(format!("Response is larger than {} MiB", MAX_BODY >> 20));
            }
            body.extend_from_slice(&chunk);
        }
        let moved_to = permanent.unwrap_or(false).then(|| url.into());
        return Ok(Some(Fetched {
            body,
            validators,
            moved_to,
        }));
    }
    Err("Too many redirects".into())
}

/// The error with its causes, which reqwest leaves out of its message: DNS, TLS, refused connections.
fn describe(err: reqwest::Error) -> String {
    if err.is_timeout() {
        return "Timed out".into();
    }
    let mut message = err.to_string();
    let mut source = err.source();
    while let Some(cause) = source {
        message += &format!(": {cause}");
        source = cause.source();
    }
    message
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    use axum::{
        Router,
        body::Body,
        extract::Path,
        http::header,
        response::{IntoResponse, Redirect, Response},
        routing::get as route,
    };
    use flate2::{Compression, write::GzEncoder};
    use futures::stream;
    use tokio::net::TcpListener;

    use super::*;

    fn gzip(data: &[u8]) -> Vec<u8> {
        let mut encoder = GzEncoder::new(Vec::new(), Compression::fast());
        encoder.write_all(data).unwrap();
        encoder.finish().unwrap()
    }

    fn gzipped(data: &[u8]) -> Response {
        ([(header::CONTENT_ENCODING, "gzip")], gzip(data)).into_response()
    }

    async fn serve(router: Router) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
        url
    }

    async fn fetch(url: &str) -> Result<Vec<u8>, String> {
        let fetched = get(&client(), url, &Validators::default()).await?;
        Ok(fetched.unwrap().body)
    }

    #[tokio::test]
    async fn decodes_gzip() {
        let url = serve(Router::new().route("/", route(|| async { gzipped(b"<rss/>") }))).await;
        assert_eq!(fetch(&url).await.unwrap(), b"<rss/>");
    }

    #[tokio::test]
    async fn rejects_bodies_over_the_limit_once_decoded() {
        let oversized = vec![b' '; MAX_BODY + 1];
        let compressed = gzip(&oversized);
        let router = Router::new()
            .route(
                "/gzip",
                route(move || async move { ([(header::CONTENT_ENCODING, "gzip")], compressed) }),
            )
            // Streamed without Content-Length.
            .route(
                "/chunked",
                route(|| async {
                    let chunks = (0..=MAX_BODY / (1 << 20))
                        .map(|_| Ok::<_, std::io::Error>(vec![b' '; 1 << 20]));
                    Body::from_stream(stream::iter(chunks))
                }),
            );
        let url = serve(router).await;
        for path in ["/gzip", "/chunked"] {
            let err = fetch(&format!("{url}{path}")).await.unwrap_err();
            assert!(err.contains("32 MiB"), "{path}: {err}");
        }
    }

    #[tokio::test]
    async fn one_deadline_covers_every_redirect() {
        let router = Router::new().route(
            "/hop/{n}",
            route(|Path(n): Path<u32>| async move {
                tokio::time::sleep(Duration::from_millis(300)).await;
                Redirect::temporary(&format!("/hop/{}", n + 1))
            }),
        );
        let url = serve(router).await;
        let err = get_within(
            &client(),
            &format!("{url}/hop/0"),
            &Validators::default(),
            Duration::from_millis(500),
        )
        .await
        .err()
        .unwrap();
        assert!(err.contains("Timed out"), "{err}");
    }

    #[tokio::test]
    async fn errors_name_their_cause() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        drop(listener);
        // A proxy from the environment would answer for the closed port.
        let client = Client::builder().no_proxy().build().unwrap();
        let err = get(&client, &url, &Validators::default())
            .await
            .err()
            .unwrap();
        assert!(err.contains("tcp connect error"), "{err}");
    }
}
