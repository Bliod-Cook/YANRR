mod common;

use common::{
    Fixtures, Reply, SINGLE_ITEM_RSS, TestApp, create_inbox, deliver, json, json_feed, subscribe,
};
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};
use serde_json::{Value, json};
use yannr::entity::unread;

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
    let items: Vec<_> = (1..=5)
        .map(|n| json!({ "id": format!("post-{n}"), "content_text": "text", "date_published": format!("2026-10-0{n}T08:00:00Z") }))
        .collect();
    fixtures.set("/feed.json", Reply::Body(json_feed(json!(items))));
    app.sign_up("alice@example.com").await;
    subscribe(&app, &fixtures.url("/feed.json"), json!({})).await;

    let mut pages = Vec::new();
    for (order, cursor_name) in [("desc", "publishedAfter"), ("asc", "publishedBefore")] {
        let mut seen = Vec::new();
        let mut cursor = Value::Null;
        loop {
            let mut query = json!({ "limit": 2, "sortOrder": order });
            if !cursor.is_null() {
                query[cursor_name] = cursor.clone();
            }
            let page = timeline(&app, query).await;
            let Some(last) = page.last() else { break };
            cursor = last["entries"]["publishedAt"].clone();
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
    let content = detail["data"]["entries"]["content"].as_str().unwrap();
    assert!(content.contains("rebuilt our reader"));
    let unknown = json(app.get("/api/entries?id=1").await).await;
    assert_eq!(unknown, json!({ "code": 0, "data": null }));

    let stream = app.post("/api/entries/stream", json!({ "ids": ids })).await;
    assert_eq!(stream.headers()["content-type"], "application/x-ndjson");
    let body = stream.text().await.unwrap();
    let lines: Vec<Value> = body
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(lines.len(), 2);
    let line = lines.iter().find(|line| line["id"] == first_id).unwrap();
    assert_eq!(line["content"], content);
}

#[tokio::test]
async fn readability_extracts_article() {
    let (app, fixtures) = (TestApp::spawn().await, Fixtures::spawn().await);
    let paragraph = "The reader keeps every subscription in sync across devices, and this sentence is \
        long enough to look like the body of an article rather than a navigation label. ";
    let page = format!(
        "<html><head><title>Article</title></head><body>
            <nav><a href='/'>Home</a> <a href='/about'>About this site</a></nav>
            <article><h1>Article</h1><p>{0}{0}</p><p>{0}{0}</p><p>{0}{0}</p></article>
        </body></html>",
        paragraph
    );
    fixtures.set("/article", Reply::Body(page));
    let item =
        json!([{ "id": "article", "url": fixtures.url("/article"), "content_text": "summary" }]);
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
