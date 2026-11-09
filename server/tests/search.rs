mod common;

use common::{Fixtures, Reply, TestApp, create_inbox, deliver, json_feed, subscribe};
use sea_orm::{ConnectionTrait, DbBackend, Statement};
use serde_json::{Value, json};
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
