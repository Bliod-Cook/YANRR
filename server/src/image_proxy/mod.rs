//! A proxy for the images clients cannot load themselves: from hosts their network cannot reach, or from hosts that
//! want a Referer a browser cannot send. It needs no database, so it can run on another machine, and it serves only
//! URLs signed with its key, which the main server hands to signed-in clients.

mod referer;
mod target;

use std::{io, sync::Arc, time::Duration};

use axum::{
    Router,
    body::{Body, Bytes},
    extract::{Path, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
    routing::get,
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use futures::{StreamExt, stream};
use hmac::{Hmac, Mac};
use reqwest::Url;
use sha2::Sha256;

use crate::{
    fetch::http::{self, Limits, MAX_REDIRECTS},
    image_type,
};

/// What a browser asks for when loading an image.
const ACCEPT_IMAGES: &str = "image/avif,image/webp,image/apng,image/*,*/*;q=0.8";
const MIN_KEY_LEN: usize = 32;
/// Large enough for the animated GIFs of social feeds.
const LIMITS: Limits = Limits {
    timeout: Duration::from_secs(30),
    max_body: 20 << 20,
};

#[derive(Clone)]
pub struct ImageProxy {
    key: Arc<str>,
    client: reqwest::Client,
    limits: &'static Limits,
    /// Off only for tests, whose servers are local.
    public_only: bool,
}

impl ImageProxy {
    /// A proxy for URLs signed with `key` that fetches from public addresses only.
    pub fn new(key: &str) -> Result<Self, String> {
        // Anyone who guesses the key can have the proxy fetch for them
        if key.len() < MIN_KEY_LEN {
            return Err(format!(
                "image_proxy.key must be at least {MIN_KEY_LEN} characters"
            ));
        }
        Ok(Self {
            key: key.into(),
            client: target::public_client(),
            limits: &LIMITS,
            public_only: true,
        })
    }
}

/// `GET /{signature}/{url}`: the image at `url`, both in unpadded base64url, the signature being the HMAC-SHA256 of
/// `url` with the proxy's key.
pub fn router(proxy: ImageProxy) -> Router {
    Router::new()
        .route("/{signature}/{url}", get(serve))
        .with_state(proxy)
}

async fn serve(
    State(proxy): State<ImageProxy>,
    Path((signature, url)): Path<(String, String)>,
) -> Response {
    let decoded = URL_SAFE_NO_PAD.decode(url).ok();
    let Some(url) = decoded.and_then(|url| String::from_utf8(url).ok()) else {
        return refused(StatusCode::BAD_REQUEST);
    };
    let signed = URL_SAFE_NO_PAD
        .decode(signature)
        .is_ok_and(|signature| mac(&proxy.key, &url).verify_slice(&signature).is_ok());
    if !signed {
        return refused(StatusCode::FORBIDDEN);
    }
    let url = match Url::parse(&url) {
        Ok(url) if matches!(url.scheme(), "http" | "https") => url,
        _ => return refused(StatusCode::BAD_REQUEST),
    };
    match proxy.fetch(url).await {
        Ok(response) => response,
        Err(err) => {
            // Broken images are common in feeds; they are no concern of the operator's.
            tracing::debug!("image proxy: {err}");
            refused(StatusCode::BAD_GATEWAY)
        }
    }
}

fn refused(status: StatusCode) -> Response {
    (status, [(header::CACHE_CONTROL, "no-store")]).into_response()
}

impl ImageProxy {
    /// The image at `url`, passed on as it arrives once its leading bytes tell it is one.
    async fn fetch(&self, url: Url) -> Result<Response, String> {
        let mut response = self.follow(url).await?;
        let max_body = self.limits.max_body;
        let too_large = move || format!("Image is larger than {} MiB", max_body >> 20);
        if response
            .content_length()
            .is_some_and(|size| size > max_body as u64)
        {
            return Err(too_large());
        }
        let mut head = Vec::new();
        while head.len() < image_type::HEAD_LEN {
            match response.chunk().await.map_err(http::describe)? {
                Some(chunk) => head.extend_from_slice(&chunk),
                None => break,
            }
        }
        let content_type = image_type::sniff(&head).ok_or("Not an image")?;
        if head.len() > max_body {
            return Err(too_large());
        }
        // Past this point the answer has begun, so an excess can only break it off.
        let rest = stream::try_unfold(
            (response, head.len()),
            move |(mut response, read)| async move {
                let Some(chunk) = response.chunk().await.map_err(io::Error::other)? else {
                    return Ok(None);
                };
                let read = read + chunk.len();
                if read > max_body {
                    return Err(io::Error::other(too_large()));
                }
                Ok(Some((chunk, (response, read))))
            },
        );
        let body = stream::once(async { Ok(Bytes::from(head)) }).chain(rest);
        let headers = [
            (header::CONTENT_TYPE, content_type),
            // The URL names the image for good
            (header::CACHE_CONTROL, "public, max-age=31536000, immutable"),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
            // Pages load images with `crossorigin` to read them
            (header::ACCESS_CONTROL_ALLOW_ORIGIN, "*"),
        ];
        Ok((headers, Body::from_stream(body)).into_response())
    }

    /// The successful answer for `url`, following redirects to public addresses only.
    async fn follow(&self, mut url: Url) -> Result<reqwest::Response, String> {
        for _ in 0..=MAX_REDIRECTS {
            if self.public_only && !target::allows(&url).await {
                return Err("Not a public address".into());
            }
            let referer = referer::referer(&url);
            let response = self
                .client
                .get(url.clone())
                .header(header::USER_AGENT, referer::user_agent())
                .header(header::ACCEPT, ACCEPT_IMAGES)
                .header(header::REFERER, &referer)
                .header(header::ORIGIN, &referer)
                .timeout(self.limits.timeout)
                .send()
                .await
                .map_err(http::describe)?;
            let status = response.status();
            if status.is_redirection() {
                let location = response
                    .headers()
                    .get(header::LOCATION)
                    .and_then(|location| location.to_str().ok())
                    .ok_or("Redirect without Location")?;
                url = url.join(location).map_err(|err| err.to_string())?;
                continue;
            }
            if !status.is_success() {
                return Err(format!("HTTP {}", status.as_u16()));
            }
            return Ok(response);
        }
        Err("Too many redirects".into())
    }
}

fn mac(key: &str, url: &str) -> Hmac<Sha256> {
    let mut mac =
        Hmac::<Sha256>::new_from_slice(key.as_bytes()).expect("HMAC takes keys of any size");
    mac.update(url.as_bytes());
    mac
}

#[cfg(test)]
mod tests {
    use std::sync::{
        Mutex,
        atomic::{AtomicUsize, Ordering},
    };

    use axum::{
        body::Body,
        http::{HeaderMap, header},
        response::Redirect,
    };
    use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
    use tokio::net::TcpListener;

    use super::*;

    const KEY: &str = "test-image-proxy-key-of-32-characters";
    const PNG: &[u8] = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR";
    const SMALL: Limits = Limits {
        timeout: Duration::from_secs(5),
        max_body: 64,
    };

    async fn serve(router: Router) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
        url
    }

    /// A client that reaches the local servers the tests run, whatever proxy the environment sets.
    fn direct() -> reqwest::Client {
        reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap()
    }

    async fn request(url: String) -> reqwest::Response {
        direct().get(url).send().await.unwrap()
    }

    /// A proxy that may reach the local servers.
    async fn local_proxy() -> String {
        let proxy = ImageProxy {
            key: KEY.into(),
            client: direct(),
            limits: &SMALL,
            public_only: false,
        };
        serve(router(proxy)).await
    }

    fn signed(proxy: &str, url: &str) -> String {
        let signature = URL_SAFE_NO_PAD.encode(mac(KEY, url).finalize().into_bytes());
        format!("{proxy}/{signature}/{}", URL_SAFE_NO_PAD.encode(url))
    }

    /// A server answering `body` at `/image` and counting the requests.
    async fn upstream(
        body: &'static [u8],
        content_type: &'static str,
    ) -> (String, Arc<AtomicUsize>) {
        let count = Arc::new(AtomicUsize::new(0));
        let counted = count.clone();
        let router = Router::new().route(
            "/image",
            get(move || async move {
                counted.fetch_add(1, Ordering::Relaxed);
                ([(header::CONTENT_TYPE, content_type)], body)
            }),
        );
        (format!("{}/image", serve(router).await), count)
    }

    #[test]
    fn signs_as_clients_do() {
        let signature = mac("test-key", "https://example.com/a.png?x=1&y=中")
            .finalize()
            .into_bytes();
        assert_eq!(
            URL_SAFE_NO_PAD.encode(signature),
            "xzxCVa98o_QdAQ7LNzZes-RvDHXy-FZ5pjz8j6U5B9k"
        );
    }

    #[tokio::test]
    async fn serves_signed_images_typed_by_their_bytes() {
        let (image, _) = upstream(PNG, "text/plain").await;
        let proxy = local_proxy().await;

        let res = request(signed(&proxy, &image)).await;

        assert_eq!(res.status(), 200);
        let headers = res.headers();
        assert_eq!(headers[header::CONTENT_TYPE], "image/png");
        assert_eq!(
            headers[header::CACHE_CONTROL],
            "public, max-age=31536000, immutable"
        );
        assert_eq!(headers[header::X_CONTENT_TYPE_OPTIONS], "nosniff");
        assert_eq!(headers[header::ACCESS_CONTROL_ALLOW_ORIGIN], "*");
        assert_eq!(res.bytes().await.unwrap(), PNG);
    }

    #[tokio::test]
    async fn refuses_unsigned_urls_without_fetching_them() {
        let (image, count) = upstream(PNG, "image/png").await;
        let other = format!("{image}?other");
        let proxy = local_proxy().await;
        let forged = signed(&proxy, &other).replace(
            &URL_SAFE_NO_PAD.encode(&other),
            &URL_SAFE_NO_PAD.encode(&image),
        );

        let res = request(forged).await;

        assert_eq!(res.status(), 403);
        assert_eq!(count.load(Ordering::Relaxed), 0);
    }

    #[tokio::test]
    async fn refuses_what_is_not_an_image() {
        let (page, _) = upstream(b"<!doctype html><title>Sign in</title>", "image/png").await;
        let proxy = local_proxy().await;

        let res = request(signed(&proxy, &page)).await;

        assert_eq!(res.status(), 502);
        assert_eq!(res.headers()[header::CACHE_CONTROL], "no-store");
    }

    #[tokio::test]
    async fn refuses_images_above_the_size_limit() {
        let large = [PNG, &[0; 100]].concat().leak();
        let (declared, _) = upstream(large, "image/png").await;
        let streamed = Router::new().route(
            "/image",
            get(|| async {
                let chunks = [PNG.to_vec(), vec![0; 100]].map(Ok::<_, std::io::Error>);
                Body::from_stream(futures::stream::iter(chunks))
            }),
        );
        let streamed = format!("{}/image", serve(streamed).await);
        let proxy = local_proxy().await;

        let res = request(signed(&proxy, &declared)).await;
        assert_eq!(res.status(), 502);
        // Without a declared size, the answer may have begun before the excess shows; it then breaks off.
        let res = request(signed(&proxy, &streamed)).await;
        let delivered = res.status() == 200 && res.bytes().await.is_ok();
        assert!(!delivered);
    }

    #[tokio::test]
    async fn follows_redirects_asking_each_host_from_its_own_origin() {
        let referers = Arc::new(Mutex::new(Vec::new()));
        let recorded = referers.clone();
        let target = Router::new().route(
            "/image",
            get(move |headers: HeaderMap| async move {
                let referer = headers[header::REFERER].to_str().unwrap().to_string();
                recorded.lock().unwrap().push(referer);
                ([(header::CONTENT_TYPE, "image/png")], PNG)
            }),
        );
        let target = serve(target).await;
        let moved = format!("{target}/image");
        let start = Router::new().route(
            "/old",
            get(move || async move { Redirect::temporary(&moved) }),
        );
        let start = serve(start).await;
        let proxy = local_proxy().await;

        let res = request(signed(&proxy, &format!("{start}/old"))).await;

        assert_eq!(res.status(), 200);
        assert_eq!(*referers.lock().unwrap(), [target]);
    }

    #[test]
    fn refuses_keys_short_enough_to_guess() {
        assert!(ImageProxy::new("").is_err());
        assert!(ImageProxy::new(&KEY[..31]).is_err());
        assert!(ImageProxy::new(KEY).is_ok());
    }

    #[tokio::test]
    async fn fetches_from_public_addresses_only() {
        let (image, count) = upstream(PNG, "image/png").await;
        let by_name = image.replace("127.0.0.1", "localhost");
        let proxy = serve(router(ImageProxy::new(KEY).unwrap())).await;

        for url in [image, by_name] {
            let res = request(signed(&proxy, &url)).await;
            assert_eq!(res.status(), 502, "{url}");
        }
        assert_eq!(count.load(Ordering::Relaxed), 0);
    }
}
