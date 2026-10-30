mod common;

use std::collections::HashMap;

use common::{
    AI_PATH, Fixtures, Recorded, Reply, TestApp, assert_error, create_inbox, deliver, fake_ai,
    json, json_feed, subscribe,
};
use serde_json::{Value, json};

/// A signed-in app whose AI is faked by `fixtures`, following the JSON Feed `items` at `/feed.json`.
async fn following(fixtures: &Fixtures, items: Value) -> TestApp {
    let ai = fake_ai(fixtures);
    let app = TestApp::spawn_with(|config| config.ai = Some(ai)).await;
    fixtures.set("/feed.json", Reply::Body(json_feed(items)));
    app.sign_up("alice@example.com").await;
    subscribe(&app, &fixtures.url("/feed.json"), json!({})).await;
    app
}

/// The translations a batch streams, by entry id.
async fn translate(app: &TestApp, body: Value) -> HashMap<String, Value> {
    let response = app.post("/api/ai/translation/batch", body).await;
    assert_eq!(response.headers()["content-type"], "application/x-ndjson");
    let lines = response.text().await.unwrap();
    lines
        .lines()
        .map(|line| {
            let line: Value = serde_json::from_str(line).unwrap();
            (
                line["id"].as_str().unwrap().to_string(),
                line["data"].clone(),
            )
        })
        .collect()
}

/// What the model was asked to translate.
fn texts(request: &Recorded) -> Value {
    let request: Value = serde_json::from_str(&request.body).unwrap();
    serde_json::from_str(request["messages"][1]["content"].as_str().unwrap()).unwrap()
}

/// The id of the newest entry with `guid` on the user's timeline.
async fn entry_id(app: &TestApp, guid: &str) -> String {
    let items = json(app.post("/api/entries", json!({})).await).await;
    let items = items["data"].as_array().unwrap();
    let item = items.iter().find(|item| item["entries"]["guid"] == guid);
    item.unwrap()["entries"]["id"].as_str().unwrap().to_string()
}

#[tokio::test]
async fn ai_needs_configuring() {
    let app = TestApp::spawn().await;
    app.sign_up("alice@example.com").await;

    let summary = app.get("/api/ai/summary?id=1&language=en").await;
    let batch = json!({ "ids": ["1"], "language": "en", "fields": "title" });
    let batch = app.post("/api/ai/translation/batch", batch).await;

    assert_error(summary, 500, 5).await;
    assert_error(batch, 500, 5).await;
}

#[tokio::test]
async fn summaries_are_made_once_per_text() {
    let fixtures = Fixtures::spawn().await;
    let item = json!([{
        "id": "rust",
        "title": "Rust 2.0",
        "url": common::article(&fixtures),
        "content_html": "<p>Rust 2.0 is <b>out</b>.</p><p>Upgrade now.</p>",
    }]);
    let app = following(&fixtures, item).await;
    let id = entry_id(&app, "rust").await;

    let path = format!("/api/ai/summary?id={id}&language=ja&target=content");
    let summary = json(app.get(&path).await).await;

    let expected = "Summary: Rust 2.0\n\nRust 2.0 is out.\nUpgrade now.";
    assert_eq!(summary, json!({ "code": 0, "data": expected }));
    let requests = fixtures.requests(AI_PATH);
    assert_eq!(requests[0].authorization.as_deref(), Some("Bearer ai-key"));
    let request: Value = serde_json::from_str(&requests[0].body).unwrap();
    assert_eq!(request["model"], "test-model");
    let prompt = request["messages"][0]["content"].as_str().unwrap();
    assert!(prompt.contains("Japanese"));
    assert_eq!(json(app.get(&path).await).await, summary);
    assert_eq!(fixtures.requests(AI_PATH).len(), 1);

    let path = format!("/api/ai/summary?id={id}&language=ja&target=readabilityContent");
    let readable = json(app.get(&path).await).await;
    let readable = readable["data"].as_str().unwrap();
    assert!(readable.contains("keeps every subscription in sync"));
    assert!(!readable.contains("About this site"));
    assert_eq!(fixtures.requests(AI_PATH).len(), 2);
    let unknown = app.get("/api/ai/summary?id=1&language=ja").await;
    assert_error(unknown, 404, 3000).await;
}

#[tokio::test]
async fn batches_stream_a_line_per_translated_entry() {
    let fixtures = Fixtures::spawn().await;
    let items = json!([
        { "id": "hello", "title": "Hello", "summary": "A greeting", "content_text": "Hello there" },
        { "id": "broken", "title": "Please fail", "content_text": "Broken" },
    ]);
    let app = following(&fixtures, items).await;
    let secret = create_inbox(&app, "news").await;
    let mail = json!({ "guid": "mail", "publishedAt": "2026-10-01T08:00:00Z", "title": "Mail" });
    deliver(&app, &secret, mail).await;
    let hello = entry_id(&app, "hello").await;
    let broken = entry_id(&app, "broken").await;
    let mail = entry_id(&app, "mail").await;

    let batch = json!({
        "ids": [hello, broken, mail, "1"],
        "language": "zh-CN",
        "fields": "title,description",
        "mode": "bilingual",
        "part": "0",
    });
    let lines = translate(&app, batch).await;

    assert_eq!(lines.len(), 2);
    let greeting = json!({ "title": "T: Hello", "description": "T: A greeting" });
    assert_eq!(lines[&hello], greeting);
    assert_eq!(lines[&mail], json!({ "title": "T: Mail" }));
    let requests = fixtures.requests(AI_PATH);
    assert_eq!(requests.len(), 3);
    assert!(
        requests
            .iter()
            .any(|request| texts(request) == json!(["Hello", "A greeting"]))
    );

    // A rule rewriting the title makes a new text to translate; the description is still known.
    let rewrite = json!({ "rewriteRules": [{ "from": "Hello", "to": "Hi" }] });
    let rules = json!([{ "name": "Hi", "condition": [], "result": rewrite }]);
    app.put("/api/actions", json!({ "rules": rules })).await;
    let batch = json!({ "ids": [hello], "language": "zh-CN", "fields": "title,description" });
    let lines = translate(&app, batch).await;

    let greeting = json!({ "title": "T: Hi", "description": "T: A greeting" });
    assert_eq!(lines[&hello], greeting);
    let requests = fixtures.requests(AI_PATH);
    assert_eq!(requests.len(), 4);
    assert_eq!(texts(&requests[3]), json!(["Hi"]));
    let unknown = json!({ "ids": [hello], "language": "zh-CN", "fields": "title,author" });
    let unknown = app.post("/api/ai/translation/batch", unknown).await;
    assert_error(unknown, 400, 4).await;
}

#[tokio::test]
async fn content_is_translated_beside_or_instead_of_the_original() {
    let fixtures = Fixtures::spawn().await;
    let content = r#"<p>One.</p><p>Two <a href="https://example.com/">links</a>.</p>"#;
    let item = json!([{ "id": "post", "title": "Post", "content_html": content }]);
    let app = following(&fixtures, item).await;
    let id = entry_id(&app, "post").await;

    let batch = |mode| json!({ "ids": [id], "language": "ja", "fields": "content", "mode": mode });
    let bilingual = translate(&app, batch("bilingual")).await;
    let translated = translate(&app, batch("translation-only")).await;

    let beside = r#"<p>One.<br>T: One.</p><p>Two <a href="https://example.com/">links</a>.<br>T: Two links.</p>"#;
    assert_eq!(bilingual[&id], json!({ "content": beside }));
    let instead = "<p>T: One.</p><p>T: Two links.</p>";
    assert_eq!(translated[&id], json!({ "content": instead }));
    assert_eq!(fixtures.requests(AI_PATH).len(), 1);
}
