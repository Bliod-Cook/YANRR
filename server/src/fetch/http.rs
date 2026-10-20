use std::time::Duration;

use reqwest::{Client, StatusCode, Url, header, redirect};

const MAX_REDIRECTS: usize = 5;

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
        .user_agent(concat!("YANNR/", env!("CARGO_PKG_VERSION")))
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
    let mut url = Url::parse(url).map_err(|err| err.to_string())?;
    let mut permanent = None;
    for _ in 0..=MAX_REDIRECTS {
        let mut request = client.get(url.clone());
        if let Some(etag) = &validators.etag {
            request = request.header(header::IF_NONE_MATCH, etag);
        }
        if let Some(last_modified) = &validators.last_modified {
            request = request.header(header::IF_MODIFIED_SINCE, last_modified);
        }
        let response = request.send().await.map_err(|err| err.to_string())?;
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
        let body = response
            .bytes()
            .await
            .map_err(|err| err.to_string())?
            .to_vec();
        let moved_to = permanent.unwrap_or(false).then(|| url.into());
        return Ok(Some(Fetched {
            body,
            validators,
            moved_to,
        }));
    }
    Err("Too many redirects".into())
}
