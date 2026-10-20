mod common;

use common::{Fixtures, RSS2, Reply, TestApp};
use sea_orm::{ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, QueryOrder};
use serde_json::{Value, json};
use yannr::{
    entity::{entry, feed},
    fetch::{self, FetchError, scheduler},
};

const SINGLE_ITEM_RSS: &str = r#"<rss version="2.0"><channel><title>Live</title>
    <item><guid>post-0</guid><title>Earlier post</title><link>https://example.com/posts/0</link></item>
</channel></rss>"#;

async fn entries(app: &TestApp, feed_id: i64) -> Vec<entry::Model> {
    entry::Entity::find()
        .filter(entry::Column::FeedId.eq(feed_id))
        .order_by_asc(entry::Column::Id)
        .all(&app.state.db)
        .await
        .unwrap()
}

async fn reload(app: &TestApp, feed_id: i64) -> feed::Model {
    feed::Entity::find_by_id(feed_id)
        .one(&app.state.db)
        .await
        .unwrap()
        .unwrap()
}

#[tokio::test]
async fn add_feed_stores_entries_and_dedupes() {
    let (app, fixtures) = (TestApp::spawn().await, Fixtures::spawn().await);
    let url = fixtures.url("/rss");

    let feed = fetch::add_feed(&app.state, &url).await.unwrap();

    assert_eq!(feed.title.as_deref(), Some("Example Blog"));
    assert_eq!(feed.site_url.as_deref(), Some("https://example.com/"));
    assert_eq!(feed.ttl, Some(30));
    let stored = entries(&app, feed.id).await;
    assert_eq!(stored.len(), 2);
    let first = stored.iter().find(|entry| entry.guid == "post-1").unwrap();
    assert_eq!(first.media.as_ref().unwrap()[0]["type"], "photo");
    assert_eq!(
        first.attachments.as_ref().unwrap()[0]["duration_in_seconds"],
        3723
    );

    fetch::refresh_feed(&app.state, feed.id).await.unwrap();
    assert_eq!(entries(&app, feed.id).await, stored);
    assert_eq!(fetch::add_feed(&app.state, &url).await.unwrap().id, feed.id);
}

#[tokio::test]
async fn conditional_request_uses_etag() {
    let (app, fixtures) = (TestApp::spawn().await, Fixtures::spawn().await);
    let feed = fetch::add_feed(&app.state, &fixtures.url("/etag"))
        .await
        .unwrap();
    assert_eq!(feed.etag_header.as_deref(), Some("\"v1\""));

    fetch::refresh_feed(&app.state, feed.id).await.unwrap();

    assert_eq!(fixtures.not_modified_count(), 1);
    assert!(reload(&app, feed.id).await.checked_at > feed.checked_at);
}

#[tokio::test]
async fn fetch_error_is_recorded_then_cleared() {
    let (app, fixtures) = (TestApp::spawn().await, Fixtures::spawn().await);
    fixtures.set("/live", Reply::Body(RSS2.into()));
    let feed = fetch::add_feed(&app.state, &fixtures.url("/live"))
        .await
        .unwrap();

    fixtures.set("/live", Reply::Status(503));
    let result = fetch::refresh_feed(&app.state, feed.id).await;
    assert!(matches!(result, Err(FetchError::Fetch(_))));
    let failed = reload(&app, feed.id).await;
    assert_eq!(failed.error_message.as_deref(), Some("HTTP 503"));
    assert!(failed.error_at.is_some());

    fixtures.set("/live", Reply::Body(RSS2.into()));
    fetch::refresh_feed(&app.state, feed.id).await.unwrap();
    let recovered = reload(&app, feed.id).await;
    assert_eq!(recovered.error_message, None);
    assert_eq!(recovered.error_at, None);
}

#[tokio::test]
async fn permanent_redirect_migrates_feed() {
    let (app, fixtures) = (TestApp::spawn().await, Fixtures::spawn().await);
    fixtures.set("/live", Reply::Body(SINGLE_ITEM_RSS.into()));
    let feed = fetch::add_feed(&app.state, &fixtures.url("/live"))
        .await
        .unwrap();

    fixtures.set("/live", Reply::MovedTo("/rss"));
    fetch::refresh_feed(&app.state, feed.id).await.unwrap();

    let target = feed::Entity::find()
        .filter(feed::Column::Url.eq(fixtures.url("/rss")))
        .one(&app.state.db)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(reload(&app, feed.id).await.migrate_to, Some(target.id));
    assert_eq!(entries(&app, target.id).await.len(), 2);
}

#[tokio::test]
async fn failed_migration_leaves_no_partial_state() {
    let (app, fixtures) = (TestApp::spawn().await, Fixtures::spawn().await);
    fixtures.set("/old", Reply::Body(SINGLE_ITEM_RSS.into()));
    let feed = fetch::add_feed(&app.state, &fixtures.url("/old"))
        .await
        .unwrap();
    // PostgreSQL text cannot hold NUL, so storing this feed fails after it was fetched and parsed.
    let unstorable = r#"{"version": "https://jsonfeed.org/version/1.1", "title": "New",
        "items": [{"id": "bad\u0000guid", "content_text": "text"}]}"#;
    fixtures.set("/new", Reply::Body(unstorable.into()));
    fixtures.set("/old", Reply::MovedTo("/new"));

    let result = fetch::refresh_feed(&app.state, feed.id).await;

    assert!(matches!(result, Err(FetchError::Db(_))));
    let target = feed::Entity::find()
        .filter(feed::Column::Url.eq(fixtures.url("/new")))
        .one(&app.state.db)
        .await
        .unwrap();
    assert_eq!(target, None);
    assert_eq!(reload(&app, feed.id).await.migrate_to, None);
}

#[tokio::test]
async fn rsshub_url_uses_configured_instance() {
    let fixtures = Fixtures::spawn().await;
    let instance = fixtures.url("/rsshub");
    let app = TestApp::spawn_with(|config| config.rsshub.url = instance).await;

    let feed = fetch::add_feed(&app.state, "rsshub://social/alice")
        .await
        .unwrap();

    assert_eq!(feed.url, "rsshub://social/alice");
    assert_eq!(feed.title.as_deref(), Some("Social Timeline"));
}

#[tokio::test]
async fn claim_due_feeds_respects_ttl_and_inflight() {
    let app = TestApp::spawn().await;
    let feeds =
        "INSERT INTO feeds (id, url, ttl, checked_at, refresh_enqueued_at, migrate_to) VALUES
        (1, 'default-ttl', NULL, now() - interval '61 minutes', NULL, NULL),
        (2, 'fresh', NULL, now() - interval '59 minutes', NULL, NULL),
        (3, 'short-ttl', 15, now() - interval '16 minutes', NULL, NULL),
        (4, 'ttl-floor', 1, now() - interval '5 minutes', NULL, NULL),
        (5, 'migrated', NULL, now() - interval '2 hours', NULL, 1),
        (6, 'in-flight', NULL, now() - interval '2 hours', now() - interval '1 minute', NULL),
        (7, 'stuck', NULL, now() - interval '2 hours', now() - interval '11 minutes', NULL)";
    app.state.db.execute_unprepared(feeds).await.unwrap();

    let mut claimed = scheduler::claim_due_feeds(&app.state.db).await.unwrap();
    claimed.sort();

    assert_eq!(claimed, [1, 3, 7]);
    assert!(
        scheduler::claim_due_feeds(&app.state.db)
            .await
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn manual_refresh_endpoint() {
    let (app, fixtures) = (TestApp::spawn().await, Fixtures::spawn().await);
    fixtures.set("/live", Reply::Body(SINGLE_ITEM_RSS.into()));
    let feed = fetch::add_feed(&app.state, &fixtures.url("/live"))
        .await
        .unwrap();
    app.sign_up("alice@example.com").await;

    fixtures.set("/live", Reply::Body(RSS2.into()));
    let res = app.get(&format!("/api/feeds/refresh?id={}", feed.id)).await;
    assert_eq!(res.json::<Value>().await.unwrap(), json!({ "code": 0 }));
    assert_eq!(entries(&app, feed.id).await.len(), 3);
    assert!(reload(&app, feed.id).await.refresh_enqueued_at.is_some());

    fixtures.set("/live", Reply::Status(500));
    let res = app.get(&format!("/api/feeds/refresh?id={}", feed.id)).await;
    assert_eq!(res.status(), 400);
    assert_eq!(res.json::<Value>().await.unwrap()["code"], 2003);

    let res = app.get("/api/feeds/refresh?id=1").await;
    assert_eq!(res.status(), 404);
    assert_eq!(res.json::<Value>().await.unwrap()["code"], 2001);
}
