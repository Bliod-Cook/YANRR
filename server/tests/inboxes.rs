mod common;

use common::{TestApp, assert_error, create_inbox, deliver, json};
use sea_orm::{ConnectionTrait, EntityTrait, QueryOrder};
use serde_json::{Value, json};
use yanrr::entity::inbox_entry;

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

    let hook = json!({
        "guid": "w-1",
        "publishedAt": "2026-10-01T08:00:00.123456Z",
        "title": "Hook",
        "content": r#"<p>Hello from the hook.</p><img src="https://example.com/hook.jpg">"#,
    });
    // A wrong secret is refused before the body is read.
    assert_error(deliver(&app, "wrong", json!({})).await, 401, 1000).await;
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
            "html": r#"<h1>Hello</h1><p>This is the weekly newsletter, sent to everyone who subscribed.</p>
                <img src="https://example.com/mail.png">"#,
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
    assert_error(mail("wrong", json!({})).await, 401, 1000).await;
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
    // What a webhook or email leaves out of the description and media is taken from the content.
    let photo = |url: &str| Some(json!([{ "url": url, "type": "photo" }]));
    let hooked = &stored[0];
    assert_eq!(
        (hooked.description.as_deref(), hooked.media.clone()),
        (
            Some("Hello from the hook."),
            photo("https://example.com/hook.jpg")
        )
    );
    let mailed = &stored[2];
    assert_eq!(mailed.media, photo("https://example.com/mail.png"));
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

#[tokio::test]
async fn inbox_entries_list_detail_delete() {
    let app = TestApp::spawn().await;
    app.sign_up("alice@example.com").await;
    let secret = create_inbox(&app, "news").await;
    for day in 1..=3 {
        let entry = json!({
            "guid": format!("g-{day}"),
            "publishedAt": format!("2026-10-0{day}T08:00:00Z"),
            "title": format!("Day {day}"),
            "content": "<p>Body</p>",
            "read": day == 2,
        });
        deliver(&app, &secret, entry).await;
    }
    app.insert_user("bob").await;
    let sql = "INSERT INTO inboxes (handle, user_id, created_at) VALUES ('bobs', 'bob', now());
        INSERT INTO inbox_entries (id, inbox_handle, guid, read, published_at, inserted_at)
        VALUES (1, 'bobs', 'b', false, now(), now())";
    app.state.db.execute_unprepared(sql).await.unwrap();
    let list = async |body: Value| {
        let listed = json(app.post("/api/entries/inbox", body).await).await;
        listed["data"].as_array().unwrap().clone()
    };
    let titles = |items: &[Value]| -> Vec<Value> {
        items
            .iter()
            .map(|item| item["entries"]["title"].clone())
            .collect()
    };

    let first = list(json!({ "inboxId": "news", "limit": 2 })).await;
    assert_eq!(titles(&first), [json!("Day 3"), json!("Day 2")]);
    let cursor = &first[1]["entries"]["publishedAt"];
    let next = list(json!({ "inboxId": "news", "publishedAfter": cursor })).await;
    assert_eq!(titles(&next), [json!("Day 1")]);
    let unread = list(json!({ "inboxId": "news", "read": false })).await;
    assert_eq!(titles(&unread), [json!("Day 3"), json!("Day 1")]);
    assert_eq!(
        list(json!({ "inboxId": "bobs" })).await,
        Vec::<Value>::new()
    );

    let item = &first[0];
    let inbox = json(app.get("/api/inboxes?handle=news").await).await;
    assert_eq!(item["feeds"], inbox["data"]);
    assert_eq!(
        (
            &item["read"],
            &item["entries"]["read"],
            &item["entries"]["inboxHandle"]
        ),
        (&json!(false), &json!(false), &json!("news"))
    );
    assert_eq!(item["entries"].get("content"), None);
    assert_eq!(item.get("collections"), None);
    let id = item["entries"]["id"].as_str().unwrap();
    let detail = json(app.get(&format!("/api/entries/inbox?id={id}")).await).await;
    assert_eq!(detail["data"]["feeds"]["id"], "news");
    assert_eq!(detail["data"]["entries"]["content"], "<p>Body</p>");
    let foreign = json(app.get("/api/entries/inbox?id=1").await).await;
    assert_eq!(foreign["data"], Value::Null);

    let remove = async |id: &str| {
        app.delete("/api/entries/inbox", json!({ "entryId": id }))
            .await
    };
    assert_error(remove("1").await, 404, 3000).await;
    let removed = json(remove(id).await).await;
    assert_eq!(
        (&removed["code"], &removed["data"]),
        (&json!(0), &Value::Null)
    );
    assert!(removed["lastSyncId"].is_i64());
    assert_error(remove(id).await, 404, 3000).await;
    let removals: Vec<_> = app
        .actions()
        .await
        .into_iter()
        .filter(|action| action["model"] == "inbox_entry")
        .map(|action| {
            (
                action["action"].clone(),
                action["modelId"].clone(),
                action["data"].clone(),
            )
        })
        .collect();
    let data = json!({ "inboxId": "news", "unread": true });
    assert_eq!(removals, [(json!("D"), json!(id), data)]);
}

#[tokio::test]
async fn large_emails_fit_and_oversized_ones_get_413() {
    let app =
        TestApp::spawn_with(|config| config.inbox.email_secret = Some("mail-secret".into())).await;
    app.sign_up("alice@example.com").await;
    let secret = create_inbox(&app, "news").await;
    let mail = async |body: String| {
        app.client
            .post(format!("{}/api/inboxes/email", app.url))
            .bearer_auth("mail-secret")
            .header("content-type", "application/json")
            .body(body)
            .send()
            .await
            .unwrap()
    };
    let email = |id: &str, html_size: usize| {
        json!({
            "from": { "address": "bob@example.com" },
            "to": { "address": "news@example.com" },
            "subject": "Big",
            "messageId": id,
            "date": "2026-10-03T08:00:00Z",
            "html": "x".repeat(html_size),
        })
        .to_string()
    };
    let stored = async || {
        inbox_entry::Entity::find()
            .all(&app.state.db)
            .await
            .unwrap()
            .len()
    };

    assert_eq!(
        mail(email("<big@example.com>", 10 << 20)).await.status(),
        200
    );
    assert_eq!(stored().await, 1);

    let huge = || {
        app.client
            .post(format!("{}/api/inboxes/email", app.url))
            .bearer_auth("mail-secret")
            .header("content-type", "application/json")
            .body(email("<huge@example.com>", 26 << 20))
    };
    assert_eq!(too_large(huge).await, (413, json!(4)));
    assert_eq!(stored().await, 1);

    assert_error(mail("{".into()).await, 400, 4).await;

    // Other routes keep the default limit.
    let hook = json!({ "guid": "w-1", "publishedAt": "2026-10-01T08:00:00Z", "content": "x".repeat(3 << 20) });
    let hook = || {
        app.client
            .post(format!("{}/api/inboxes/webhook", app.url))
            .bearer_auth(&secret)
            .json(&hook)
    };
    assert_eq!(too_large(hook).await.0, 413);
    assert_eq!(stored().await, 1);
}

/// The status and `code` of the answer to a request with too large a body. The server answers before it has read
/// the rest of the body and then drops the connection, which the client may see before the answer; the request
/// is sent again until the answer is read.
async fn too_large(request: impl Fn() -> reqwest::RequestBuilder) -> (u16, Value) {
    for _ in 0..10 {
        let Ok(response) = request().send().await else {
            continue;
        };
        let status = response.status().as_u16();
        if let Ok(body) = response.json::<Value>().await {
            return (status, body["code"].clone());
        }
    }
    panic!("the server never got its answer through");
}
