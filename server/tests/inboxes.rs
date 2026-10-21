mod common;

use common::{TestApp, assert_error, create_inbox, deliver, json};
use sea_orm::{ConnectionTrait, EntityTrait, QueryOrder};
use serde_json::{Value, json};
use yannr::entity::inbox_entry;

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

#[tokio::test]
async fn webhook_and_email_delivery() {
    let app =
        TestApp::spawn_with(|config| config.inbox.email_secret = Some("mail-secret".into())).await;
    app.sign_up("alice@example.com").await;
    let secret = create_inbox(&app, "news").await;

    let hook =
        json!({ "guid": "w-1", "publishedAt": "2026-10-01T08:00:00.123456Z", "title": "Hook" });
    assert_error(deliver(&app, "wrong", hook.clone()).await, 401, 1000).await;
    for _ in 0..2 {
        assert_eq!(
            json(deliver(&app, &secret, hook.clone()).await).await,
            json!({ "code": 0 })
        );
    }
    let seen = json!({ "guid": "w-2", "publishedAt": "2026-10-02T08:00:00Z", "read": true });
    deliver(&app, &secret, seen).await;

    let email = |to: &str| {
        json!({
            "from": { "name": "Bob", "address": "bob@example.com" },
            "to": { "address": to },
            "subject": "The weekly news about the world",
            "messageId": "<m-1@example.com>",
            "date": "2026-10-03T08:00:00Z",
            "html": "<h1>Hello</h1><p>This is the weekly newsletter, sent to everyone who subscribed.</p>",
        })
    };
    let mail = async |token: &str, body: Value| {
        app.client
            .post(format!("{}/api/inboxes/email", app.url))
            .bearer_auth(token)
            .json(&body)
            .send()
            .await
            .unwrap()
    };
    assert_error(mail("wrong", email("news@example.com")).await, 401, 1000).await;
    assert_error(
        mail("mail-secret", email("nobody@example.com")).await,
        404,
        10000,
    )
    .await;
    mail("mail-secret", email("News@example.com")).await;

    let stored = inbox_entry::Entity::find()
        .order_by_asc(inbox_entry::Column::PublishedAt)
        .all(&app.state.db)
        .await
        .unwrap();
    let summary: Vec<_> = stored
        .iter()
        .map(|entry| {
            (
                entry.guid.as_str(),
                entry.read,
                entry.published_at.to_rfc3339(),
            )
        })
        .collect();
    assert_eq!(
        summary,
        [
            ("w-1", false, "2026-10-01T08:00:00.123+00:00".to_string()),
            ("w-2", true, "2026-10-02T08:00:00+00:00".to_string()),
            (
                "<m-1@example.com>",
                false,
                "2026-10-03T08:00:00+00:00".to_string()
            ),
        ]
    );
    let mailed = &stored[2];
    assert_eq!(
        (
            mailed.title.as_deref(),
            mailed.author.as_deref(),
            mailed.author_url.as_deref(),
            mailed.description.as_deref(),
            mailed.language.as_deref(),
        ),
        (
            Some("The weekly news about the world"),
            Some("Bob"),
            Some("mailto:bob@example.com"),
            Some("Hello This is the weekly newsletter, sent to everyone who subscribed."),
            Some("en"),
        )
    );

    let arrivals: Vec<_> = app
        .actions()
        .await
        .into_iter()
        .filter(|action| action["action"] == "N")
        .map(|action| (action["modelId"].clone(), action["data"].clone()))
        .collect();
    let arrival = |published_at: &str, unread: u8| {
        let data = json!({
            "inboxId": "news",
            "isInbox": true,
            "count": 1,
            "unread": unread,
            "latestPublishedAt": published_at,
            "from": ["inbox"],
        });
        (json!("news"), data)
    };
    assert_eq!(
        arrivals,
        [
            arrival("2026-10-01T08:00:00.123Z", 1),
            arrival("2026-10-02T08:00:00.000Z", 0),
            arrival("2026-10-03T08:00:00.000Z", 1),
        ]
    );
}
