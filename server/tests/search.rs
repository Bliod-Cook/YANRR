mod common;

use std::collections::BTreeSet;

use common::{Fixtures, Reply, TestApp, create_inbox, deliver, json, json_feed, subscribe};
use sea_orm::{ConnectionTrait, DbBackend, Statement};
use serde_json::{Value, json};
use tempfile::TempDir;
use yanrr::{fetch, search};

const TIME: &str = "2026-10-01T08:00:00Z";

async fn queued(app: &TestApp) -> i64 {
    let sql = "SELECT count(*) AS n FROM search_queue";
    let statement = Statement::from_string(DbBackend::Postgres, sql);
    let row = app
        .state
        .db
        .query_one_raw(statement)
        .await
        .unwrap()
        .unwrap();
    row.try_get("", "n").unwrap()
}

fn item(id: &str, title: &str, body: &str) -> Value {
    json!({ "id": id, "title": title, "content_html": body, "date_published": TIME })
}

fn feed(items: Vec<Value>) -> Reply {
    Reply::Body(json_feed(json!(items)))
}

async fn search(app: &TestApp, body: Value) -> Vec<Value> {
    let found = json(app.post("/api/entries", body).await).await;
    found["data"].as_array().unwrap().clone()
}

fn titles(items: &[Value]) -> BTreeSet<&str> {
    items
        .iter()
        .map(|item| item["entries"]["title"].as_str().unwrap())
        .collect()
}

#[tokio::test]
async fn only_new_entries_are_queued_until_indexed() {
    let (app, fixtures) = (TestApp::spawn().await, Fixtures::spawn().await);
    app.sign_up("alice@example.com").await;
    fixtures.set(
        "/feed.json",
        feed(vec![item("a", "A", "A"), item("b", "B", "B")]),
    );
    let feed_id = subscribe(&app, &fixtures.url("/feed.json"), json!({})).await;
    assert_eq!(queued(&app).await, 2);

    let items = vec![
        item("a", "A", "A"),
        item("b", "B", "B"),
        item("c", "C", "C"),
    ];
    fixtures.set("/feed.json", feed(items));
    fetch::refresh_feed(&app.state, feed_id.parse().unwrap())
        .await
        .unwrap();
    assert_eq!(queued(&app).await, 3);

    search::index_pending(&app.state).await.unwrap();
    assert_eq!(queued(&app).await, 0);
}

#[tokio::test]
async fn an_inbox_delivery_is_queued_once() {
    let app = TestApp::spawn().await;
    app.sign_up("alice@example.com").await;
    let secret = create_inbox(&app, "news").await;
    let entry = json!({ "guid": "one", "publishedAt": TIME, "title": "Hello" });
    deliver(&app, &secret, entry.clone()).await;
    deliver(&app, &secret, entry).await;
    assert_eq!(queued(&app).await, 1);
}

#[tokio::test]
async fn a_search_covers_what_the_user_may_read() {
    let (app, fixtures) = (TestApp::spawn().await, Fixtures::spawn().await);
    app.sign_up("bob@example.com").await;
    fixtures.set("/bob", feed(vec![item("bob", "Rust of Bob", "")]));
    subscribe(&app, &fixtures.url("/bob"), json!({})).await;
    let secret = create_inbox(&app, "bob").await;
    let entry = json!({ "guid": "b", "publishedAt": TIME, "title": "Rust in Bob's inbox" });
    deliver(&app, &secret, entry).await;

    app.sign_up("alice@example.com").await;
    fixtures.set("/mine", feed(vec![item("mine", "Rust mine", "")]));
    let mine = subscribe(&app, &fixtures.url("/mine"), json!({})).await;
    fixtures.set("/hidden", feed(vec![item("hidden", "Rust hidden", "")]));
    subscribe(
        &app,
        &fixtures.url("/hidden"),
        json!({ "hideFromTimeline": true }),
    )
    .await;
    let secret = create_inbox(&app, "alice").await;
    let entry = json!({ "guid": "a", "publishedAt": TIME, "title": "Rust in my inbox" });
    deliver(&app, &secret, entry).await;
    // Starred, then unsubscribed from
    fixtures.set("/gone", feed(vec![item("gone", "Rust gone", "")]));
    let gone = subscribe(&app, &fixtures.url("/gone"), json!({})).await;
    let listed = json(app.post("/api/entries", json!({ "feedId": gone })).await).await;
    let starred = listed["data"][0]["entries"]["id"].clone();
    app.post("/api/collections", json!({ "entryId": starred }))
        .await;
    app.delete("/api/subscriptions", json!({ "feedIdList": [gone] }))
        .await;
    // Blocked on arrival
    let block = json!([[{ "field": "entry_title", "operator": "eq", "value": "Rust blocked" }]]);
    let rules = json!([{ "name": "Block", "condition": block, "result": { "block": true } }]);
    app.put("/api/actions", json!({ "rules": rules })).await;
    let items = vec![
        item("mine", "Rust mine", ""),
        item("blocked", "Rust blocked", ""),
    ];
    fixtures.set("/mine", feed(items));
    fetch::refresh_feed(&app.state, mine.parse().unwrap())
        .await
        .unwrap();

    search::index_pending(&app.state).await.unwrap();
    let found = search(&app, json!({ "keyword": "rust" })).await;
    assert_eq!(
        titles(&found),
        BTreeSet::from(["Rust hidden", "Rust in my inbox", "Rust mine"])
    );
}

#[tokio::test]
async fn terms_are_anded_across_fields_into_timeline_items() {
    let (app, fixtures) = (TestApp::spawn().await, Fixtures::spawn().await);
    app.sign_up("alice@example.com").await;
    fixtures.set(
        "/feed",
        feed(vec![item(
            "news",
            "Rust news",
            "<p>今天量子<b>计算</b></p>",
        )]),
    );
    subscribe(&app, &fixtures.url("/feed"), json!({})).await;
    search::index_pending(&app.state).await.unwrap();

    let found = search(&app, json!({ "keyword": "rust 量子计算" })).await;
    let timeline = json(app.post("/api/entries", json!({})).await).await;
    assert_eq!(found, timeline["data"].as_array().unwrap().clone());
    assert!(
        search(&app, json!({ "keyword": "rust 计量" }))
            .await
            .is_empty()
    );
    assert!(search(&app, json!({ "keyword": "，。" })).await.is_empty());
}

#[tokio::test]
async fn pages_of_entries_published_at_once_neither_repeat_nor_skip() {
    let (app, fixtures) = (TestApp::spawn().await, Fixtures::spawn().await);
    app.sign_up("alice@example.com").await;
    let mut items: Vec<_> = (0..45)
        .map(|i| item(&format!("{i}"), &format!("Rust {i}"), ""))
        .collect();
    items.push(item("go", "Go", ""));
    fixtures.set("/feed", feed(items));
    subscribe(&app, &fixtures.url("/feed"), json!({})).await;
    search::index_pending(&app.state).await.unwrap();

    let mut body = json!({ "keyword": "rust", "limit": 20 });
    let mut ids = Vec::new();
    for size in [20, 20, 5] {
        let page = search(&app, body.clone()).await;
        assert_eq!(page.len(), size);
        let last = &page[size - 1]["entries"];
        body["publishedAfter"] = last["publishedAt"].clone();
        body["cursorId"] = last["id"].clone();
        ids.extend(page.iter().map(|item| {
            item["entries"]["id"]
                .as_str()
                .unwrap()
                .parse::<i64>()
                .unwrap()
        }));
    }
    let mut newest_first = ids.clone();
    newest_first.sort_unstable_by(|a, b| b.cmp(a));
    newest_first.dedup();
    assert_eq!(ids, newest_first);
    assert_eq!(ids.len(), 45);
}

#[tokio::test]
async fn a_new_index_is_built_from_the_stored_entries() {
    let (app, fixtures) = (TestApp::spawn().await, Fixtures::spawn().await);
    app.sign_up("alice@example.com").await;
    fixtures.set("/feed", feed(vec![item("one", "Rust one", "")]));
    subscribe(&app, &fixtures.url("/feed"), json!({})).await;

    let dir = TempDir::new().unwrap();
    for older in ["v0", "v0.building", "notes"] {
        std::fs::create_dir(dir.path().join(older)).unwrap();
    }
    let rebuilt = search::Search::open(dir.path(), &app.state.db)
        .await
        .unwrap();
    // Indexes of other formats go; what isn't an index stays.
    assert!(!dir.path().join("v0").exists());
    assert!(!dir.path().join("v0.building").exists());
    assert!(dir.path().join("notes").exists());
    let found = search::find(
        &app.state.db,
        &rebuilt,
        &app.user_id().await,
        "rust",
        None,
        20,
    )
    .await
    .unwrap();
    assert_eq!(found.len(), 1);
}
