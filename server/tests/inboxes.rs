mod common;

use common::{TestApp, assert_error, json};
use sea_orm::ConnectionTrait;
use serde_json::{Value, json};

#[tokio::test]
async fn inbox_lifecycle() {
    let app = TestApp::spawn().await;
    app.sign_up("alice@example.com").await;
    let alice = app.user_id().await;
    app.insert_user("bob").await;
    let sql = "INSERT INTO inboxes (handle, user_id, created_at) VALUES ('bobs', 'bob', now())";
    app.state.db.execute_unprepared(sql).await.unwrap();

    let create = async |body: Value| app.post("/api/inboxes", body).await;
    let created = json(create(json!({ "handle": "news", "title": "News" })).await).await;
    assert!(created["lastSyncId"].is_i64());
    assert_error(create(json!({ "handle": "bobs" })).await, 400, 10001).await;
    assert_error(create(json!({ "handle": "No!" })).await, 400, 4).await;

    let inbox = json(app.get("/api/inboxes?handle=news").await).await["data"].clone();
    let secret = inbox["secret"].as_str().unwrap();
    assert_eq!(secret.len(), 32);
    assert_eq!(
        inbox,
        json!({
            "id": "news",
            "type": "inbox",
            "secret": secret,
            "title": "News",
            "description": null,
            "image": null,
            "ownerUserId": alice,
            "owner": null,
        })
    );
    let listed = json(app.get("/api/inboxes/list").await).await;
    assert_eq!(listed["data"], json!([inbox]));

    let subscriptions = json(app.get("/api/subscriptions").await).await;
    let subscription = subscriptions["data"][0].clone();
    assert_eq!(
        subscription,
        json!({
            "inboxes": inbox,
            "feedId": "inbox-news",
            "inboxId": "news",
            "title": "News",
            "userId": alice,
            "view": 0,
            "category": null,
            "isPrivate": false,
            "hideFromTimeline": null,
            "createdAt": subscription["createdAt"],
        })
    );
    let social = json(app.get("/api/subscriptions?view=1").await).await;
    assert_eq!(social["data"], json!([]));

    let retitle = json!({ "handle": "news", "title": "Letters" });
    app.put("/api/inboxes", retitle).await;
    assert_error(app.get("/api/inboxes?handle=bobs").await, 403, 10003).await;
    let bobs = json!({ "handle": "bobs", "title": "Mine" });
    assert_error(app.put("/api/inboxes", bobs).await, 403, 10003).await;
    let bobs = json!({ "handle": "bobs" });
    assert_error(app.delete("/api/inboxes", bobs).await, 403, 10003).await;
    assert_error(app.get("/api/inboxes?handle=nobody").await, 404, 10000).await;
    app.delete("/api/inboxes", json!({ "handle": "news" }))
        .await;
    let listed = json(app.get("/api/inboxes/list").await).await;
    assert_eq!(listed["data"], json!([]));

    let logged: Vec<_> = app
        .actions()
        .await
        .into_iter()
        .filter(|action| action["model"] == "inbox")
        .map(|action| {
            (
                action["action"].clone(),
                action["modelId"].clone(),
                action["data"].clone(),
            )
        })
        .collect();
    assert_eq!(
        logged,
        [
            (json!("I"), json!("news"), subscription),
            (json!("U"), json!("news"), json!({ "title": "Letters" })),
            (json!("D"), json!("news"), Value::Null),
        ]
    );
}
