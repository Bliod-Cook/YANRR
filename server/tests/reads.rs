mod common;

use chrono::{DateTime, Utc};
use common::{Fixtures, TestApp, create_inbox, deliver, json, subscribe};
use serde_json::{Value, json};

async fn entry_ids(app: &TestApp, feed_id: &str) -> Vec<String> {
    let listed = json(app.post("/api/entries", json!({ "feedId": feed_id })).await).await;
    let items = listed["data"].as_array().unwrap();
    items
        .iter()
        .map(|item| item["entries"]["id"].as_str().unwrap().to_string())
        .collect()
}

async fn unread(app: &TestApp, query: &str) -> Value {
    json(app.get(&format!("/api/reads{query}")).await).await
}

#[tokio::test]
async fn read_marks_flip_once() {
    let (app, fixtures) = (TestApp::spawn().await, Fixtures::spawn().await);
    app.sign_up("alice@example.com").await;
    let feed_id = subscribe(&app, &fixtures.url("/rss"), json!({})).await;
    let entry_id = entry_ids(&app, &feed_id).await.remove(0);

    let mark = json!({ "entryIds": [entry_id] });
    let marked = json(app.post("/api/reads", mark.clone()).await).await;
    let counts = unread(&app, "").await;
    assert_eq!(counts["data"], json!({ feed_id.clone(): 1 }));
    let state = json(app.get("/api/sync/state").await).await;
    assert_eq!(counts["lastSyncId"], state["data"]["lastSyncId"]);
    let again = json(app.post("/api/reads", mark).await).await;
    assert_eq!(again["lastSyncId"], marked["lastSyncId"]);

    app.delete("/api/reads", json!({ "entryId": entry_id }))
        .await;
    assert_eq!(
        unread(&app, "").await["data"],
        json!({ feed_id.clone(): 2 })
    );
    let total = json(app.get("/api/reads/total-count").await).await;
    assert_eq!(total["data"]["count"], 2);

    let timeline: Vec<_> = app
        .actions()
        .await
        .into_iter()
        .filter(|action| action["model"] == "timeline")
        .map(|action| {
            (
                action["action"].clone(),
                action["modelId"].clone(),
                action["data"].clone(),
            )
        })
        .collect();
    let flip = |read| json!({ "entryIds": [entry_id], "read": read, "isInbox": false, "feeds": { feed_id.clone(): 1 } });
    assert_eq!(
        timeline,
        [
            (json!("U"), Value::Null, flip(true)),
            (json!("U"), Value::Null, flip(false)),
        ]
    );
}

#[tokio::test]
async fn mark_all_read_respects_filters() {
    let (app, fixtures) = (TestApp::spawn().await, Fixtures::spawn().await);
    app.sign_up("alice@example.com").await;
    let articles = subscribe(&app, &fixtures.url("/rss"), json!({ "view": 0 })).await;
    let social = subscribe(&app, &fixtures.url("/etag"), json!({ "view": 1 })).await;
    let mark_all = async |body: Value| {
        let marked = json(app.post("/api/reads/all", body).await).await;
        marked["data"]["read"].clone()
    };

    assert_eq!(mark_all(json!({ "listId": "1" })).await, json!({}));
    // The fixture's posts were published on October 5 and 6.
    let october_6 = "2026-10-06T00:00:00Z".parse::<DateTime<Utc>>().unwrap();
    let range = json!({
        "view": 0,
        "startTime": october_6.timestamp_millis(),
        "endTime": Utc::now().timestamp_millis(),
    });
    assert_eq!(mark_all(range).await, json!({ articles.clone(): 1 }));
    assert_eq!(mark_all(json!({ "insertedBefore": 1000 })).await, json!({}));
    assert_eq!(mark_all(json!({ "view": 1 })).await, json!({ social: 2 }));

    assert_eq!(unread(&app, "").await["data"], json!({ articles: 1 }));
    assert_eq!(unread(&app, "?view=1").await["data"], json!({}));
}

#[tokio::test]
async fn inbox_read_marks_and_counts() {
    let (app, fixtures) = (TestApp::spawn().await, Fixtures::spawn().await);
    app.sign_up("alice@example.com").await;
    let feed_id = subscribe(&app, &fixtures.url("/rss"), json!({})).await;
    let secret = create_inbox(&app, "news").await;
    for day in 1..=2 {
        let entry = json!({ "guid": format!("g-{day}"), "publishedAt": format!("2026-10-0{day}T08:00:00Z") });
        deliver(&app, &secret, entry).await;
    }
    let listed = json(
        app.post("/api/entries/inbox", json!({ "inboxId": "news" }))
            .await,
    )
    .await;
    let ids: Vec<_> = listed["data"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item["entries"]["id"].as_str().unwrap().to_string())
        .collect();
    let newest = &ids[0];

    assert_eq!(
        unread(&app, "").await["data"],
        json!({ feed_id.clone(): 2, "news": 2 })
    );
    assert_eq!(unread(&app, "?view=1").await["data"], json!({}));

    let mark = json!({ "entryIds": [newest], "isInbox": true });
    let marked = json(app.post("/api/reads", mark.clone()).await).await;
    let again = json(app.post("/api/reads", mark).await).await;
    assert_eq!(again["lastSyncId"], marked["lastSyncId"]);
    app.delete("/api/reads", json!({ "entryId": newest, "isInbox": true }))
        .await;
    let total = json(app.get("/api/reads/total-count").await).await;
    assert_eq!(total["data"]["count"], 4);

    let mark_all = async |body: Value| {
        let marked = json(app.post("/api/reads/all", body).await).await;
        marked["data"]["read"].clone()
    };
    assert_eq!(mark_all(json!({ "view": 1 })).await, json!({}));
    let october_2 = "2026-10-02T00:00:00Z".parse::<DateTime<Utc>>().unwrap();
    let recent = json!({ "inboxId": "news", "startTime": october_2.timestamp_millis() });
    assert_eq!(mark_all(recent).await, json!({ "news": 1 }));
    assert_eq!(
        mark_all(json!({ "view": 0 })).await,
        json!({ feed_id.clone(): 2, "news": 1 })
    );
    assert_eq!(unread(&app, "").await["data"], json!({}));

    let flips: Vec<_> = app
        .actions()
        .await
        .into_iter()
        .filter(|action| action["model"] == "timeline" && action["action"] == "U")
        .map(|action| action["data"].clone())
        .collect();
    assert_eq!(flips[0]["entryIds"], json!([newest]));
    let changes: Vec<_> = flips
        .iter()
        .map(|data| {
            (
                data["isInbox"].clone(),
                data["read"].clone(),
                data["feeds"].clone(),
            )
        })
        .collect();
    let inbox = |read: bool| (json!(true), json!(read), json!({ "news": 1 }));
    assert_eq!(
        changes,
        [
            inbox(true),
            inbox(false),
            inbox(true),
            (json!(false), json!(true), json!({ feed_id: 2 })),
            inbox(true),
        ]
    );
}
