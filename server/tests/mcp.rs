mod common;

use common::{Fixtures, PASSWORD, Reply, TestApp, assert_error, json, json_feed, subscribe};
use reqwest::{Response, header};
use sea_orm::{ConnectionTrait, DbBackend, Statement};
use serde_json::{Value, json};
use yanrr::{fetch, search};

const ALL_SCOPES: [&str; 3] = ["feeds:read", "entries:read", "history:read"];

async fn enabled() -> TestApp {
    TestApp::spawn_with(|config| config.mcp.enabled = true).await
}

/// Issues a token with `scopes` to the signed-in user.
async fn issue(app: &TestApp, scopes: &[&str]) -> String {
    let body = json!({ "name": "Agent", "scopes": scopes });
    let issued = json(app.post("/api/mcp/tokens", body).await).await;
    issued["data"]["token"].as_str().unwrap().to_string()
}

/// A JSON-RPC request to the MCP endpoint as a client without cookies sends it.
async fn rpc(app: &TestApp, token: Option<&str>, method: &str, params: Value) -> Response {
    let mut request = reqwest::Client::new()
        .post(format!("{}/api/mcp", app.url))
        .header(header::ACCEPT, "application/json, text/event-stream")
        .header("MCP-Protocol-Version", "2025-11-25")
        .json(&json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params }));
    if let Some(token) = token {
        request = request.bearer_auth(token);
    }
    request.send().await.unwrap()
}

async fn tool_names(app: &TestApp, token: &str) -> Vec<String> {
    let listed = json(rpc(app, Some(token), "tools/list", json!({})).await).await;
    let tools = listed["result"]["tools"].as_array().unwrap();
    tools
        .iter()
        .map(|tool| tool["name"].as_str().unwrap().to_string())
        .collect()
}

/// The result of calling `tool`, which holds `isError` and `structuredContent`.
async fn call(app: &TestApp, token: &str, tool: &str, arguments: Value) -> Value {
    let params = json!({ "name": tool, "arguments": arguments });
    let response = json(rpc(app, Some(token), "tools/call", params).await).await;
    response["result"].clone()
}

/// The structured content of a successful call.
async fn content(app: &TestApp, token: &str, tool: &str, arguments: Value) -> Value {
    let result = call(app, token, tool, arguments).await;
    assert_ne!(result["isError"], true, "{result}");
    result["structuredContent"].clone()
}

fn titles(listed: &Value) -> Vec<&str> {
    listed["entries"]
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| entry["title"].as_str().unwrap())
        .collect()
}

fn item(id: &str, title: &str, html: &str, published: &str) -> Value {
    json!({ "id": id, "title": title, "content_html": html, "date_published": published })
}

fn feed(items: Vec<Value>) -> Reply {
    Reply::Body(json_feed(json!(items)))
}

async fn sign_in(app: &TestApp, email: &str) {
    let credentials = json!({ "email": email, "password": PASSWORD });
    let res = app
        .post("/api/better-auth/sign-in/email", credentials)
        .await;
    assert_eq!(res.status(), 200);
}

/// The id of the entry titled `title` on the signed-in user's timeline.
async fn entry_id(app: &TestApp, title: &str) -> String {
    let timeline = json(app.post("/api/entries", json!({})).await).await;
    let items = timeline["data"].as_array().unwrap();
    let item = items
        .iter()
        .find(|item| item["entries"]["title"] == title)
        .unwrap();
    item["entries"]["id"].as_str().unwrap().to_string()
}

/// The id of the stored entry titled `title`, whoever may see it.
async fn stored_id(app: &TestApp, title: &str) -> String {
    let sql = "SELECT id FROM entries WHERE title = $1";
    let statement = Statement::from_sql_and_values(DbBackend::Postgres, sql, [title.into()]);
    let row = app
        .state
        .db
        .query_one_raw(statement)
        .await
        .unwrap()
        .unwrap();
    row.try_get::<i64>("", "id").unwrap().to_string()
}

#[tokio::test]
async fn mcp_is_off_unless_enabled() {
    let app = TestApp::spawn().await;
    app.sign_up("alice@example.com").await;

    let body = json!({ "name": "Agent", "scopes": ["feeds:read"] });
    assert_error(app.post("/api/mcp/tokens", body).await, 403, 5).await;
    let opened = app
        .post("/api/reading-history", json!({ "entryId": "1" }))
        .await;
    assert_error(opened, 403, 5).await;
    assert_eq!(
        rpc(&app, Some("yanrr_x"), "tools/list", json!({}))
            .await
            .status(),
        404
    );
}

#[tokio::test]
async fn tokens_are_shown_once_and_revoked_by_their_owner() {
    let app = enabled().await;
    app.sign_up("alice@example.com").await;
    let body = json!({ "name": "Claude", "scopes": ["feeds:read", "feeds:read"] });
    let issued = json(app.post("/api/mcp/tokens", body).await).await["data"].clone();
    let token = issued["token"].as_str().unwrap();
    assert!(token.starts_with("yanrr_"));
    assert_eq!(issued["name"], "Claude");
    assert_eq!(issued["scopes"], json!(["feeds:read"]));

    let listed = json(app.get("/api/mcp/tokens").await).await["data"].clone();
    assert_eq!(listed.as_array().unwrap().len(), 1);
    assert!(listed[0].get("token").is_none());
    assert_eq!(listed[0]["id"], issued["id"]);
    assert_eq!(listed[0]["lastUsedAt"], Value::Null);
    assert_eq!(
        rpc(&app, Some(token), "tools/list", json!({}))
            .await
            .status(),
        200
    );
    let listed = json(app.get("/api/mcp/tokens").await).await["data"].clone();
    assert!(listed[0]["lastUsedAt"].is_string());

    let invalid = [
        json!({ "name": " ", "scopes": ["feeds:read"] }),
        json!({ "name": "Agent", "scopes": [] }),
        json!({ "name": "Agent", "scopes": ["feeds:write"] }),
    ];
    for body in invalid {
        assert_error(app.post("/api/mcp/tokens", body).await, 400, 4).await;
    }

    // Someone else can neither see nor revoke it.
    app.sign_up("bob@example.com").await;
    let listed = json(app.get("/api/mcp/tokens").await).await["data"].clone();
    assert_eq!(listed, json!([]));
    app.delete("/api/mcp/tokens", json!({ "id": issued["id"] }))
        .await;
    assert_eq!(
        rpc(&app, Some(token), "tools/list", json!({}))
            .await
            .status(),
        200
    );

    sign_in(&app, "alice@example.com").await;
    app.delete("/api/mcp/tokens", json!({ "id": issued["id"] }))
        .await;
    assert_eq!(
        rpc(&app, Some(token), "tools/list", json!({}))
            .await
            .status(),
        401
    );
}

#[tokio::test]
async fn only_a_bearer_token_authenticates() {
    let app = enabled().await;
    app.sign_up("alice@example.com").await;
    issue(&app, &ALL_SCOPES).await;

    let missing = rpc(&app, None, "tools/list", json!({})).await;
    assert_eq!(missing.status(), 401);
    assert_eq!(missing.headers()[header::WWW_AUTHENTICATE], "Bearer");
    let wrong = rpc(&app, Some("yanrr_wrong"), "tools/list", json!({})).await;
    assert_eq!(wrong.status(), 401);
    // The session cookie of the signed-in client is not a credential here.
    let with_cookie = app
        .client
        .post(format!("{}/api/mcp", app.url))
        .header(header::ACCEPT, "application/json, text/event-stream")
        .json(&json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" }))
        .send()
        .await
        .unwrap();
    assert_eq!(with_cookie.status(), 401);
}

#[tokio::test]
async fn tools_follow_the_token_scopes() {
    let app = enabled().await;
    app.sign_up("alice@example.com").await;
    let feeds_only = issue(&app, &["feeds:read"]).await;
    let all = issue(&app, &ALL_SCOPES).await;

    let params = json!({
        "protocolVersion": "2025-11-25",
        "capabilities": {},
        "clientInfo": { "name": "test", "version": "1" },
    });
    let initialized = json(rpc(&app, Some(&all), "initialize", params).await).await;
    assert_eq!(initialized["result"]["serverInfo"]["name"], "yanrr");

    assert_eq!(tool_names(&app, &feeds_only).await, ["list_feeds"]);
    let mut names = tool_names(&app, &all).await;
    names.sort();
    let expected = [
        "get_entry",
        "list_entries",
        "list_feeds",
        "list_recent_reads",
        "search_entries",
    ];
    assert_eq!(names, expected);

    let params = json!({ "name": "list_entries", "arguments": {} });
    let denied = json(rpc(&app, Some(&feeds_only), "tools/call", params).await).await;
    assert!(
        denied["error"]["message"]
            .as_str()
            .unwrap()
            .contains("entries:read")
    );
}

#[tokio::test]
async fn feeds_are_the_users_subscriptions() {
    let (app, fixtures) = (enabled().await, Fixtures::spawn().await);
    let time = "2026-10-01T08:00:00Z";
    fixtures.set(
        "/tech",
        feed(vec![item("a", "A", "A", time), item("b", "B", "B", time)]),
    );
    fixtures.set("/quiet", feed(vec![item("c", "C", "C", time)]));
    fixtures.set("/other", feed(vec![item("d", "D", "D", time)]));
    app.sign_up("alice@example.com").await;
    let form = json!({ "category": "Tech", "title": "Alias", "view": 1 });
    let tech = subscribe(&app, &fixtures.url("/tech?key=secret"), form).await;
    let form = json!({ "hideFromTimeline": true });
    let quiet = subscribe(&app, &fixtures.url("/quiet"), form).await;
    let read = entry_id(&app, "A").await;
    app.post("/api/reads", json!({ "entryIds": [read] })).await;
    let token = issue(&app, &["feeds:read"]).await;
    app.sign_up("bob@example.com").await;
    subscribe(&app, &fixtures.url("/other"), json!({})).await;

    let listed = content(&app, &token, "list_feeds", json!({})).await;

    let expected = json!([
        {
            "id": tech,
            "title": "Alias",
            "category": "Tech",
            "view": "social",
            "siteUrl": null,
            "unread": 1,
            "hiddenFromTimeline": false,
            "error": null,
        },
        {
            "id": quiet,
            "title": "Generated",
            "category": null,
            "view": "articles",
            "siteUrl": null,
            "unread": 1,
            "hiddenFromTimeline": true,
            "error": null,
        },
    ]);
    assert_eq!(listed["feeds"], expected);
}

#[tokio::test]
async fn entries_page_through_what_the_user_follows() {
    let (app, fixtures) = (enabled().await, Fixtures::spawn().await);
    let items = vec![
        item("a1", "A1", "<p>First</p>", "2026-10-01T08:00:00Z"),
        item("a2", "A2", "<p>Second</p>", "2026-10-02T08:00:00Z"),
        item("a3", "A3", "<p>Third</p>", "2026-10-03T08:00:00Z"),
    ];
    fixtures.set("/a", feed(items));
    fixtures.set(
        "/b",
        feed(vec![item("b1", "B1", "B", "2026-10-02T09:00:00Z")]),
    );
    fixtures.set(
        "/hidden",
        feed(vec![item("h1", "H1", "H", "2026-10-04T08:00:00Z")]),
    );
    fixtures.set(
        "/elsewhere",
        feed(vec![item("e1", "E1", "E", "2026-10-04T08:00:00Z")]),
    );
    app.sign_up("alice@example.com").await;
    let a = subscribe(&app, &fixtures.url("/a"), json!({})).await;
    subscribe(&app, &fixtures.url("/b"), json!({})).await;
    let hidden = subscribe(
        &app,
        &fixtures.url("/hidden"),
        json!({ "hideFromTimeline": true }),
    )
    .await;
    let elsewhere = subscribe(&app, &fixtures.url("/elsewhere"), json!({})).await;
    let starred = entry_id(&app, "A1").await;
    app.post("/api/collections", json!({ "entryId": starred }))
        .await;
    let read = entry_id(&app, "A2").await;
    app.post("/api/reads", json!({ "entryIds": [read] })).await;
    let gone = entry_id(&app, "E1").await;
    app.post("/api/collections", json!({ "entryId": gone }))
        .await;
    app.delete("/api/subscriptions", json!({ "feedIdList": [elsewhere] }))
        .await;
    let token = issue(&app, &["entries:read"]).await;

    let first = content(&app, &token, "list_entries", json!({ "limit": 3 })).await;
    assert_eq!(titles(&first), ["A3", "B1", "A2"]);
    let entry = &first["entries"][0];
    assert_eq!(entry["feedId"], a);
    assert_eq!(entry["feedTitle"], "Generated");
    assert_eq!(entry["excerpt"], "Third");
    assert_eq!(entry["read"], false);
    assert_eq!(entry["starred"], false);
    assert_eq!(entry["publishedAt"], "2026-10-03T08:00:00.000Z");
    let cursor = first["nextCursor"].clone();
    let second = content(
        &app,
        &token,
        "list_entries",
        json!({ "limit": 3, "cursor": cursor }),
    )
    .await;
    assert_eq!(titles(&second), ["A1"]);
    assert_eq!(second["nextCursor"], Value::Null);

    let only = |arguments: Value| content(&app, &token, "list_entries", arguments);
    assert_eq!(titles(&only(json!({ "feedId": hidden })).await), ["H1"]);
    assert_eq!(
        titles(&only(json!({ "feedId": a, "unreadOnly": true })).await),
        ["A3", "A1"]
    );
    // Starred entries stay with the user after they unfollow the feed.
    let starred = only(json!({ "starredOnly": true })).await;
    assert_eq!(titles(&starred), ["E1", "A1"]);
    assert_eq!(starred["entries"][1]["starred"], true);

    let unfollowed = call(&app, &token, "list_entries", json!({ "feedId": elsewhere })).await;
    assert_eq!(unfollowed["isError"], true);
    let invalid = call(
        &app,
        &token,
        "list_entries",
        json!({ "cursor": "nonsense" }),
    )
    .await;
    assert_eq!(invalid["isError"], true);
}

#[tokio::test]
async fn an_entry_reads_as_text_in_pieces() {
    let (app, fixtures) = (enabled().await, Fixtures::spawn().await);
    let long = format!("<p>{}</p>", "字".repeat(25_000));
    let items = vec![
        item(
            "short",
            "Short",
            "<p>First  paragraph</p><p>Second</p>",
            "2026-10-02T08:00:00Z",
        ),
        item("long", "Long", &long, "2026-10-01T08:00:00Z"),
    ];
    fixtures.set("/feed", feed(items));
    app.sign_up("alice@example.com").await;
    let feed_id = subscribe(&app, &fixtures.url("/feed"), json!({})).await;
    let (short, long) = (entry_id(&app, "Short").await, entry_id(&app, "Long").await);
    let token = issue(&app, &["entries:read"]).await;

    let read = content(&app, &token, "get_entry", json!({ "id": short })).await;
    assert_eq!(read["title"], "Short");
    assert_eq!(read["content"], "First paragraph\nSecond");
    assert_eq!(read["nextOffset"], Value::Null);

    let first = content(&app, &token, "get_entry", json!({ "id": long })).await;
    assert_eq!(first["content"].as_str().unwrap().chars().count(), 10_000);
    assert_eq!(first["nextOffset"], 10_000);
    let last = content(
        &app,
        &token,
        "get_entry",
        json!({ "id": long, "offset": 20_000 }),
    )
    .await;
    assert_eq!(last["content"].as_str().unwrap().chars().count(), 5_000);
    assert_eq!(last["nextOffset"], Value::Null);

    app.delete("/api/subscriptions", json!({ "feedIdList": [feed_id] }))
        .await;
    let unfollowed = call(&app, &token, "get_entry", json!({ "id": short })).await;
    assert_eq!(unfollowed["isError"], true);
}

#[tokio::test]
async fn rules_shape_what_tools_show() {
    let (app, fixtures) = (enabled().await, Fixtures::spawn().await);
    let ad = item(
        "ad",
        "Sponsored: Rust",
        "<p>Rust</p>",
        "2026-10-02T08:00:00Z",
    );
    fixtures.set("/feed", feed(vec![ad.clone()]));
    app.sign_up("alice@example.com").await;
    let feed_id = subscribe(&app, &fixtures.url("/feed"), json!({})).await;
    let title_is =
        |title: &str| json!([[{ "field": "entry_title", "operator": "eq", "value": title }]]);
    let rules = json!([
        { "name": "Rewrite", "condition": [], "result": { "rewriteRules": [{ "from": "Sponsored: ", "to": "" }] } },
        { "name": "Block", "condition": title_is("Blocked post"), "result": { "block": true } },
    ]);
    app.put("/api/actions", json!({ "rules": rules })).await;
    // Rules block entries as they arrive.
    let blocked = item(
        "blocked",
        "Blocked post",
        "<p>Hidden</p>",
        "2026-10-01T08:00:00Z",
    );
    fixtures.set("/feed", feed(vec![ad, blocked]));
    fetch::refresh_feed(&app.state, feed_id.parse().unwrap())
        .await
        .unwrap();
    let token = issue(&app, &["entries:read"]).await;

    let listed = content(&app, &token, "list_entries", json!({})).await;
    assert_eq!(titles(&listed), ["Rust"]);
    let blocked = stored_id(&app, "Blocked post").await;
    let hidden = call(&app, &token, "get_entry", json!({ "id": blocked })).await;
    assert_eq!(hidden["isError"], true);
}

#[tokio::test]
async fn search_pages_through_followed_entries() {
    let (app, fixtures) = (enabled().await, Fixtures::spawn().await);
    let items = vec![
        item("one", "Rust one", "<p>Body</p>", "2026-10-02T08:00:00Z"),
        item("two", "Rust two", "<p>Body</p>", "2026-10-01T08:00:00Z"),
        item(
            "three",
            "Go three",
            "<p>Mentions Rust deep inside</p>",
            "2026-10-03T08:00:00Z",
        ),
        item("four", "Go four", "<p>Body</p>", "2026-10-03T08:00:00Z"),
    ];
    fixtures.set("/feed", feed(items));
    app.sign_up("alice@example.com").await;
    let feed_id = subscribe(&app, &fixtures.url("/feed"), json!({})).await;
    search::index_pending(&app.state).await.unwrap();
    let token = issue(&app, &["entries:read"]).await;
    let search = |arguments: Value| content(&app, &token, "search_entries", arguments);

    let first = search(json!({ "query": "rust", "limit": 2 })).await;
    assert_eq!(titles(&first), ["Rust one", "Rust two"]);
    let cursor = first["nextCursor"].clone();
    let second = search(json!({ "query": "rust", "limit": 2, "cursor": cursor })).await;
    assert_eq!(titles(&second), ["Go three"]);
    assert!(
        second["entries"][0]["snippet"]
            .as_str()
            .unwrap()
            .contains("Rust")
    );
    assert_eq!(second["nextCursor"], Value::Null);
    let in_feed = search(json!({ "query": "rust", "feedId": feed_id })).await;
    assert_eq!(in_feed["entries"].as_array().unwrap().len(), 3);

    app.delete("/api/subscriptions", json!({ "feedIdList": [feed_id] }))
        .await;
    let unfollowed = search(json!({ "query": "rust" })).await;
    assert_eq!(unfollowed["entries"], json!([]));
}

#[tokio::test]
async fn opened_entries_are_listed_latest_first() {
    let (app, fixtures) = (enabled().await, Fixtures::spawn().await);
    let time = "2026-10-01T08:00:00Z";
    let items = vec![
        item("a", "A", "A", time),
        item("b", "B", "B", time),
        item("c", "C", "C", time),
    ];
    fixtures.set("/feed", feed(items));
    app.sign_up("alice@example.com").await;
    subscribe(&app, &fixtures.url("/feed"), json!({})).await;
    let [a, b, c] = [
        entry_id(&app, "A").await,
        entry_id(&app, "B").await,
        entry_id(&app, "C").await,
    ];
    let token = issue(&app, &ALL_SCOPES).await;
    for id in [&a, &b, &a, &"1".to_string()] {
        let opened = app
            .post("/api/reading-history", json!({ "entryId": id }))
            .await;
        assert_eq!(opened.status(), 200);
    }
    // Neither marking an entry read nor an agent reading it is the user opening it.
    app.post("/api/reads", json!({ "entryIds": [c] })).await;
    content(&app, &token, "get_entry", json!({ "id": c })).await;

    let first = content(&app, &token, "list_recent_reads", json!({ "limit": 1 })).await;
    assert_eq!(titles(&first), ["A"]);
    assert!(first["entries"][0]["openedAt"].is_string());
    let cursor = first["nextCursor"].clone();
    let rest = content(
        &app,
        &token,
        "list_recent_reads",
        json!({ "cursor": cursor }),
    )
    .await;
    assert_eq!(titles(&rest), ["B"]);
    assert_eq!(rest["nextCursor"], Value::Null);

    app.sign_up("bob@example.com").await;
    let theirs = issue(&app, &ALL_SCOPES).await;
    let listed = content(&app, &theirs, "list_recent_reads", json!({})).await;
    assert_eq!(listed["entries"], json!([]));
}
