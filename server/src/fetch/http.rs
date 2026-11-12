use std::{error::Error, time::Duration};

use chrono::{DateTime, Utc};
use reqwest::{Client, Response, StatusCode, Url, header, redirect};

const MAX_REDIRECTS: usize = 5;
/// Large podcast feeds and the RSSHub catalog stay well below its body size.
pub(crate) const LIMITS: Limits = Limits {
    timeout: Duration::from_secs(60),
    max_body: 32 << 20,
};

/// Bounds of a GET: the time for every redirect and the body together, and the body size once decoded.
pub(crate) struct Limits {
    pub timeout: Duration,
    pub max_body: usize,
}

#[derive(Default)]
pub struct Validators {
    pub etag: Option<String>,
    pub last_modified: Option<String>,
}

pub struct Fetched {
    pub body: Vec<u8>,
    pub validators: Validators,
    /// Where the body came from after redirects, which relative links in it are relative to.
    pub url: String,
    /// Whether there were redirects and each was permanent, so that `url` replaces the address asked for.
    pub permanent: bool,
    /// The `Content-Type` header of the answer.
    pub content_type: Option<String>,
}

/// Why a GET failed.
pub(crate) struct Failure {
    pub message: String,
    /// The status of the answer, when the server gave one.
    pub status: Option<StatusCode>,
    /// How long the server asked to be left alone with `Retry-After`.
    pub retry_after: Option<Duration>,
}

impl From<String> for Failure {
    fn from(message: String) -> Self {
        Self {
            message,
            status: None,
            retry_after: None,
        }
    }
}

impl From<&str> for Failure {
    fn from(message: &str) -> Self {
        message.to_string().into()
    }
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
    get_within(client, url, validators, &LIMITS)
        .await
        .map_err(|failure| failure.message)
}

/// Conditional GET within `limits`, whose failure tells what the server answered.
pub(crate) async fn get_within(
    client: &Client,
    url: &str,
    validators: &Validators,
    limits: &Limits,
) -> Result<Option<Fetched>, Failure> {
    let timeout = limits.timeout;
    tokio::time::timeout(timeout, follow(client, url, validators, limits))
        .await
        .map_err(|_| format!("Timed out after {timeout:?}"))?
}

async fn follow(
    client: &Client,
    url: &str,
    validators: &Validators,
    limits: &Limits,
) -> Result<Option<Fetched>, Failure> {
    let mut url = Url::parse(url).map_err(|err| err.to_string())?;
    let mut permanent = None;
    for _ in 0..=MAX_REDIRECTS {
        // Lifts the client's 30 s, which would otherwise cut a slow body short.
        let mut request = client.get(url.clone()).timeout(limits.timeout);
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
            return Err(Failure {
                message: format!("HTTP {}", status.as_u16()),
                status: Some(status),
                retry_after: value(header::RETRY_AFTER).and_then(|value| retry_after(&value)),
            });
        }
        let validators = Validators {
            etag: value(header::ETAG),
            last_modified: value(header::LAST_MODIFIED),
        };
        let content_type = value(header::CONTENT_TYPE);
        let mut body = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(describe)? {
            if body.len() + chunk.len() > limits.max_body {
                let mib = limits.max_body >> 20;
                return Err(format!("Response is larger than {mib} MiB").into());
            }
            body.extend_from_slice(&chunk);
        }
        return Ok(Some(Fetched {
            body,
            validators,
            url: url.into(),
            permanent: permanent.unwrap_or(false),
            content_type,
        }));
    }
    Err("Too many redirects".into())
}

/// A `Retry-After` value, in seconds or an HTTP date.
fn retry_after(value: &str) -> Option<Duration> {
    let value = value.trim();
    if let Ok(seconds) = value.parse() {
        return Some(Duration::from_secs(seconds));
    }
    let date = DateTime::parse_from_rfc2822(value).ok()?;
    (date.with_timezone(&Utc) - Utc::now()).to_std().ok()
}

/// The error with its causes, which reqwest leaves out of its message: DNS, TLS, refused connections. The URL is
/// left out: it may hold credentials, and the message reaches API responses, feeds and logs.
pub(crate) fn describe(err: reqwest::Error) -> String {
    if err.is_timeout() {
        return "Timed out".into();
    }
    let err = err.without_url();
    let mut message = err.to_string();
    let mut source = err.source();
    while let Some(cause) = source {
        message += &format!(": {cause}");
        source = cause.source();
    }
    message
}

/// The response, or the service's explanation of why it failed, which is for logs: it may tell more than a client
/// should see.
pub(crate) async fn successful(response: Response) -> Result<Response, String> {
    let status = response.status();
    if status.is_success() {
        return Ok(response);
    }
    let body = response.text().await.unwrap_or_default();
    Err(format!("HTTP {}: {body}", status.as_u16()))
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
        let oversized = vec![b' '; LIMITS.max_body + 1];
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
                    let chunks = (0..=LIMITS.max_body / (1 << 20))
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
            &Limits {
                timeout: Duration::from_millis(500),
                ..LIMITS
            },
        )
        .await
        .err()
        .unwrap()
        .message;
        assert!(err.contains("Timed out"), "{err}");
    }

    #[tokio::test]
    async fn errors_name_their_cause_but_not_the_url() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/feed?key=secret", listener.local_addr().unwrap());
        drop(listener);
        // A proxy from the environment would answer for the closed port.
        let client = Client::builder().no_proxy().build().unwrap();
        let err = get(&client, &url, &Validators::default())
            .await
            .err()
            .unwrap();
        assert!(err.contains("tcp connect error"), "{err}");
        assert!(!err.contains("secret"), "{err}");
    }

    /// Redirects with the status codes in `/r/{codes}`, such as `/r/301-302-ok`, then answers.
    async fn redirecting() -> String {
        let hop = |Path(codes): Path<String>| async move {
            let Some((code, rest)) = codes.split_once('-') else {
                return "body".into_response();
            };
            let status = StatusCode::from_u16(code.parse().unwrap()).unwrap();
            (status, [(header::LOCATION, format!("/r/{rest}"))]).into_response()
        };
        serve(Router::new().route("/r/{codes}", route(hop))).await
    }

    #[tokio::test]
    async fn redirects_lead_to_the_final_url_and_permanent_ones_say_so() {
        let url = redirecting().await;
        let cases = [
            ("ok", false),
            ("301-308-ok", true),
            ("301-302-ok", false),
            ("307-301-ok", false),
            ("301-301-301-301-301-ok", true),
        ];
        for (codes, permanent) in cases {
            let fetched = get(
                &client(),
                &format!("{url}/r/{codes}"),
                &Validators::default(),
            )
            .await
            .unwrap()
            .unwrap();
            assert_eq!(fetched.url, format!("{url}/r/ok"), "{codes}");
            assert_eq!(fetched.permanent, permanent, "{codes}");
        }
        let too_many = format!("{url}/r/301-301-301-301-301-301-ok");
        let err = get(&client(), &too_many, &Validators::default()).await;
        assert_eq!(err.err().as_deref(), Some("Too many redirects"));
    }

    #[tokio::test]
    async fn failures_tell_how_long_to_wait() {
        let in_an_hour = (Utc::now() + chrono::TimeDelta::hours(1)).to_rfc2822();
        let router = Router::new()
            .route(
                "/seconds",
                route(|| async {
                    let retry = [(header::RETRY_AFTER, "120")];
                    (StatusCode::TOO_MANY_REQUESTS, retry).into_response()
                }),
            )
            .route(
                "/date",
                route(move || {
                    let retry = [(header::RETRY_AFTER, in_an_hour.clone())];
                    async move { (StatusCode::SERVICE_UNAVAILABLE, retry).into_response() }
                }),
            );
        let url = serve(router).await;
        let failure = async |path: &str| {
            let url = format!("{url}{path}");
            let fetched = get_within(&client(), &url, &Validators::default(), &LIMITS).await;
            fetched.err().unwrap()
        };

        let limited = failure("/seconds").await;
        assert_eq!(limited.message, "HTTP 429");
        assert_eq!(limited.status, Some(StatusCode::TOO_MANY_REQUESTS));
        assert_eq!(limited.retry_after, Some(Duration::from_secs(120)));
        let unavailable = failure("/date").await.retry_after.unwrap();
        assert!(unavailable > Duration::from_secs(3500), "{unavailable:?}");
        assert_eq!(failure("/missing").await.retry_after, None);
    }
}
