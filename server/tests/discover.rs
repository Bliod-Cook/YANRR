mod common;

use std::collections::HashSet;

use common::{Fixtures, Reply, SINGLE_ITEM_RSS, TWO_ITEM_RSS, TestApp, assert_error, json};
use serde_json::{Value, json};

#[tokio::test]
async fn discover_resolves_feeds_and_html_links() {
    let (app, fixtures) = (TestApp::spawn().await, Fixtures::spawn().await);
    app.sign_up("alice@example.com").await;
    let page = format!(
        r#"<html><head>
            <link rel="stylesheet" href="/style.css">
            <link rel="alternate" type="application/rss+xml" href="rss">
            <link rel="alternate" type="application/atom+xml" href="{}">
        </head><body>Blog</body></html>"#,
        fixtures.url("/etag")
    );
    fixtures.set("/site", Reply::Body(page));
    let discover = async |keyword: &str, target: &str| {
        let body = json!({ "keyword": keyword, "target": target });
        json(app.post("/api/discover", body).await).await["data"].clone()
    };

    let feed = discover(&fixtures.url("/rss"), "feeds").await;
    assert_eq!(feed[0]["feed"]["url"], fixtures.url("/rss"));
    assert!(feed[0]["feed"]["id"].is_string());
    assert_eq!(feed[0]["entries"].as_array().unwrap().len(), 2);

    let linked = discover(&fixtures.url("/site"), "feeds").await;
    let urls: HashSet<_> = linked
        .as_array()
        .unwrap()
        .iter()
        .map(|result| result["feed"]["url"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(
        urls,
        HashSet::from([fixtures.url("/rss"), fixtures.url("/etag")])
    );

    assert_eq!(discover("not a url", "feeds").await, json!([]));
    assert_eq!(discover(&fixtures.url("/rss"), "lists").await, json!([]));
}

#[tokio::test]
async fn feed_detail_with_entries() {
    let (app, fixtures) = (TestApp::spawn().await, Fixtures::spawn().await);
    fixtures.set("/live", Reply::Body(SINGLE_ITEM_RSS.into()));
    let url = fixtures.url("/live");

    // Signed out: feed pages are public.
    let detail = json(app.get(&format!("/api/feeds?url={url}")).await).await;
    let data = &detail["data"];
    assert_eq!(data["feed"]["url"], url);
    assert_eq!(data["entries"].as_array().unwrap().len(), 1);
    assert_eq!(
        (&data["readCount"], &data["subscriptionCount"]),
        (&json!(0), &json!(0))
    );
    assert_eq!(data.get("subscription"), None);

    // Nobody follows it, so looking at it again fetches it again.
    fixtures.set("/live", Reply::Body(TWO_ITEM_RSS.into()));
    let detail = json(app.get(&format!("/api/feeds?url={url}")).await).await;
    let guids: Vec<_> = detail["data"]["entries"]
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| entry["guid"].clone())
        .collect();
    assert!(guids.contains(&json!("post-new")));
    let one = json(
        app.get(&format!("/api/feeds?url={url}&entriesLimit=1"))
            .await,
    )
    .await;
    assert_eq!(one["data"]["entries"].as_array().unwrap().len(), 1);
    let too_many = app
        .get(&format!("/api/feeds?url={url}&entriesLimit=13"))
        .await;
    assert_error(too_many, 422, 3).await;

    app.sign_up("alice@example.com").await;
    let created = json(app.post("/api/subscriptions", json!({ "url": url })).await).await;
    let id = created["feed"]["id"].as_str().unwrap();
    let detail = json(app.get(&format!("/api/feeds?id={id}")).await).await;
    assert_eq!(detail["data"]["subscription"]["feedId"], id);
    assert_eq!(detail["data"]["entries"].as_array().unwrap().len(), 2);
    assert_error(app.get("/api/feeds?id=1").await, 404, 2001).await;
    let missing: Value = json(app.get("/api/feeds").await).await;
    assert_eq!(missing["code"], 2002);
}
