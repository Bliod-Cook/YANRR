mod common;

use common::{Fixtures, TestApp, assert_error, json, subscribe};
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
