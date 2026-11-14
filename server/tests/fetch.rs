mod common;

use std::time::Duration;

use chrono::TimeDelta;
use common::{
    Fixtures, RSS2, Recorded, Reply, SINGLE_ITEM_RSS, TWO_ITEM_RSS, TestApp, json, json_feed,
    subscribe,
};
use sea_orm::{
    ColumnTrait, ConnectionTrait, DbBackend, EntityTrait, PaginatorTrait, QueryFilter, QueryOrder,
    Statement,
};
use serde_json::{Value, json};
use yanrr::{
    entity::{blocked_entry, entry, feed, subscription, unread},
    fetch::{
        self, FetchError,
        scheduler::{self, Scheduler},
    },
};

async fn followed_feeds(app: &TestApp, user_id: &str) -> Vec<i64> {
    let follows = subscription::Entity::find()
        .filter(subscription::Column::UserId.eq(user_id))
        .all(&app.state.db)
        .await
        .unwrap();
    follows.into_iter().map(|row| row.feed_id).collect()
}

async fn unread_entries(app: &TestApp, user_id: &str) -> Vec<i64> {
    let unread = unread::Entity::find()
        .filter(unread::Column::UserId.eq(user_id))
        .all(&app.state.db)
        .await
        .unwrap();
    unread.into_iter().map(|row| row.entry_id).collect()
}

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
    // Another spelling of the address finds the same feed.
    let spelled = url.replacen("http", "HTTP", 1).replace("/rss", "/./rss");
    assert_eq!(
        fetch::add_feed(&app.state, &spelled).await.unwrap().id,
        feed.id
    );
}

/// Makes the database refuse entries whose guid is `unstorable`, as it does entries it cannot store.
async fn refuse_unstorable(app: &TestApp) {
    let sql = "CREATE FUNCTION refuse() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN RAISE EXCEPTION 'refused'; END $$;
        CREATE TRIGGER refuse BEFORE INSERT ON entries
            FOR EACH ROW WHEN (NEW.guid = 'unstorable') EXECUTE FUNCTION refuse()";
    app.state.db.execute_unprepared(sql).await.unwrap();
}

fn unstorable() -> String {
    json_feed(json!([{ "id": "unstorable", "content_text": "text" }]))
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

    // `errorAt` marks when the failures began: clients only flag a feed failing for a day.
    fixtures.set("/live", Reply::Status(500));
    let _ = fetch::refresh_feed(&app.state, feed.id).await;
    let still_failing = reload(&app, feed.id).await;
    assert_eq!(still_failing.error_message.as_deref(), Some("HTTP 500"));
    assert_eq!(still_failing.error_at, failed.error_at);

    fixtures.set("/live", Reply::Body(RSS2.into()));
    fetch::refresh_feed(&app.state, feed.id).await.unwrap();
    let recovered = reload(&app, feed.id).await;
    assert_eq!(recovered.error_message, None);
    assert_eq!(recovered.error_at, None);

    // Failing to store is recorded too, or the scheduler would claim and download the feed again soon.
    refuse_unstorable(&app).await;
    fixtures.set("/live", Reply::Body(unstorable()));
    let result = fetch::refresh_feed(&app.state, feed.id).await;
    assert!(matches!(result, Err(FetchError::Db(_))));
    let unstored = reload(&app, feed.id).await;
    assert_eq!(
        unstored.error_message.as_deref(),
        Some("Storing the feed failed")
    );
    assert!(unstored.checked_at > recovered.checked_at);
    assert!(unstored.error_at.is_some());
}

#[tokio::test]
async fn servers_asking_to_wait_are_left_alone() {
    let (app, fixtures) = (TestApp::spawn().await, Fixtures::spawn().await);
    fixtures.set("/live", Reply::Body(RSS2.into()));
    let feed = fetch::add_feed(&app.state, &fixtures.url("/live"))
        .await
        .unwrap();
    // Back-off waits as long as the failures lasted, so they count from as long ago as the server asks to wait.
    let waited = async |reply| {
        fixtures.set("/live", reply);
        let _ = fetch::refresh_feed(&app.state, feed.id).await;
        let failed = reload(&app, feed.id).await;
        failed.checked_at - failed.error_at.unwrap()
    };

    let limited = Reply::Headers(429, &[("retry-after", "7200")]);
    assert_eq!(waited(limited).await, TimeDelta::hours(2));
    assert_eq!(waited(Reply::Status(410)).await, TimeDelta::days(1));
}

#[tokio::test]
async fn huge_feeds_are_stored_and_refreshes_add_only_new_entries() {
    let (app, fixtures) = (TestApp::spawn().await, Fixtures::spawn().await);
    app.sign_up("alice@example.com").await;
    // More entries than one statement can bind parameters for.
    let items: Vec<_> = (0..4000)
        .map(|i| json!({ "id": format!("post-{i}"), "content_text": "text" }))
        .collect();
    fixtures.set("/huge", Reply::Body(json_feed(json!(items))));
    let feed_id: i64 = subscribe(&app, &fixtures.url("/huge"), json!({}))
        .await
        .parse()
        .unwrap();
    assert_eq!(entries(&app, feed_id).await.len(), 4000);

    let logged = app.actions().await.len();
    fetch::refresh_feed(&app.state, feed_id).await.unwrap();
    assert_eq!(entries(&app, feed_id).await.len(), 4000);
    assert_eq!(app.actions().await.len(), logged);
}

#[tokio::test]
async fn refresh_fans_out_new_entries() {
    let (app, fixtures) = (TestApp::spawn().await, Fixtures::spawn().await);
    fixtures.set("/live", Reply::Body(SINGLE_ITEM_RSS.into()));
    app.sign_up("alice@example.com").await;
    let body = json!({ "url": fixtures.url("/live") });
    let feed_id = json(app.post("/api/subscriptions", body).await).await["feed"]["id"]
        .as_str()
        .unwrap()
        .to_string();

    fixtures.set("/live", Reply::Body(TWO_ITEM_RSS.into()));
    fetch::refresh_feed(&app.state, feed_id.parse().unwrap())
        .await
        .unwrap();

    assert_eq!(unread_entries(&app, &app.user_id().await).await.len(), 2);
    let actions = app.actions().await;
    let new = actions.last().unwrap();
    assert_eq!(new["model"], "timeline");
    assert_eq!(new["action"], "N");
    assert_eq!(new["modelId"], feed_id);
    let data = &new["data"];
    assert_eq!(data["feedId"], feed_id);
    assert_eq!((&data["count"], &data["unread"]), (&json!(1), &json!(1)));
    assert_eq!(data["latestPublishedAt"], "2026-10-02T09:00:00.000Z");
    assert_eq!(data["from"], json!(["feed"]));
}

#[tokio::test]
async fn new_entries_reach_many_subscribers() {
    let (app, fixtures) = (TestApp::spawn().await, Fixtures::spawn().await);
    fixtures.set("/live", Reply::Body(SINGLE_ITEM_RSS.into()));
    let feed = fetch::add_feed(&app.state, &fixtures.url("/live"))
        .await
        .unwrap();
    let users = "INSERT INTO users (id, email, email_verified, created_at, updated_at)
        SELECT 'user' || i, 'user' || i || '@example.com', false, now(), now() FROM generate_series(1, 50) i";
    app.state.db.execute_unprepared(users).await.unwrap();
    let follows = format!(
        "INSERT INTO subscriptions (user_id, feed_id, view, created_at) SELECT id, {}, 0, now() FROM users",
        feed.id
    );
    app.state.db.execute_unprepared(&follows).await.unwrap();
    // More unread marks than one statement could bind parameters for, row by row.
    let items: Vec<_> = (0..450)
        .map(|i| json!({ "id": format!("new-{i}"), "content_text": "text" }))
        .collect();
    fixtures.set("/live", Reply::Body(json_feed(json!(items))));

    fetch::refresh_feed(&app.state, feed.id).await.unwrap();

    let unread = unread::Entity::find().count(&app.state.db).await.unwrap();
    assert_eq!(unread, 50 * 450);
}

#[tokio::test]
async fn permanent_redirect_to_a_new_address_moves_the_feed() {
    let (app, fixtures) = (TestApp::spawn().await, Fixtures::spawn().await);
    fixtures.set("/live", Reply::Body(SINGLE_ITEM_RSS.into()));
    app.sign_up("alice@example.com").await;
    let alice = app.user_id().await;
    let feed_id: i64 = subscribe(&app, &fixtures.url("/live"), json!({}))
        .await
        .parse()
        .unwrap();
    let logged = app.actions().await.len();

    fixtures.set("/live", Reply::MovedTo("/new"));
    fixtures.set("/new", Reply::Body(TWO_ITEM_RSS.into()));
    fetch::refresh_feed(&app.state, feed_id).await.unwrap();

    let moved = reload(&app, feed_id).await;
    assert_eq!(moved.url, fixtures.url("/new"));
    assert_eq!(moved.migrate_to, None);
    assert_eq!(feed::Entity::find().count(&app.state.db).await.unwrap(), 1);
    assert_eq!(followed_feeds(&app, &alice).await, [feed_id]);
    assert_eq!(entries(&app, feed_id).await.len(), 2);
    let logged: Vec<_> = app.actions().await[logged..]
        .iter()
        .map(|action| (action["model"].clone(), action["action"].clone()))
        .collect();
    assert_eq!(logged, [(json!("timeline"), json!("N"))]);
}

#[tokio::test]
async fn temporary_redirects_keep_the_address() {
    let (app, fixtures) = (TestApp::spawn().await, Fixtures::spawn().await);
    fixtures.set("/live", Reply::Headers(302, &[("location", "/dir/feed")]));
    let relative = r#"<rss version="2.0"><channel><title>Live</title>
        <item><guid>post-1</guid><link>posts/1</link></item>
    </channel></rss>"#;
    fixtures.set("/dir/feed", Reply::Body(relative.into()));

    let feed = fetch::add_feed(&app.state, &fixtures.url("/live"))
        .await
        .unwrap();
    fetch::refresh_feed(&app.state, feed.id).await.unwrap();

    assert_eq!(reload(&app, feed.id).await.url, fixtures.url("/live"));
    assert_eq!(feed::Entity::find().count(&app.state.db).await.unwrap(), 1);
    // Links are relative to where the feed was found.
    let stored = entries(&app, feed.id).await;
    assert_eq!(stored[0].url, Some(fixtures.url("/dir/posts/1")));
}

/// [`SINGLE_ITEM_RSS`] with an older post that [`TWO_ITEM_RSS`] does not have.
const OLD_ITEM_RSS: &str = r#"<rss version="2.0"><channel><title>Live</title>
    <item><guid>post-0</guid><title>Earlier post</title><link>https://example.com/posts/0</link></item>
    <item><guid>post-old</guid><title>Old post</title><pubDate>Thu, 01 Oct 2026 09:00:00 GMT</pubDate></item>
</channel></rss>"#;

#[tokio::test]
async fn permanent_redirect_to_another_feed_migrates_subscriptions_and_entries() {
    let (app, fixtures) = (TestApp::spawn().await, Fixtures::spawn().await);
    fixtures.set("/live", Reply::Body(OLD_ITEM_RSS.into()));
    fixtures.set("/new", Reply::Body(TWO_ITEM_RSS.into()));
    let feed = fetch::add_feed(&app.state, &fixtures.url("/live"))
        .await
        .unwrap();
    let target = fetch::add_feed(&app.state, &fixtures.url("/new"))
        .await
        .unwrap();
    app.sign_up("alice@example.com").await;
    let alice = app.user_id().await;
    let body = json!({ "feedId": feed.id.to_string() });
    app.post("/api/subscriptions", body.clone()).await;
    let old_entries = entries(&app, feed.id).await;
    let guid = |guid: &str| old_entries.iter().find(|e| e.guid == guid).unwrap().id;
    let (shared, old) = (guid("post-0"), guid("post-old"));
    // Alice read the post both feeds carry.
    unread::Entity::delete_by_id((alice.clone(), shared))
        .exec(&app.state.db)
        .await
        .unwrap();
    app.insert_user("bob").await;
    let follow = format!(
        "INSERT INTO subscriptions (user_id, feed_id, view, created_at) VALUES
         ('bob', {}, 0, now()), ('bob', {}, 0, now())",
        feed.id, target.id
    );
    app.state.db.execute_unprepared(&follow).await.unwrap();

    fixtures.set("/live", Reply::MovedTo("/new"));
    fetch::refresh_feed(&app.state, feed.id).await.unwrap();

    assert_eq!(reload(&app, feed.id).await.migrate_to, Some(target.id));
    assert_eq!(followed_feeds(&app, &alice).await, [target.id]);
    assert_eq!(followed_feeds(&app, "bob").await, [target.id]);
    // The entry only the old feed had moved along, still unread; the shared one stays behind, read.
    let target_entries = entries(&app, target.id).await;
    assert!(target_entries.iter().any(|entry| entry.id == old));
    assert!(target_entries.iter().all(|entry| entry.id != shared));
    let new_post = target_entries
        .iter()
        .find(|entry| entry.guid == "post-new")
        .unwrap();
    let mut unread = unread_entries(&app, &alice).await;
    unread.sort();
    assert_eq!(unread, [old, new_post.id]);
    let actions = app.actions().await;
    let moved: Vec<_> = actions[actions.len() - 2..]
        .iter()
        .map(|action| (action["action"].clone(), action["modelId"].clone()))
        .collect();
    assert_eq!(
        moved,
        [
            (json!("D"), json!(feed.id.to_string())),
            (json!("I"), json!(target.id.to_string()))
        ]
    );

    app.sign_up("carol@example.com").await;
    let followed = json(app.post("/api/subscriptions", body).await).await;
    assert_eq!(followed["feed"]["id"], target.id.to_string());
}

#[tokio::test]
async fn migrated_followers_keep_their_unread_and_blocks_and_get_the_latest_unread() {
    let (app, fixtures) = (TestApp::spawn().await, Fixtures::spawn().await);
    let blocked =
        json!({ "id": "blocked", "title": "Blocked", "date_published": "2026-10-04T00:00:00Z" });
    // Post 0 is the newest, one minute apart, and all are older than the blocked post.
    let post = |i: usize| {
        let date = format!("2026-10-03T{:02}:{:02}:00Z", 10 - i / 60, 59 - i % 60);
        json!({ "id": format!("post-{i}"), "date_published": date })
    };
    // Post 100, which Alice leaves unread, is just older than the latest 100 of the new feed.
    fixtures.set("/old", Reply::Body(json_feed(json!([blocked, post(100)]))));
    let mut posts: Vec<_> = (0..150).map(post).collect();
    posts.push(blocked);
    fixtures.set("/new", Reply::Body(json_feed(json!(posts))));
    let target = fetch::add_feed(&app.state, &fixtures.url("/new"))
        .await
        .unwrap();
    app.sign_up("alice@example.com").await;
    let alice = app.user_id().await;
    let feed_id: i64 = subscribe(&app, &fixtures.url("/old"), json!({}))
        .await
        .parse()
        .unwrap();
    // Alice's rules blocked the old feed's post when it arrived.
    let block = format!(
        "INSERT INTO blocked_entries SELECT '{alice}', id FROM entries
            WHERE feed_id = {feed_id} AND guid = 'blocked';
        DELETE FROM unreads WHERE entry_id IN (SELECT entry_id FROM blocked_entries)"
    );
    app.state.db.execute_unprepared(&block).await.unwrap();

    fixtures.set("/old", Reply::MovedTo("/new"));
    fetch::refresh_feed(&app.state, feed_id).await.unwrap();

    let sql = "SELECT e.guid FROM unreads u JOIN entries e ON e.id = u.entry_id ORDER BY e.published_at DESC";
    let rows = app
        .state
        .db
        .query_all_raw(Statement::from_string(DbBackend::Postgres, sql))
        .await
        .unwrap();
    let unread: Vec<String> = rows
        .iter()
        .map(|row| row.try_get("", "guid").unwrap())
        .collect();
    let latest: Vec<_> = (0..=100).map(|i| format!("post-{i}")).collect();
    assert_eq!(unread, latest);
    let target_blocked = entries(&app, target.id)
        .await
        .into_iter()
        .find(|entry| entry.guid == "blocked")
        .unwrap();
    let blocks = blocked_entry::Entity::find_by_id((alice, target_blocked.id))
        .one(&app.state.db)
        .await
        .unwrap();
    assert!(blocks.is_some());
}

#[tokio::test]
async fn failed_move_leaves_no_partial_state() {
    let (app, fixtures) = (TestApp::spawn().await, Fixtures::spawn().await);
    fixtures.set("/old", Reply::Body(SINGLE_ITEM_RSS.into()));
    let feed = fetch::add_feed(&app.state, &fixtures.url("/old"))
        .await
        .unwrap();
    refuse_unstorable(&app).await;
    fixtures.set("/new", Reply::Body(unstorable()));
    fixtures.set("/old", Reply::MovedTo("/new"));

    let result = fetch::refresh_feed(&app.state, feed.id).await;

    assert!(matches!(result, Err(FetchError::Db(_))));
    let moved = reload(&app, feed.id).await;
    assert_eq!(moved.url, fixtures.url("/old"));
    assert_eq!(moved.migrate_to, None);
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
async fn claim_due_feeds_respects_ttl_backoff_inflight_and_followers() {
    let app = TestApp::spawn().await;
    // Due times may be up to a tenth later than the TTL or back-off says.
    let feeds = "INSERT INTO feeds (id, url, ttl, checked_at, error_at, refresh_enqueued_at, migrate_to)
        VALUES
        (1, 'default-ttl', NULL, now() - interval '67 minutes', NULL, NULL, NULL),
        (2, 'fresh', NULL, now() - interval '59 minutes', NULL, NULL, NULL),
        (3, 'short-ttl', 15, now() - interval '17 minutes', NULL, NULL, NULL),
        (4, 'ttl-floor', 1, now() - interval '5 minutes', NULL, NULL, NULL),
        (5, 'migrated', NULL, now() - interval '2 hours', NULL, NULL, 1),
        (6, 'in-flight', NULL, now() - interval '2 hours', NULL, now() - interval '1 minute', NULL),
        (7, 'stuck', NULL, now() - interval '2 hours', NULL, now() - interval '11 minutes', NULL),
        (8, 'unfollowed', NULL, now() - interval '2 hours', NULL, NULL, NULL),
        (9, 'ttl-ceiling', 100000, now() - interval '7 hours', NULL, NULL, NULL),
        (10, 'failed-once', NULL, now() - interval '67 minutes', now() - interval '67 minutes', NULL, NULL),
        (11, 'backing-off', NULL, now() - interval '2 hours', now() - interval '5 hours', NULL, NULL),
        (12, 'backed-off', NULL, now() - interval '27 hours', now() - interval '10 days', NULL, NULL)";
    app.state.db.execute_unprepared(feeds).await.unwrap();
    app.insert_user("alice").await;
    let follows = "INSERT INTO subscriptions (user_id, feed_id, view, created_at)
        SELECT 'alice', id, 0, now() FROM feeds WHERE id <> 8";
    app.state.db.execute_unprepared(follows).await.unwrap();

    let due = scheduler::claim_due_feeds(&app.state.db).await.unwrap();
    let mut claimed: Vec<_> = due.iter().map(|feed| feed.id).collect();
    claimed.sort();

    assert_eq!(claimed, [1, 3, 7, 9, 10, 12]);
    assert!(
        scheduler::claim_due_feeds(&app.state.db)
            .await
            .unwrap()
            .is_empty()
    );
}

/// Waits for some request to have been made.
async fn eventually(requests: impl Fn() -> Vec<Recorded>) {
    for _ in 0..100 {
        if !requests().is_empty() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    panic!("no request was made");
}

#[tokio::test]
async fn scheduler_fetches_two_feeds_of_a_host_at_once() {
    let app = TestApp::spawn().await;
    let (busy, other) = (Fixtures::spawn().await, Fixtures::spawn().await);
    let paths = ["/a", "/b", "/c"];
    for path in paths {
        busy.set(path, Reply::Hang);
    }
    other.set("/d", Reply::Hang);
    let urls = paths.map(|path| busy.url(path));
    for (id, url) in urls.iter().chain([&other.url("/d")]).enumerate() {
        let sql = format!(
            "INSERT INTO feeds (id, url, checked_at) VALUES ({}, '{url}', now() - interval '2 hours')",
            id + 1
        );
        app.state.db.execute_unprepared(&sql).await.unwrap();
    }
    app.insert_user("alice").await;
    let follows = "INSERT INTO subscriptions (user_id, feed_id, view, created_at)
        SELECT 'alice', id, 0, now() FROM feeds";
    app.state.db.execute_unprepared(follows).await.unwrap();

    Scheduler::new(app.state.clone()).tick().await;

    eventually(|| other.requests("/d")).await;
    let started = || {
        paths
            .iter()
            .map(|path| busy.requests(path).len())
            .sum::<usize>()
    };
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(started(), 2);
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
