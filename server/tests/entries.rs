mod common;

use common::{
    Fixtures, Reply, SINGLE_ITEM_RSS, TestApp, create_inbox, deliver, json, json_feed, subscribe,
};
use sea_orm::{ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter};
use serde_json::{Value, json};
use yanrr::entity::unread;

async fn timeline(app: &TestApp, query: Value) -> Vec<Value> {
    let listed = json(app.post("/api/entries", query).await).await;
    listed["data"].as_array().unwrap().clone()
}

fn guids(items: &[Value]) -> Vec<&str> {
    items
        .iter()
        .map(|item| item["entries"]["guid"].as_str().unwrap())
        .collect()
}

#[tokio::test]
async fn timeline_scopes_and_read_state() {
    let (app, fixtures) = (TestApp::spawn().await, Fixtures::spawn().await);
    fixtures.set("/other", Reply::Body(SINGLE_ITEM_RSS.into()));
    app.sign_up("alice@example.com").await;
    let articles = subscribe(&app, &fixtures.url("/rss"), json!({ "view": 0 })).await;
    let hidden = json!({ "view": 1, "hideFromTimeline": true });
    let hidden = subscribe(&app, &fixtures.url("/etag"), hidden).await;
    let preview = json(
        app.get(&format!("/api/feeds?url={}", fixtures.url("/other")))
            .await,
    )
    .await;
    let unfollowed = preview["data"]["feed"]["id"].as_str().unwrap();

    let in_view = timeline(&app, json!({ "view": 0 })).await;
    assert_eq!(in_view.len(), 2);
    let item = &in_view[0];
    assert_eq!(item["feeds"]["id"], articles);
    assert_eq!(item["read"], false);
    assert_eq!(item["view"], 0);
    assert_eq!(item["from"], json!(["feed"]));
    assert_eq!(item.get("collections"), None);
    assert_eq!(item["entries"].get("content"), None);
    assert_eq!(guids(&timeline(&app, json!({ "view": -1 })).await).len(), 2);
    assert_eq!(timeline(&app, json!({ "feedId": hidden })).await.len(), 2);
    let previewed = timeline(&app, json!({ "feedId": unfollowed })).await;
    assert_eq!(previewed[0]["read"], true);

    let read_id: i64 = in_view[0]["entries"]["id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    unread::Entity::delete_many()
        .filter(unread::Column::EntryId.eq(read_id))
        .exec(&app.state.db)
        .await
        .unwrap();
    let unread_only = timeline(&app, json!({ "view": 0, "read": false })).await;
    assert_eq!(unread_only.len(), 1);
    assert_ne!(unread_only[0]["entries"]["id"], in_view[0]["entries"]["id"]);

    let with_content = json!({ "feedIdList": [articles], "withContent": true });
    let with_content = timeline(&app, with_content).await;
    assert!(
        with_content
            .iter()
            .all(|item| item["entries"]["content"].is_string())
    );
    assert_eq!(
        timeline(&app, json!({ "listId": "1" })).await,
        Vec::<Value>::new()
    );
}

#[tokio::test]
async fn timeline_pages_by_published_time() {
    let (app, fixtures) = (TestApp::spawn().await, Fixtures::spawn().await);
    // Posts 2 to 4 share a time, so pages of two end inside it either way.
    let days = [1, 3, 3, 3, 5];
    let items: Vec<_> = (1..=5)
        .zip(days)
        .map(|(n, day)| json!({ "id": format!("post-{n}"), "content_text": "text", "date_published": format!("2026-10-0{day}T08:00:00Z") }))
        .collect();
    fixtures.set("/feed.json", Reply::Body(json_feed(json!(items))));
    app.sign_up("alice@example.com").await;
    subscribe(&app, &fixtures.url("/feed.json"), json!({})).await;

    let mut pages = Vec::new();
    for (order, cursor_name) in [("desc", "publishedAfter"), ("asc", "publishedBefore")] {
        let mut seen = Vec::new();
        let mut cursor = None;
        loop {
            let mut query = json!({ "limit": 2, "sortOrder": order });
            if let Some((time, id)) = cursor {
                query[cursor_name] = time;
                query["cursorId"] = id;
            }
            let page = timeline(&app, query).await;
            let Some(last) = page.last() else { break };
            let entry = &last["entries"];
            cursor = Some((entry["publishedAt"].clone(), entry["id"].clone()));
            seen.extend(guids(&page).into_iter().map(String::from));
        }
        pages.push(seen);
    }

    let newest_first: Vec<_> = (1..=5).rev().map(|n| format!("post-{n}")).collect();
    let oldest_first: Vec<_> = (1..=5).map(|n| format!("post-{n}")).collect();
    assert_eq!(pages, [newest_first, oldest_first]);
}

#[tokio::test]
async fn entry_detail_and_content_stream() {
    let (app, fixtures) = (TestApp::spawn().await, Fixtures::spawn().await);
    app.sign_up("alice@example.com").await;
    let feed_id = subscribe(&app, &fixtures.url("/rss"), json!({})).await;
    let items = timeline(&app, json!({})).await;
    let ids: Vec<_> = items
        .iter()
        .map(|item| item["entries"]["id"].clone())
        .collect();
    let first = items
        .iter()
        .find(|item| item["entries"]["guid"] == "post-1")
        .unwrap();
    let first_id = first["entries"]["id"].as_str().unwrap();

    let detail = json(app.get(&format!("/api/entries?id={first_id}")).await).await;
    assert_eq!(detail["data"]["feeds"]["id"], feed_id);
    assert_eq!(detail["data"]["read"], false);
    let content = detail["data"]["entries"]["content"].as_str().unwrap();
    assert!(content.contains("rebuilt our reader"));
    app.post("/api/reads", json!({ "entryIds": [first_id] }))
        .await;
    let detail = json(app.get(&format!("/api/entries?id={first_id}")).await).await;
    assert_eq!(detail["data"]["read"], true);
    let unknown = json(app.get("/api/entries?id=1").await).await;
    assert_eq!(unknown, json!({ "code": 0, "data": null }));

    // Inbox entries stream too, but only from the user's own inboxes.
    let secret = create_inbox(&app, "news").await;
    let mail =
        json!({ "guid": "m-1", "publishedAt": "2026-10-01T08:00:00Z", "content": "<p>Mail</p>" });
    deliver(&app, &secret, mail).await;
    let inbox = json(
        app.post("/api/entries/inbox", json!({ "inboxId": "news" }))
            .await,
    )
    .await;
    let mail_id = inbox["data"][0]["entries"]["id"].clone();
    app.insert_user("bob").await;
    let theirs = "INSERT INTO inboxes (handle, user_id, created_at) VALUES ('bob', 'bob', now());
        INSERT INTO inbox_entries (id, inbox_handle, guid, content, read, published_at, inserted_at)
        VALUES (42, 'bob', 'b-1', '<p>Not yours</p>', false, now(), now())";
    app.state.db.execute_unprepared(theirs).await.unwrap();

    let mut ids = ids;
    ids.extend([mail_id.clone(), json!("42")]);
    let stream = app.post("/api/entries/stream", json!({ "ids": ids })).await;
    assert_eq!(stream.headers()["content-type"], "application/x-ndjson");
    let body = stream.text().await.unwrap();
    let lines: Vec<Value> = body
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(lines.len(), 3);
    let line = lines.iter().find(|line| line["id"] == first_id).unwrap();
    assert_eq!(line["content"], content);
    let line = lines.iter().find(|line| line["id"] == mail_id).unwrap();
    assert_eq!(line["content"], "<p>Mail</p>");

    // The body is complete, so it is compressed for clients that accept it.
    // The test client would decode it and drop the header, so this one keeps the raw answer.
    let raw = reqwest::Client::builder()
        .no_gzip()
        .cookie_store(true)
        .build()
        .unwrap();
    let credentials = json!({ "email": "alice@example.com", "password": common::PASSWORD });
    raw.post(format!("{}/api/better-auth/sign-in/email", app.url))
        .header(reqwest::header::ORIGIN, &app.url)
        .json(&credentials)
        .send()
        .await
        .unwrap();
    let compressed = raw
        .post(format!("{}/api/entries/stream", app.url))
        .header(reqwest::header::ACCEPT_ENCODING, "gzip")
        .json(&json!({ "ids": [first_id] }))
        .send()
        .await
        .unwrap();
    assert_eq!(compressed.headers()["content-encoding"], "gzip");
}

#[tokio::test]
async fn readability_extracts_article() {
    let (app, fixtures) = (TestApp::spawn().await, Fixtures::spawn().await);
    let item =
        json!([{ "id": "article", "url": common::article(&fixtures), "content_text": "summary" }]);
    fixtures.set("/feed.json", Reply::Body(json_feed(item)));
    app.sign_up("alice@example.com").await;
    subscribe(&app, &fixtures.url("/feed.json"), json!({})).await;
    let id = timeline(&app, json!({})).await[0]["entries"]["id"].clone();
    let id = id.as_str().unwrap();

    let readable = json(app.get(&format!("/api/entries/readability?id={id}")).await).await;

    let content = readable["data"]["content"].as_str().unwrap();
    assert!(content.contains("keeps every subscription in sync"));
    assert!(!content.contains("About this site"));
    let unknown = app.get("/api/entries/readability?id=1").await;
    common::assert_error(unknown, 404, 3000).await;
}

#[tokio::test]
async fn readability_reads_the_charset_of_the_content_type() {
    let (app, fixtures) = (TestApp::spawn().await, Fixtures::spawn().await);
    let sentence = "阅读器在所有设备之间同步每一个订阅，这句话足够长，看起来像文章的正文。";
    let paragraph = format!("<p>{}</p>", sentence.repeat(4));
    let page = format!(
        "<html><head><title>文章</title></head><body><article><h1>文章</h1>{}</article></body></html>",
        paragraph.repeat(3)
    );
    let (gbk, _, _) = encoding_rs::GBK.encode(&page);
    let reply = Reply::Bytes(gbk.into_owned(), "text/html; charset=gbk");
    fixtures.set("/gbk", reply);
    let item = json!([{ "id": "gbk", "url": fixtures.url("/gbk"), "content_text": "summary" }]);
    fixtures.set("/feed.json", Reply::Body(json_feed(item)));
    app.sign_up("alice@example.com").await;
    subscribe(&app, &fixtures.url("/feed.json"), json!({})).await;
    let id = timeline(&app, json!({})).await[0]["entries"]["id"].clone();
    let id = id.as_str().unwrap();

    let readable = json(app.get(&format!("/api/entries/readability?id={id}")).await).await;

    let content = readable["data"]["content"].as_str().unwrap();
    assert!(
        content.contains("阅读器在所有设备之间同步每一个订阅"),
        "{content}"
    );
}

#[tokio::test]
async fn timeline_mixes_in_inbox_entries() {
    let (app, fixtures) = (TestApp::spawn().await, Fixtures::spawn().await);
    app.sign_up("alice@example.com").await;
    let items: Vec<_> = [1, 3, 5]
        .map(|day| json!({ "id": format!("feed-{day}"), "date_published": format!("2026-10-0{day}T08:00:00Z") }))
        .into();
    fixtures.set("/feed.json", Reply::Body(json_feed(json!(items))));
    let feed_id = subscribe(&app, &fixtures.url("/feed.json"), json!({})).await;
    let secret = create_inbox(&app, "news").await;
    for day in [2, 4] {
        let entry = json!({ "guid": format!("inbox-{day}"), "publishedAt": format!("2026-10-0{day}T08:00:00Z") });
        deliver(&app, &secret, entry).await;
    }

    let first = timeline(&app, json!({ "limit": 3 })).await;
    assert_eq!(guids(&first), ["feed-5", "inbox-4", "feed-3"]);
    let cursor = &first[2]["entries"]["publishedAt"];
    let next = timeline(&app, json!({ "view": 0, "publishedAfter": cursor })).await;
    assert_eq!(guids(&next), ["inbox-2", "feed-1"]);
    let oldest = json!({ "sortOrder": "asc", "limit": 2 });
    assert_eq!(guids(&timeline(&app, oldest).await), ["feed-1", "inbox-2"]);
    let inboxed = &first[1];
    assert_eq!(
        (&inboxed["from"], &inboxed["feeds"]["type"]),
        (&json!(["inbox"]), &json!("inbox"))
    );
    assert_eq!(inboxed.get("collections"), None);

    assert_eq!(
        timeline(&app, json!({ "view": 1 })).await,
        Vec::<Value>::new()
    );
    let feed_only = timeline(&app, json!({ "feedId": feed_id })).await;
    assert_eq!(guids(&feed_only), ["feed-5", "feed-3", "feed-1"]);
}
