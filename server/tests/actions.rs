mod common;

use std::time::Duration;

use common::{
    FCM_SEND_PATH, Fixtures, Recorded, Reply, SINGLE_ITEM_RSS, TWO_ITEM_RSS, TestApp, assert_error,
    fake_fcm, json, json_feed, subscribe,
};
use sea_orm::{ConnectionTrait, DbBackend, Statement};
use serde_json::{Value, json};
use yanrr::fetch;

#[tokio::test]
async fn rules_round_trip_and_conflict() {
    let app = TestApp::spawn().await;
    app.sign_up("alice@example.com").await;
    assert_eq!(
        json(app.get("/api/actions").await).await["data"],
        Value::Null
    );

    // Older clients wrote a single group flat, and the editor sends its `index` along.
    let flat = json!({
        "name": "Star news",
        "index": 0,
        "condition": [{ "field": "entry_title", "operator": "contains", "value": "news" }],
        "result": { "star": true, "disabled": false },
    });
    let rules = json!([{
        "name": "Star news",
        "condition": [[{ "field": "entry_title", "operator": "contains", "value": "news" }]],
        "result": { "star": true, "disabled": false },
    }]);
    let first = json!({ "rules": [flat], "expectedUpdatedAt": null });
    let saved = json(app.put("/api/actions", first).await).await;
    assert!(saved["lastSyncId"].is_i64());
    let stored = json(app.get("/api/actions").await).await["data"].clone();
    assert_eq!(stored["rules"], rules);
    assert_eq!(stored["updatedAt"], saved["updatedAt"]);
    assert_eq!(stored["userId"], app.user_id().await);

    for stale in [Value::Null, json!("2026-01-01T00:00:00.000Z")] {
        let body = json!({ "rules": [], "expectedUpdatedAt": stale });
        assert_error(app.put("/api/actions", body).await, 409, 12001).await;
    }
    let body = json!({ "rules": [], "expectedUpdatedAt": saved["updatedAt"] });
    let cleared = json(app.put("/api/actions", body).await).await;
    let overwritten = json(app.put("/api/actions", json!({ "rules": rules })).await).await;
    assert_eq!(
        json(app.get("/api/actions").await).await["data"]["rules"],
        rules
    );

    let logged: Vec<_> = app
        .actions()
        .await
        .into_iter()
        .filter(|action| action["model"] == "action")
        .map(|action| {
            (
                action["action"].clone(),
                action["modelId"].clone(),
                action["data"].clone(),
            )
        })
        .collect();
    let updated = |rules: &Value, saved: &Value| {
        let data = json!({ "rules": rules, "updatedAt": saved["updatedAt"] });
        (json!("U"), Value::Null, data)
    };
    assert_eq!(
        logged,
        [
            updated(&rules, &saved),
            updated(&json!([]), &cleared),
            updated(&rules, &overwritten),
        ]
    );
}

#[tokio::test]
async fn invalid_rules_are_refused() {
    let app = TestApp::spawn().await;
    app.sign_up("alice@example.com").await;
    let regex = |pattern: &str| {
        json!({
            "name": "Match",
            "condition": [[{ "field": "entry_title", "operator": "regex", "value": pattern }]],
            "result": { "star": true },
        })
    };
    let refused = async |rules: Value, path: &str| {
        let response = app.put("/api/actions", json!({ "rules": rules })).await;
        assert_eq!(response.status(), 422);
        let body = json(response).await;
        assert_eq!(body["code"], 3);
        let message = body["message"].as_str().unwrap().to_string();
        assert!(message.starts_with(path), "{message}");
    };

    let webhook = json!({ "name": "Forward", "condition": [], "result": { "webhooks": ["ftp://example.com"] } });
    refused(json!([webhook]), "`rules.0.result.webhooks.0`: Invalid URL").await;
    refused(
        json!([regex("ok"), regex("(")]),
        "`rules.1.condition.0.0.value`: Invalid regex",
    )
    .await;

    // A pattern stored before is not checked again, so it does not keep other edits from being saved.
    let stored = json!([regex("(")]);
    let sql = "INSERT INTO action_rules VALUES ($1, $2, now(), now())";
    let values = [app.user_id().await.into(), stored.into()];
    let statement = Statement::from_sql_and_values(DbBackend::Postgres, sql, values);
    app.state.db.execute_raw(statement).await.unwrap();
    let saved = app
        .put(
            "/api/actions",
            json!({ "rules": [regex("("), regex("ok")] }),
        )
        .await;
    assert_eq!(saved.status(), 200);
}

async fn timeline(app: &TestApp, query: Value) -> Vec<Value> {
    json(app.post("/api/entries", query).await).await["data"]
        .as_array()
        .unwrap()
        .clone()
}

fn titles(items: &[Value]) -> Vec<&str> {
    let mut titles: Vec<_> = items
        .iter()
        .map(|item| item["entries"]["title"].as_str().unwrap())
        .collect();
    titles.sort();
    titles
}

fn title_is(title: &str) -> Value {
    json!([[{ "field": "entry_title", "operator": "eq", "value": title }]])
}

async fn unread_count(app: &TestApp) -> Value {
    json(app.get("/api/reads/total-count").await).await["data"]["count"].clone()
}

/// [`SINGLE_ITEM_RSS`] after three new posts.
const FOUR_ITEM_RSS: &str = r#"<rss version="2.0"><channel><title>Live</title>
    <item><guid>blocked</guid><title>Blocked post</title><pubDate>Fri, 02 Oct 2026 10:00:00 GMT</pubDate></item>
    <item><guid>starred</guid><title>Starred post</title><pubDate>Fri, 02 Oct 2026 09:00:00 GMT</pubDate></item>
    <item><guid>silenced</guid><title>Silenced post</title><pubDate>Fri, 02 Oct 2026 08:00:00 GMT</pubDate></item>
    <item><guid>post-0</guid><title>Earlier post</title><link>https://example.com/posts/0</link></item>
</channel></rss>"#;

#[tokio::test]
async fn new_entries_are_blocked_starred_or_silenced() {
    let (app, fixtures) = (TestApp::spawn().await, Fixtures::spawn().await);
    fixtures.set("/live", Reply::Body(SINGLE_ITEM_RSS.into()));
    app.sign_up("alice@example.com").await;
    let url = fixtures.url("/live");
    let feed_id = subscribe(&app, &url, json!({ "view": 1 })).await;
    let rules = json!([
        { "name": "Block", "condition": title_is("Blocked post"), "result": { "block": true, "star": true } },
        { "name": "Star", "condition": title_is("Starred post"), "result": { "star": true } },
        { "name": "Silence", "condition": title_is("Silenced post"), "result": { "silence": true } },
    ]);
    app.put("/api/actions", json!({ "rules": rules })).await;

    fixtures.set("/live", Reply::Body(FOUR_ITEM_RSS.into()));
    fetch::refresh_feed(&app.state, feed_id.parse().unwrap())
        .await
        .unwrap();

    let all = timeline(&app, json!({})).await;
    assert_eq!(
        titles(&all),
        ["Earlier post", "Silenced post", "Starred post"]
    );
    let silenced = all
        .iter()
        .find(|item| item["entries"]["title"] == "Silenced post")
        .unwrap();
    assert_eq!(silenced["read"], true);
    assert_eq!(unread_count(&app).await, 2);
    let starred = timeline(&app, json!({ "isCollection": true })).await;
    assert_eq!(titles(&starred), ["Starred post"]);
    let actions = app.actions().await;
    let new = actions
        .iter()
        .find(|action| action["model"] == "timeline" && action["action"] == "N")
        .unwrap();
    let counts = (&new["data"]["count"], &new["data"]["unread"]);
    assert_eq!(counts, (&json!(2), &json!(1)));
    assert_eq!(new["data"]["latestPublishedAt"], "2026-10-02T09:00:00.000Z");
    let collected = actions
        .iter()
        .find(|action| action["model"] == "collection")
        .unwrap();
    let entry_id = &starred[0]["entries"]["id"];
    assert_eq!(collected["modelId"], *entry_id);
    let created_at = &starred[0]["collections"]["createdAt"];
    let data =
        json!({ "entryId": entry_id, "feedId": feed_id, "view": 1, "createdAt": created_at });
    assert_eq!(collected["data"], data);

    // Following the feed again does not bring the blocked entry back, but the silenced one is unread again
    // like every entry read before.
    app.delete("/api/subscriptions", json!({ "feedIdList": [feed_id] }))
        .await;
    subscribe(&app, &url, json!({})).await;
    let all = timeline(&app, json!({})).await;
    assert_eq!(
        titles(&all),
        ["Earlier post", "Silenced post", "Starred post"]
    );
    assert_eq!(unread_count(&app).await, 3);
}

#[tokio::test]
async fn settings_and_rewrites_follow_current_rules() {
    let (app, fixtures) = (TestApp::spawn().await, Fixtures::spawn().await);
    let items = json!([
        {
            "id": "ad",
            "title": "Sponsored: Rust 2.0",
            "content_html": "<p>Rust 2.0 is out. Sponsored</p>",
            "date_published": "2026-10-02T09:00:00Z",
        },
        {
            "id": "other",
            "title": "Other",
            "content_html": "<p>Other</p>",
            "date_published": "2026-10-01T09:00:00Z",
        },
    ]);
    fixtures.set("/feed", Reply::Body(json_feed(items)));
    app.sign_up("alice@example.com").await;
    subscribe(&app, &fixtures.url("/feed"), json!({})).await;
    let rewrite = json!({
        "readability": true,
        "rewriteRules": [{ "from": "Sponsored: ", "to": "" }, { "from": " Sponsored", "to": "" }],
    });
    let collected = json!([[{ "field": "status", "operator": "eq", "value": "collected" }]]);
    let rules = json!([
        { "name": "Rewrite", "condition": title_is("sponsored: rust 2.0"), "result": rewrite },
        { "name": "Source", "condition": collected, "result": { "sourceContent": true } },
    ]);
    app.put("/api/actions", json!({ "rules": rules })).await;

    let items = timeline(&app, json!({})).await;
    let (ad, other) = (&items[0], &items[1]);
    assert_eq!(ad["entries"]["title"], "Rust 2.0");
    assert_eq!(ad["settings"], rewrite);
    assert!(other.get("settings").is_none());
    let id = ad["entries"]["id"].as_str().unwrap();
    let detail = json(app.get(&format!("/api/entries?id={id}")).await).await;
    assert_eq!(
        detail["data"]["entries"]["content"],
        "<p>Rust 2.0 is out.</p>"
    );
    assert_eq!(detail["data"]["settings"], rewrite);
    let streamed = app
        .post("/api/entries/stream", json!({ "ids": [id] }))
        .await;
    let line: Value = serde_json::from_str(streamed.text().await.unwrap().trim()).unwrap();
    assert_eq!(line["content"], "<p>Rust 2.0 is out.</p>");

    let other_id = &other["entries"]["id"];
    app.post("/api/collections", json!({ "entryId": other_id }))
        .await;
    let items = timeline(&app, json!({})).await;
    assert_eq!(items[1]["settings"], json!({ "sourceContent": true }));
}

/// Waits for `requests` to have been made.
async fn eventually(requests: impl Fn() -> Vec<Recorded>) -> Vec<Recorded> {
    for _ in 0..100 {
        let made = requests();
        if !made.is_empty() {
            return made;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    panic!("no request was made");
}

#[tokio::test]
async fn new_entries_are_forwarded() {
    let fixtures = Fixtures::spawn().await;
    let (push, _key_file) = fake_fcm(&fixtures);
    let app = TestApp::spawn_with(move |config| config.push = Some(push)).await;
    app.sign_up("alice@example.com").await;
    let device = json!({ "token": "phone-token", "channel": "ios" });
    app.post("/api/messaging", device).await;
    fixtures.set("/live", Reply::Body(SINGLE_ITEM_RSS.into()));
    fixtures.set("/hook", Reply::Status(204));
    let form = json!({ "title": "My Feed" });
    let feed_id = subscribe(&app, &fixtures.url("/live"), form).await;
    let new = json!([[{ "field": "entry_title", "operator": "contains", "value": "new" }]]);
    let result = json!({
        "webhooks": [fixtures.url("/hook")],
        "newEntryNotification": true,
        "rewriteRules": [{ "from": "New", "to": "Fresh" }],
    });
    let rules = json!([{ "name": "Forward", "condition": new, "result": result }]);
    app.put("/api/actions", json!({ "rules": rules })).await;

    fixtures.set("/live", Reply::Body(TWO_ITEM_RSS.into()));
    fetch::refresh_feed(&app.state, feed_id.parse().unwrap())
        .await
        .unwrap();

    // Webhooks go first, so they are done once the notification is out.
    let sent = eventually(|| fixtures.requests(FCM_SEND_PATH)).await;
    let hooks = fixtures.requests("/hook");
    assert_eq!((sent.len(), hooks.len()), (1, 1));
    let hook: Value = serde_json::from_str(&hooks[0].body).unwrap();
    assert_eq!(hook["entry"]["guid"], "post-new");
    assert_eq!(hook["entry"]["title"], "Fresh post");
    assert_eq!(hook["entry"]["feedId"], feed_id);
    assert_eq!(hook["feed"]["id"], feed_id);
    assert_eq!(hook["view"], 0);
    let message: Value = serde_json::from_str(&sent[0].body).unwrap();
    assert_eq!(message["message"]["token"], "phone-token");
    let data = json!({
        "type": "new-entry",
        "feedId": feed_id,
        "entryId": hook["entry"]["id"],
        "view": "0",
        "title": "My Feed",
        "description": "Fresh post",
    });
    assert_eq!(message["message"]["data"], data);
}

#[tokio::test]
async fn starred_entries_are_forwarded() {
    let (app, fixtures) = (TestApp::spawn().await, Fixtures::spawn().await);
    app.sign_up("alice@example.com").await;
    fixtures.set("/live", Reply::Body(SINGLE_ITEM_RSS.into()));
    fixtures.set("/all", Reply::Status(204));
    fixtures.set("/starred", Reply::Status(204));
    subscribe(&app, &fixtures.url("/live"), json!({})).await;
    let starred = json!([[{ "field": "status", "operator": "eq", "value": "collected" }]]);
    // The rule matching without the star goes first, so had it been sent, it would be by the time the other is.
    let rules = json!([
        {
            "name": "All",
            "condition": [],
            "result": {
                "webhooks": [fixtures.url("/all")],
                "rewriteRules": [{ "from": "Earlier", "to": "Older" }],
            },
        },
        { "name": "Starred", "condition": starred, "result": { "webhooks": [fixtures.url("/starred")] } },
    ]);
    app.put("/api/actions", json!({ "rules": rules })).await;
    let entry_id = timeline(&app, json!({})).await[0]["entries"]["id"].clone();

    app.post(
        "/api/collections",
        json!({ "entryId": entry_id, "view": 0 }),
    )
    .await;

    let hooks = eventually(|| fixtures.requests("/starred")).await;
    assert!(fixtures.requests("/all").is_empty());
    let hook: Value = serde_json::from_str(&hooks[0].body).unwrap();
    assert_eq!(hook["entry"]["id"], entry_id);
    assert_eq!(hook["entry"]["title"], "Older post");
}
