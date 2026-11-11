mod common;

use std::time::Duration;

use common::{Fixtures, Reply, TestApp, assert_error, json, json_feed, subscribe};
use serde_json::{Value, json};

async fn timeline(app: &TestApp, query: Value) -> Vec<Value> {
    let listed = json(app.post("/api/entries", query).await).await;
    listed["data"].as_array().unwrap().clone()
}

#[tokio::test]
async fn collect_and_uncollect() {
    let (app, fixtures) = (TestApp::spawn().await, Fixtures::spawn().await);
    app.sign_up("alice@example.com").await;
    let feed_id = subscribe(&app, &fixtures.url("/rss"), json!({})).await;
    let entry_id = timeline(&app, json!({})).await[0]["entries"]["id"].clone();

    // Collected in another view than the feed's.
    let collect = json!({ "entryId": entry_id, "view": 1 });
    let collected = json(app.post("/api/collections", collect.clone()).await).await;
    let again = json(app.post("/api/collections", collect).await).await;
    assert_eq!(again["lastSyncId"], collected["lastSyncId"]);

    let starred = timeline(&app, json!({ "isCollection": true, "view": 1 })).await;
    assert_eq!(starred.len(), 1);
    assert_eq!(starred[0]["entries"]["id"], entry_id);
    let created_at = starred[0]["collections"]["createdAt"].clone();
    assert!(created_at.is_string());
    let all = timeline(&app, json!({})).await;
    let marked: Vec<_> = all
        .iter()
        .map(|item| item.get("collections").is_some())
        .collect();
    assert_eq!(marked, [true, false]);
    assert_eq!(all[0]["view"], 0);
    let collection = json!({ "createdAt": created_at, "view": 1 });
    assert_eq!(all[0]["collections"], collection);

    app.delete("/api/collections", json!({ "entryId": entry_id }))
        .await;
    assert_eq!(
        timeline(&app, json!({ "isCollection": true })).await,
        Vec::<Value>::new()
    );

    let logged: Vec<_> = app
        .actions()
        .await
        .into_iter()
        .filter(|action| action["model"] == "collection")
        .map(|action| {
            (
                action["action"].clone(),
                action["modelId"].clone(),
                action["data"].clone(),
            )
        })
        .collect();
    let inserted =
        json!({ "entryId": entry_id, "feedId": feed_id, "view": 1, "createdAt": created_at });
    assert_eq!(
        logged,
        [
            (json!("I"), entry_id.clone(), inserted),
            (json!("D"), entry_id, Value::Null),
        ]
    );
    let unknown = app
        .post("/api/collections", json!({ "entryId": "1" }))
        .await;
    assert_error(unknown, 404, 3000).await;
}

#[tokio::test]
async fn the_collection_pages_by_when_entries_were_collected() {
    let (app, fixtures) = (TestApp::spawn().await, Fixtures::spawn().await);
    app.sign_up("alice@example.com").await;
    let items = json!([
        { "id": "a", "title": "A", "date_published": "2026-10-03T08:00:00Z" },
        { "id": "b", "title": "B", "date_published": "2026-10-02T08:00:00Z" },
        { "id": "c", "title": "C", "date_published": "2026-10-01T08:00:00Z" },
    ]);
    fixtures.set("/feed.json", Reply::Body(json_feed(items)));
    subscribe(&app, &fixtures.url("/feed.json"), json!({})).await;
    let listed = timeline(&app, json!({})).await;
    let id = |title: &str| {
        let item = listed.iter().find(|item| item["entries"]["title"] == title);
        item.unwrap()["entries"]["id"].clone()
    };
    for title in ["B", "A", "C"] {
        app.post("/api/collections", json!({ "entryId": id(title) }))
            .await;
        // Each a millisecond apart at least, the precision of the times
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    let titles = |items: &[Value]| -> Vec<Value> {
        items
            .iter()
            .map(|item| item["entries"]["title"].clone())
            .collect()
    };

    let first = timeline(&app, json!({ "isCollection": true, "limit": 2 })).await;
    assert_eq!(titles(&first), ["C", "A"]);
    let last = &first[1];
    let next = json!({
        "isCollection": true,
        "limit": 2,
        "publishedAfter": last["collections"]["createdAt"],
        "cursorId": last["entries"]["id"],
    });
    assert_eq!(titles(&timeline(&app, next).await), ["B"]);
}
