#![allow(dead_code)]

use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};

use axum::{
    Router,
    extract::{Query, State},
    http::{HeaderMap, StatusCode, Uri},
    response::IntoResponse,
    routing::get,
};
use postgresql_embedded::{PostgreSQL, SettingsBuilder};
use reqwest::{Client, Response, header};
use sea_orm::ConnectionTrait;
use serde_json::{Value, json};
use tokio::net::TcpListener;
use yannr::{AppState, config::Config};

pub const PASSWORD: &str = "correct-horse-battery";

/// A running server backed by its own PostgreSQL instance, stopped on drop.
pub struct TestApp {
    pub url: String,
    pub client: Client,
    pub state: AppState,
    _postgres: PostgreSQL,
}

impl TestApp {
    pub async fn spawn() -> Self {
        Self::spawn_with(|_| {}).await
    }

    pub async fn spawn_with(customize: impl FnOnce(&mut Config)) -> Self {
        // initdb on Windows easily exceeds the 5 s default.
        let mut postgres = PostgreSQL::new(
            SettingsBuilder::new()
                .timeout(Some(Duration::from_secs(60)))
                .build(),
        );
        postgres.setup().await.unwrap();
        postgres.start().await.unwrap();
        postgres.create_database("yannr").await.unwrap();

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
            database = postgres.settings().url("yannr"),
        ))
        .unwrap();
        customize(&mut config);

        let state = yannr::init(config).await.unwrap();
        let app = yannr::router(state.clone());
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

pub const RSS2: &str = include_str!("../fixtures/rss2.xml");
const JSON_FEED: &str = include_str!("../fixtures/feed.json");

/// What a configurable path answers; tests switch it to simulate a feed changing over time.
#[derive(Clone)]
pub enum Reply {
    Body(String),
    Status(u16),
    MovedTo(&'static str),
}

#[derive(Clone)]
struct FixtureState {
    replies: Arc<Mutex<HashMap<String, Reply>>>,
    not_modified: Arc<AtomicUsize>,
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
        };
        let app = Router::new()
            .route("/rss", get(|| async { RSS2 }))
            .route("/etag", get(etag))
            .route("/rsshub/{*route}", get(rsshub))
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

async fn replied(State(state): State<FixtureState>, uri: Uri) -> axum::response::Response {
    let reply = state.replies.lock().unwrap().get(uri.path()).cloned();
    match reply.unwrap_or(Reply::Status(404)) {
        Reply::Body(body) => body.into_response(),
        Reply::Status(status) => StatusCode::from_u16(status).unwrap().into_response(),
        Reply::MovedTo(path) => {
            (StatusCode::MOVED_PERMANENTLY, [(header::LOCATION, path)]).into_response()
        }
    }
}

async fn rsshub(Query(query): Query<HashMap<String, String>>) -> axum::response::Response {
    match query.get("format").map(String::as_str) {
        Some("json") => JSON_FEED.into_response(),
        _ => StatusCode::NOT_FOUND.into_response(),
    }
}
