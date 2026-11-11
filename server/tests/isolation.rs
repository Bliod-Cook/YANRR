//! What one user follows, reads, collects and sets is theirs alone: others neither see nor change it.

mod common;

use common::{Fixtures, PASSWORD, TestApp, json, subscribe};
use serde_json::{Value, json};

/// Bob following the feed at `/rss`, then Alice, signed in, following it too; the feed's id and its newest entry.
async fn bob_then_alice(app: &TestApp, fixtures: &Fixtures) -> (String, Value) {
    app.sign_up("bob@example.com").await;
    let feed_id = subscribe(app, &fixtures.url("/rss"), json!({})).await;
    let entry_id = timeline(app, json!({})).await[0]["entries"]["id"].clone();
    app.sign_up("alice@example.com").await;
    subscribe(app, &fixtures.url("/rss"), json!({})).await;
    (feed_id, entry_id)
}

async fn sign_in(app: &TestApp, email: &str) {
    let body = json!({ "email": email, "password": PASSWORD });
    let signed_in = app.post("/api/better-auth/sign-in/email", body).await;
    assert_eq!(signed_in.status(), 200);
}

async fn timeline(app: &TestApp, query: Value) -> Vec<Value> {
    let listed = json(app.post("/api/entries", query).await).await;
    listed["data"].as_array().unwrap().clone()
}

async fn data(app: &TestApp, path: &str) -> Value {
    json(app.get(path).await).await["data"].clone()
}

#[tokio::test]
async fn subscriptions_are_their_followers_own() {
    let (app, fixtures) = (TestApp::spawn().await, Fixtures::spawn().await);
    let (feed_id, _) = bob_then_alice(&app, &fixtures).await;

    let renamed = json!({ "feedId": feed_id, "title": "Alice's" });
    app.patch("/api/subscriptions", renamed).await;
    let theirs = data(&app, "/api/subscriptions").await;
    app.delete("/api/subscriptions", json!({ "feedId": feed_id }))
        .await;

    assert_eq!(theirs.as_array().unwrap().len(), 1);
    assert_eq!(theirs[0]["title"], "Alice's");
    sign_in(&app, "bob@example.com").await;
    let bobs = data(&app, "/api/subscriptions").await;
    assert_eq!(bobs.as_array().unwrap().len(), 1);
    assert_eq!(bobs[0]["title"], Value::Null);
}

#[tokio::test]
async fn read_states_are_their_readers_own() {
    let (app, fixtures) = (TestApp::spawn().await, Fixtures::spawn().await);
    let (feed_id, entry_id) = bob_then_alice(&app, &fixtures).await;
    sign_in(&app, "bob@example.com").await;
    app.post("/api/reads", json!({ "entryIds": [entry_id] }))
        .await;
    sign_in(&app, "alice@example.com").await;

    let unread = data(&app, "/api/reads").await;
    app.post("/api/reads/all", json!({})).await;

    assert_eq!(unread, json!({ feed_id.clone(): 2 }));
    sign_in(&app, "bob@example.com").await;
    assert_eq!(data(&app, "/api/reads").await, json!({ feed_id: 1 }));
}

#[tokio::test]
async fn collections_are_their_collectors_own() {
    let (app, fixtures) = (TestApp::spawn().await, Fixtures::spawn().await);
    let (_, entry_id) = bob_then_alice(&app, &fixtures).await;
    sign_in(&app, "bob@example.com").await;
    app.post("/api/collections", json!({ "entryId": entry_id }))
        .await;
    sign_in(&app, "alice@example.com").await;

    let collected = timeline(&app, json!({ "isCollection": true })).await;
    let listed = timeline(&app, json!({})).await;
    app.delete("/api/collections", json!({ "entryId": entry_id }))
        .await;

    assert_eq!(collected, Vec::<Value>::new());
    assert!(listed.iter().all(|item| item.get("collections").is_none()));
    sign_in(&app, "bob@example.com").await;
    assert_eq!(
        timeline(&app, json!({ "isCollection": true })).await.len(),
        1
    );
}

#[tokio::test]
async fn settings_are_their_users_own() {
    let app = TestApp::spawn().await;
    app.sign_up("bob@example.com").await;
    app.patch("/api/settings/general", json!({ "theme": "dark" }))
        .await;
    app.sign_up("alice@example.com").await;

    let settings = json(app.get("/api/settings").await).await;
    app.patch("/api/settings/general", json!({ "theme": "light" }))
        .await;

    assert_eq!(settings["settings"], json!({}));
    sign_in(&app, "bob@example.com").await;
    let bobs = json(app.get("/api/settings").await).await;
    assert_eq!(bobs["settings"], json!({ "general": { "theme": "dark" } }));
}
