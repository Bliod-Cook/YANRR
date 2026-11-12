#![allow(dead_code)]

use std::{
    collections::HashMap,
    io::Write,
    sync::{
        Arc, Mutex, Weak,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};

use axum::{
    Router,
    extract::{Query, State},
    http::{HeaderMap, StatusCode, Uri},
    response::IntoResponse,
    routing::{get, post},
};
use postgresql_embedded::{PostgreSQL, SettingsBuilder};
use reqwest::{Client, Response, header};
use sea_orm::ConnectionTrait;
use serde_json::{Value, json};
use tempfile::{NamedTempFile, TempDir};
use tokio::net::TcpListener;
use yanrr::{
    AppState,
    config::{AiConfig, Config, PushConfig},
};

pub const PASSWORD: &str = "correct-horse-battery";

/// The PostgreSQL server the running tests of this binary share; it stops when the last of them ends.
static POSTGRES: tokio::sync::Mutex<Weak<PostgreSQL>> = tokio::sync::Mutex::const_new(Weak::new());
static DATABASES: AtomicUsize = AtomicUsize::new(0);

/// The shared PostgreSQL server, started when no test holds it.
async fn postgres() -> Arc<PostgreSQL> {
    let mut shared = POSTGRES.lock().await;
    if let Some(postgres) = shared.upgrade() {
        return postgres;
    }
    // initdb on Windows easily exceeds the 5 s default, and the tests of a binary together may open more
    // connections than the default 100.
    let settings = SettingsBuilder::new()
        .timeout(Some(Duration::from_secs(60)))
        .config("max_connections", "300")
        .build();
    let mut postgres = PostgreSQL::new(settings);
    postgres.setup().await.unwrap();
    postgres.start().await.unwrap();
    let postgres = Arc::new(postgres);
    *shared = Arc::downgrade(&postgres);
    postgres
}

/// A running server backed by its own database on the shared PostgreSQL server.
pub struct TestApp {
    pub url: String,
    pub client: Client,
    pub state: AppState,
    _postgres: Arc<PostgreSQL>,
    _search: TempDir,
}

impl TestApp {
    pub async fn spawn() -> Self {
        Self::spawn_with(|_| {}).await
    }

    pub async fn spawn_with(customize: impl FnOnce(&mut Config)) -> Self {
        let postgres = postgres().await;
        let database = format!("test{}", DATABASES.fetch_add(1, Ordering::Relaxed));
        postgres.create_database(&database).await.unwrap();

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let mut config: Config = toml::from_str(&format!(
            r#"
            [server]
            listen = "127.0.0.1:0"
            public_url = "{url}"
            [database]
            url = "{database}"
            [auth]
            secret = "test-secret-that-is-at-least-32-characters"
            "#,
            database = postgres.settings().url(&database),
        ))
        .unwrap();
        // Each server writes its own index; tests running at once would otherwise fight over its lock.
        let search = TempDir::new().unwrap();
        config.search.dir = search.path().into();
        customize(&mut config);

        let state = yanrr::init(config).await.unwrap();
        let app = yanrr::router(state.clone());
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });

        let mut headers = header::HeaderMap::new();
        headers.insert(header::ORIGIN, url.parse().unwrap());
        let client = Client::builder()
            .cookie_store(true)
            .default_headers(headers)
            .build()
            .unwrap();
        Self {
            url,
            client,
            state,
            _postgres: postgres,
            _search: search,
        }
    }

    pub async fn get(&self, path: &str) -> Response {
        self.client
            .get(format!("{}{path}", self.url))
            .send()
            .await
            .unwrap()
    }

    pub async fn post(&self, path: &str, body: Value) -> Response {
        self.client
            .post(format!("{}{path}", self.url))
            .json(&body)
            .send()
            .await
            .unwrap()
    }

    pub async fn patch(&self, path: &str, body: Value) -> Response {
        self.client
            .patch(format!("{}{path}", self.url))
            .json(&body)
            .send()
            .await
            .unwrap()
    }

    pub async fn put(&self, path: &str, body: Value) -> Response {
        self.client
            .put(format!("{}{path}", self.url))
            .json(&body)
            .send()
            .await
            .unwrap()
    }

    pub async fn post_bytes(&self, path: &str, body: impl Into<reqwest::Body>) -> Response {
        self.client
            .post(format!("{}{path}", self.url))
            .header(header::CONTENT_TYPE, "application/octet-stream")
            .body(body)
            .send()
            .await
            .unwrap()
    }

    pub async fn delete(&self, path: &str, body: Value) -> Response {
        self.client
            .delete(format!("{}{path}", self.url))
            .json(&body)
            .send()
            .await
            .unwrap()
    }

    /// The signed-in user's whole change log.
    pub async fn actions(&self) -> Vec<Value> {
        let delta = json(self.get("/api/sync/delta?lastSyncId=0").await).await;
        delta["data"]["actions"].as_array().unwrap().clone()
    }

    pub async fn session(&self) -> Value {
        self.get("/api/better-auth/get-session")
            .await
            .json()
            .await
            .unwrap()
    }

    pub async fn user_id(&self) -> String {
        self.session().await["user"]["id"]
            .as_str()
            .unwrap()
            .to_string()
    }

    /// Adds a user straight to the database, for data that belongs to someone other than the client.
    pub async fn insert_user(&self, id: &str) {
        let sql = format!(
            "INSERT INTO users (id, email, email_verified, created_at, updated_at)
             VALUES ('{id}', '{id}@example.com', false, now(), now())"
        );
        self.state.db.execute_unprepared(&sql).await.unwrap();
    }

    /// Registers an account, which also signs the client in.
    pub async fn sign_up(&self, email: &str) {
        let body = json!({ "email": email, "password": PASSWORD, "name": "tester" });
        let res = self.post("/api/better-auth/sign-up/email", body).await;
        assert_eq!(res.status(), 200, "{}", res.text().await.unwrap());
    }
}

pub async fn json(response: Response) -> Value {
    response.json().await.unwrap()
}

/// Asserts an API error by status and `code`.
pub async fn assert_error(response: Response, status: u16, code: i32) {
    assert_eq!(response.status(), status);
    assert_eq!(json(response).await["code"], code);
}

/// A JSON Feed holding `items`.
pub fn json_feed(items: Value) -> String {
    json!({ "version": "https://jsonfeed.org/version/1.1", "title": "Generated", "items": items })
        .to_string()
}

/// Subscribes the signed-in user to the feed at `url` and returns its id.
pub async fn subscribe(app: &TestApp, url: &str, form: Value) -> String {
    let mut form = form;
    form["url"] = url.into();
    let created = json(app.post("/api/subscriptions", form).await).await;
    created["feed"]["id"].as_str().unwrap().to_string()
}

pub const RSS2: &str = include_str!("../fixtures/rss2.xml");
pub const SINGLE_ITEM_RSS: &str = r#"<rss version="2.0"><channel><title>Live</title>
    <item><guid>post-0</guid><title>Earlier post</title><link>https://example.com/posts/0</link></item>
</channel></rss>"#;
/// [`SINGLE_ITEM_RSS`] after a new post.
pub const TWO_ITEM_RSS: &str = r#"<rss version="2.0"><channel><title>Live</title>
    <item><guid>post-new</guid><title>New post</title><pubDate>Fri, 02 Oct 2026 09:00:00 GMT</pubDate></item>
    <item><guid>post-0</guid><title>Earlier post</title><link>https://example.com/posts/0</link></item>
</channel></rss>"#;
const JSON_FEED: &str = include_str!("../fixtures/feed.json");

/// What a configurable path answers; tests switch it to simulate a feed changing over time.
#[derive(Clone)]
pub enum Reply {
    Body(String),
    Status(u16),
    MovedTo(&'static str),
    /// Never answers.
    Hang,
    /// An empty answer with this status and these headers.
    Headers(u16, &'static [(&'static str, &'static str)]),
    /// A body of raw bytes with this `Content-Type`.
    Bytes(Vec<u8>, &'static str),
}

#[derive(Clone)]
struct FixtureState {
    replies: Arc<Mutex<HashMap<String, Reply>>>,
    not_modified: Arc<AtomicUsize>,
    requests: Arc<Mutex<Vec<(String, Recorded)>>>,
}

/// A local feed server: `/rss`, `/etag` (answers 304 to `If-None-Match: "v1"`), `/rsshub/*`, and any path set with [`Fixtures::set`].
pub struct Fixtures {
    base: String,
    state: FixtureState,
}

impl Fixtures {
    pub async fn spawn() -> Self {
        let state = FixtureState {
            replies: Arc::default(),
            not_modified: Arc::default(),
            requests: Arc::default(),
        };
        let app = Router::new()
            .route("/rss", get(|| async { RSS2 }))
            .route("/etag", get(etag))
            .route("/rsshub/{*route}", get(rsshub))
            .route("/faviconV2", get(favicon_v2))
            .route(FCM_SEND_PATH, post(fcm_send))
            .route(AI_PATH, post(chat))
            .fallback(replied)
            .with_state(state.clone());
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        Self { base, state }
    }

    pub fn url(&self, path: &str) -> String {
        format!("{}{path}", self.base)
    }

    pub fn set(&self, path: &str, reply: Reply) {
        self.state
            .replies
            .lock()
            .unwrap()
            .insert(path.into(), reply);
    }

    pub fn not_modified_count(&self) -> usize {
        self.state.not_modified.load(Ordering::SeqCst)
    }

    /// Requests made to `path` among those answered by [`Fixtures::set`], oldest first.
    pub fn requests(&self, path: &str) -> Vec<Recorded> {
        let requests = self.state.requests.lock().unwrap();
        requests
            .iter()
            .filter(|(requested, _)| requested == path)
            .map(|(_, request)| request.clone())
            .collect()
    }
}

#[derive(Clone)]
pub struct Recorded {
    pub authorization: Option<String>,
    pub body: String,
}

async fn etag(State(state): State<FixtureState>, headers: HeaderMap) -> axum::response::Response {
    if headers
        .get(header::IF_NONE_MATCH)
        .is_some_and(|etag| etag == "\"v1\"")
    {
        state.not_modified.fetch_add(1, Ordering::SeqCst);
        return StatusCode::NOT_MODIFIED.into_response();
    }
    ([(header::ETAG, "\"v1\"")], RSS2).into_response()
}

fn record(state: &FixtureState, uri: &Uri, headers: &HeaderMap, body: String) {
    let authorization = headers
        .get(header::AUTHORIZATION)
        .map(|value| value.to_str().unwrap().to_string());
    let request = Recorded {
        authorization,
        body,
    };
    state
        .requests
        .lock()
        .unwrap()
        .push((uri.path().into(), request));
}

async fn replied(
    State(state): State<FixtureState>,
    uri: Uri,
    headers: HeaderMap,
    body: String,
) -> axum::response::Response {
    record(&state, &uri, &headers, body);
    let reply = state.replies.lock().unwrap().get(uri.path()).cloned();
    match reply.unwrap_or(Reply::Status(404)) {
        Reply::Body(body) => body.into_response(),
        Reply::Status(status) => StatusCode::from_u16(status).unwrap().into_response(),
        Reply::Bytes(body, content_type) => {
            ([(header::CONTENT_TYPE, content_type)], body).into_response()
        }
        Reply::Hang => std::future::pending().await,
        Reply::MovedTo(path) => {
            (StatusCode::MOVED_PERMANENTLY, [(header::LOCATION, path)]).into_response()
        }
        Reply::Headers(status, headers) => {
            let mut response = StatusCode::from_u16(status).unwrap().into_response();
            for (name, value) in headers {
                response
                    .headers_mut()
                    .insert(*name, header::HeaderValue::from_static(value));
            }
            response
        }
    }
}

async fn rsshub(Query(query): Query<HashMap<String, String>>) -> axum::response::Response {
    match query.get("format").map(String::as_str) {
        Some("json") => JSON_FEED.into_response(),
        _ => StatusCode::NOT_FOUND.into_response(),
    }
}

/// A site icon, as far as its leading bytes tell.
pub const ICON_PNG: &[u8] = b"\x89PNG\r\n\x1a\nsite icon";

/// Answers like Google's favicon service: the icon of `known.example`, a failure for `broken.example`, and a 404
/// with a globe placeholder for any other site or when an option is missing.
async fn favicon_v2(Query(query): Query<HashMap<String, String>>) -> axum::response::Response {
    let options = [
        ("client", "SOCIAL"),
        ("type", "FAVICON"),
        ("fallback_opts", "TYPE,SIZE,URL"),
        ("size", "64"),
    ];
    let complete = options
        .iter()
        .all(|(key, value)| query.get(*key).is_some_and(|given| given == value));
    let png = [(header::CONTENT_TYPE, "image/png")];
    match query.get("url").map(String::as_str) {
        Some("https://known.example") if complete => (png, ICON_PNG).into_response(),
        Some("https://broken.example") => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
        _ => (
            StatusCode::NOT_FOUND,
            png,
            b"\x89PNG\r\n\x1a\nglobe".as_slice(),
        )
            .into_response(),
    }
}

/// Where [`fake_fcm`] takes messages.
pub const FCM_SEND_PATH: &str = "/v1/projects/yanrr-test/messages:send";

/// Takes a message like FCM: a token starting with `gone` is no longer registered, one starting with `denied` is
/// refused, and any other is sent.
async fn fcm_send(
    State(state): State<FixtureState>,
    uri: Uri,
    headers: HeaderMap,
    body: String,
) -> axum::response::Response {
    let token = serde_json::from_str::<Value>(&body).unwrap()["message"]["token"]
        .as_str()
        .unwrap()
        .to_string();
    record(&state, &uri, &headers, body);
    let error = |status: StatusCode, code: &str| {
        let details = json!([{ "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", "errorCode": code }]);
        let error =
            json!({ "error": { "code": status.as_u16(), "status": code, "details": details } });
        (status, error.to_string()).into_response()
    };
    if token.starts_with("gone") {
        error(StatusCode::NOT_FOUND, "UNREGISTERED")
    } else if token.starts_with("denied") {
        error(StatusCode::FORBIDDEN, "PERMISSION_DENIED")
    } else {
        json!({ "name": "sent" }).to_string().into_response()
    }
}

/// Push settings for an FCM that `fixtures` fakes, answering `/token` with an access token and taking messages at
/// [`FCM_SEND_PATH`]. The service account file has to be kept until the app started.
pub fn fake_fcm(fixtures: &Fixtures) -> (PushConfig, NamedTempFile) {
    let token = json!({ "access_token": "fcm-access", "expires_in": 3599 });
    fixtures.set("/token", Reply::Body(token.to_string()));
    let account = json!({
        "type": "service_account",
        "project_id": "yanrr-test",
        "client_email": "push@yanrr-test.iam.gserviceaccount.com",
        "private_key": include_str!("../fixtures/push-key.pem"),
        "token_uri": fixtures.url("/token"),
    });
    let mut key_file = NamedTempFile::new().unwrap();
    key_file.write_all(account.to_string().as_bytes()).unwrap();
    let push = PushConfig {
        firebase_service_account: key_file.path().into(),
        fcm_url: fixtures.url(""),
    };
    (push, key_file)
}

/// Where [`fake_ai`] takes chat completions.
pub const AI_PATH: &str = "/v1/chat/completions";

/// What [`fake_ai`] explains a failure with, which is no business of the server's clients.
pub const AI_FAILURE: &str = "quota of key sk-test exceeded";

/// Answers like a model: a user message mentioning `fail` fails with [`AI_FAILURE`], one mentioning `hang` is
/// never answered, a JSON array of strings comes back translated as `T: …` in a Markdown code block, and anything
/// else is summarized as `Summary: …`. A translation merges a text mentioning `merge` into the one before it,
/// and splits one mentioning `split` in two.
async fn chat(
    State(state): State<FixtureState>,
    uri: Uri,
    headers: HeaderMap,
    body: String,
) -> axum::response::Response {
    let request: Value = serde_json::from_str(&body).unwrap();
    let content = request["messages"][1]["content"]
        .as_str()
        .unwrap()
        .to_string();
    record(&state, &uri, &headers, body);
    if content.contains("fail") {
        return (StatusCode::INTERNAL_SERVER_ERROR, AI_FAILURE).into_response();
    }
    if content.contains("hang") {
        return std::future::pending().await;
    }
    let answer = match serde_json::from_str::<Vec<String>>(&content) {
        Ok(texts) => {
            let mut translations: Vec<String> = Vec::new();
            for text in &texts {
                let translation = format!("T: {text}");
                match translations.last_mut() {
                    Some(last) if text.contains("merge") => *last += &translation,
                    _ if text.contains("split") => translations.extend([translation, "T:".into()]),
                    _ => translations.push(translation),
                }
            }
            format!("```json\n{}\n```", json!(translations))
        }
        Err(_) => format!("Summary: {content}"),
    };
    json!({ "choices": [{ "message": { "role": "assistant", "content": answer } }] })
        .to_string()
        .into_response()
}

/// AI settings for a model that `fixtures` fakes at [`AI_PATH`].
pub fn fake_ai(fixtures: &Fixtures) -> AiConfig {
    AiConfig {
        base_url: fixtures.url("/v1"),
        api_key: Some("ai-key".into()),
        model: "test-model".into(),
    }
}

/// Serves an article at `/article` and returns its address: its readable part says "keeps every subscription in
/// sync", its navigation "About this site".
pub fn article(fixtures: &Fixtures) -> String {
    let paragraph = "The reader keeps every subscription in sync across devices, and this sentence is \
        long enough to look like the body of an article rather than a navigation label. ";
    let page = format!(
        "<html><head><title>Article</title></head><body>
            <nav><a href='/'>Home</a> <a href='/about'>About this site</a></nav>
            <article><h1>Article</h1><p>{0}{0}</p><p>{0}{0}</p><p>{0}{0}</p></article>
        </body></html>",
        paragraph
    );
    fixtures.set("/article", Reply::Body(page));
    fixtures.url("/article")
}

/// Creates an inbox for the signed-in user and returns its secret.
pub async fn create_inbox(app: &TestApp, handle: &str) -> String {
    app.post("/api/inboxes", json!({ "handle": handle })).await;
    let inbox = json(app.get(&format!("/api/inboxes?handle={handle}")).await).await;
    inbox["data"]["secret"].as_str().unwrap().to_string()
}

/// Posts `entry` to the webhook of the inbox with `secret`.
pub async fn deliver(app: &TestApp, secret: &str, entry: Value) -> Response {
    app.client
        .post(format!("{}/api/inboxes/webhook", app.url))
        .bearer_auth(secret)
        .json(&entry)
        .send()
        .await
        .unwrap()
}
