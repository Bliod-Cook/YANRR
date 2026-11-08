mod common;

use common::{Fixtures, ICON_PNG, Reply, TestApp, subscribe};
use reqwest::{StatusCode, header};
use serde_json::json;

/// An app whose Google provider is the fake in [`Fixtures`].
async fn spawn() -> (TestApp, Fixtures) {
    let fixtures = Fixtures::spawn().await;
    let google = fixtures.url("");
    let app = TestApp::spawn_with(|config| config.icons.google_url = Some(google)).await;
    (app, fixtures)
}

#[tokio::test]
async fn serves_icons_and_answers_misses_with_an_empty_404() {
    let (app, _fixtures) = spawn().await;
    app.sign_up("icons@example.com").await;

    let found = app.get("/api/icons/known.example").await;
    assert_eq!(found.status(), StatusCode::OK);
    assert_eq!(found.headers()[header::CONTENT_TYPE], "image/png");
    assert_eq!(
        found.headers()[header::CACHE_CONTROL],
        "public, max-age=2592000"
    );
    assert_eq!(found.headers()[header::X_CONTENT_TYPE_OPTIONS], "nosniff");
    assert_eq!(found.bytes().await.unwrap(), ICON_PNG);

    // Google's globe placeholder would keep clients from drawing their own.
    let missing = app.get("/api/icons/unknown.example").await;
    assert_eq!(missing.status(), StatusCode::NOT_FOUND);
    assert_eq!(
        missing.headers()[header::CACHE_CONTROL],
        "public, max-age=86400"
    );
    assert!(missing.bytes().await.unwrap().is_empty());

    let failed = app.get("/api/icons/broken.example").await;
    assert_eq!(failed.status(), StatusCode::BAD_GATEWAY);
    assert_eq!(failed.headers()[header::CACHE_CONTROL], "no-store");
}

#[tokio::test]
async fn signed_out_visitors_get_icons_only_of_sites_with_stored_feeds() {
    let (app, fixtures) = spawn().await;
    let signed_out = || reqwest::get(format!("{}/api/icons/known.example", app.url));

    let unknown = signed_out().await.unwrap();
    assert_eq!(unknown.status(), StatusCode::NOT_FOUND);
    assert_eq!(unknown.headers()[header::CACHE_CONTROL], "no-store");

    let feed = r#"<rss version="2.0"><channel><title>Known</title>
        <link>https://known.example/blog/</link></channel></rss>"#;
    fixtures.set("/known", Reply::Body(feed.into()));
    app.sign_up("icons@example.com").await;
    subscribe(&app, &fixtures.url("/known"), json!({})).await;

    assert_eq!(signed_out().await.unwrap().status(), StatusCode::OK);
}

#[tokio::test]
async fn takes_nothing_but_a_hostname() {
    let (app, _fixtures) = spawn().await;
    app.sign_up("icons@example.com").await;

    for host in ["127.0.0.1", "known.example:8443"] {
        let response = app.get(&format!("/api/icons/{host}")).await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST, "{host}");
    }
}
