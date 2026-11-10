mod common;

use std::collections::BTreeSet;

use common::{Fixtures, Reply, TestApp, create_inbox, deliver, json, json_feed, subscribe};
use sea_orm::{ConnectionTrait, DbBackend, Statement};
use serde_json::{Value, json};
use tempfile::TempDir;
use yanrr::{api::entries::Scope, fetch, search};

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

/// Feeds of [`readers`].
struct Readers {
    bob: String,
    mine: String,
    hidden: String,
}

/// Bob with a feed and an inbox, then Alice, signed in, with a feed, one hidden from her timeline, an inbox, an
/// entry starred of a feed she left and one her rules block; every entry is about Rust, and indexed.
async fn readers(app: &TestApp, fixtures: &Fixtures) -> Readers {
    app.sign_up("bob@example.com").await;
    fixtures.set("/bob", feed(vec![item("bob", "Rust of Bob", "")]));
    let bob = subscribe(app, &fixtures.url("/bob"), json!({})).await;
    let secret = create_inbox(app, "bob").await;
    let entry = json!({ "guid": "b", "publishedAt": TIME, "title": "Rust in Bob's inbox" });
    deliver(app, &secret, entry).await;

    app.sign_up("alice@example.com").await;
    fixtures.set("/mine", feed(vec![item("mine", "Rust mine", "")]));
    let mine = subscribe(app, &fixtures.url("/mine"), json!({})).await;
    fixtures.set("/hidden", feed(vec![item("hidden", "Rust hidden", "")]));
    let hidden = subscribe(
        app,
        &fixtures.url("/hidden"),
        json!({ "hideFromTimeline": true }),
    )
    .await;
    let secret = create_inbox(app, "alice").await;
    let entry = json!({ "guid": "a", "publishedAt": TIME, "title": "Rust in my inbox" });
    deliver(app, &secret, entry).await;
    // Starred, then unsubscribed from
    fixtures.set("/gone", feed(vec![item("gone", "Rust gone", "")]));
    let gone = subscribe(app, &fixtures.url("/gone"), json!({})).await;
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
    Readers { bob, mine, hidden }
}

#[tokio::test]
async fn a_search_covers_what_the_user_may_read() {
    let (app, fixtures) = (TestApp::spawn().await, Fixtures::spawn().await);
    readers(&app, &fixtures).await;
    let found = search(&app, json!({ "keyword": "rust" })).await;
    assert_eq!(
        titles(&found),
        BTreeSet::from(["Rust hidden", "Rust in my inbox", "Rust mine"])
    );
}

#[tokio::test]
async fn a_scoped_search_finds_what_its_timeline_lists() {
    let (app, fixtures) = (TestApp::spawn().await, Fixtures::spawn().await);
    let Readers { bob, mine, hidden } = readers(&app, &fixtures).await;
    let scopes = [
        json!({ "view": 0 }),
        json!({ "feedId": hidden }),
        json!({ "feedId": bob }),
        json!({ "feedIdList": [mine, hidden] }),
        json!({ "isCollection": true }),
        json!({ "inboxId": "alice" }),
        json!({ "inboxId": "bob" }),
    ];
    for scope in scopes {
        // Without a keyword, the timeline
        let listed = search(&app, scope.clone()).await;
        assert_eq!(listed.is_empty(), scope["inboxId"] == "bob", "{scope}");
        let mut body = scope.clone();
        body["keyword"] = json!("rust");
        let found = search(&app, body).await;
        assert_eq!(titles(&found), titles(&listed), "{scope}");
    }
}

#[tokio::test]
async fn terms_are_anded_across_fields_into_timeline_items_showing_where() {
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

    let mut found = search(&app, json!({ "keyword": "rust 量子计算" })).await;
    let highlight = found[0].as_object_mut().unwrap().remove("highlight");
    let pieces = json!({ "title": ["", "Rust", " news"], "snippet": ["今天", "量子计算", ""] });
    assert_eq!(highlight, Some(pieces));
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
async fn entries_with_the_terms_in_their_title_come_first_across_pages() {
    let (app, fixtures) = (TestApp::spawn().await, Fixtures::spawn().await);
    app.sign_up("alice@example.com").await;
    let dated = |id: String, title: String, body: &str, day: u32| {
        let published = format!("2026-10-{day:02}T08:00:00Z");
        json!({ "id": id, "title": title, "content_html": body, "date_published": published })
    };
    // Newest first, as feeds list them: the entries with the term in their body alone are the newer ones.
    let mut items: Vec<_> = (0..25)
        .map(|i| dated(format!("body{i}"), format!("Notes {i}"), "on rust", 28))
        .collect();
    items.extend((0..5).map(|i| dated(format!("title{i}"), format!("Rust {i}"), "", 1)));
    fixtures.set("/feed", feed(items));
    subscribe(&app, &fixtures.url("/feed"), json!({})).await;
    search::index_pending(&app.state).await.unwrap();

    let first = search(&app, json!({ "keyword": "rust", "limit": 20 })).await;
    let title = |item: &Value| item["entries"]["title"].as_str().unwrap().to_owned();
    let starts: Vec<_> = first
        .iter()
        .map(|item| title(item)[..4].to_owned())
        .collect();
    assert_eq!(
        starts[..6],
        ["Rust", "Rust", "Rust", "Rust", "Rust", "Note"]
    );
    assert_eq!(first[0]["highlight"]["snippet"], Value::Null);
    let last = &first[19]["entries"];
    let body = json!({
        "keyword": "rust",
        "limit": 20,
        "publishedAfter": last["publishedAt"],
        "cursorId": last["id"],
    });
    let rest = search(&app, body).await;
    assert_eq!(rest.len(), 10);
    let all: BTreeSet<_> = first.iter().chain(&rest).map(title).collect();
    assert_eq!(all.len(), 30);
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
        &Scope::default(),
        None,
        20,
    )
    .await
    .unwrap();
    assert_eq!(found.len(), 1);
}
