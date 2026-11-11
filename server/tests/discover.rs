mod common;

use std::collections::HashSet;

use common::{Fixtures, Reply, SINGLE_ITEM_RSS, TWO_ITEM_RSS, TestApp, assert_error, json};
use sea_orm::{EntityTrait, PaginatorTrait};
use serde_json::{Value, json};
use yanrr::entity::feed;

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
async fn rsshub_catalog_and_route() {
    let fixtures = Fixtures::spawn().await;
    let instance = fixtures.url("/hub");
    let app = TestApp::spawn_with(move |config| config.rsshub.url = instance).await;
    app.sign_up("alice@example.com").await;
    let catalog = async |query: &str| app.get(&format!("/api/discover/rsshub{query}")).await;

    let namespaces = include_str!("fixtures/rsshub-namespaces.json");
    fixtures.set("/hub/api/namespace", Reply::Body(namespaces.into()));
    let popular = json(catalog("?categories=popular&lang=en").await).await;
    let routes = &popular["data"]["github"]["routes"];
    assert_eq!(popular["data"].as_object().unwrap().len(), 1);
    assert_eq!(routes.as_object().unwrap().len(), 1);
    assert_eq!(routes["/issue/:user/:repo?"]["name"], "Repo Issues");

    let route = async |route: &str| {
        app.get(&format!("/api/discover/rsshub/route?route={route}"))
            .await
    };
    let found = json(route("/github/issue/:user/:repo%3F").await).await;
    assert_eq!(
        (
            &found["data"]["prefix"],
            &found["data"]["name"],
            &found["data"]["url"],
            &found["data"]["route"]["path"],
        ),
        (
            &json!("github"),
            &json!("GitHub"),
            &json!("github.com"),
            &json!("/issue/:user/:repo?"),
        )
    );
    assert_error(route("/github/nothing").await, 404, 13000).await;
}

#[tokio::test]
async fn an_unavailable_rsshub_is_reported() {
    let fixtures = Fixtures::spawn().await;
    let instance = fixtures.url("/down");
    let app = TestApp::spawn_with(move |config| config.rsshub.url = instance).await;
    app.sign_up("alice@example.com").await;

    let catalog = app.get("/api/discover/rsshub").await;

    assert_error(catalog, 400, 13007).await;
}

#[tokio::test]
async fn feed_detail_with_entries() {
    let (app, fixtures) = (TestApp::spawn().await, Fixtures::spawn().await);
    fixtures.set("/live", Reply::Body(SINGLE_ITEM_RSS.into()));
    let url = fixtures.url("/live");

    // Looking a feed up by URL fetches and stores it, so it takes an account.
    assert_error(app.get(&format!("/api/feeds?url={url}")).await, 401, 1000).await;
    assert!(fixtures.requests("/live").is_empty());
    assert_eq!(feed::Entity::find().count(&app.state.db).await.unwrap(), 0);

    app.sign_up("alice@example.com").await;
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

    let created = json(app.post("/api/subscriptions", json!({ "url": url })).await).await;
    let id = created["feed"]["id"].as_str().unwrap();
    let detail = json(app.get(&format!("/api/feeds?id={id}")).await).await;
    assert_eq!(detail["data"]["subscription"]["feedId"], id);
    assert_eq!(detail["data"]["entries"].as_array().unwrap().len(), 2);
    assert_error(app.get("/api/feeds?id=1").await, 404, 2001).await;
    let missing: Value = json(app.get("/api/feeds").await).await;
    assert_eq!(missing["code"], 2002);

    // A feed's URL may hold a private token, so even stored feeds take an account.
    let signed_out = reqwest::get(format!("{}/api/feeds?id={id}", app.url))
        .await
        .unwrap();
    assert_error(signed_out, 401, 1000).await;
}

#[tokio::test]
async fn discover_fetches_linked_feeds_concurrently_and_once() {
    let (app, fixtures) = (TestApp::spawn().await, Fixtures::spawn().await);
    app.sign_up("alice@example.com").await;
    let page = |paths: &[&str]| {
        let links: String = paths
            .iter()
            .map(|path| {
                format!(r#"<link rel="alternate" type="application/rss+xml" href="{path}">"#)
            })
            .collect();
        Reply::Body(format!(
            "<html><head>{links}</head><body>Blog</body></html>"
        ))
    };
    for path in ["/a", "/b"] {
        fixtures.set(path, Reply::Body(SINGLE_ITEM_RSS.into()));
    }
    fixtures.set("/broken", Reply::Status(404));
    fixtures.set("/site", page(&["/a", "/a", "/broken", "/b"]));
    let body = json!({ "keyword": fixtures.url("/site"), "target": "feeds" });

    let found = json(app.post("/api/discover", body).await).await["data"].clone();
    let urls: Vec<_> = found
        .as_array()
        .unwrap()
        .iter()
        .map(|result| result["feed"]["url"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(urls, [fixtures.url("/a"), fixtures.url("/b")]);
    assert_eq!(fixtures.requests("/a").len(), 1);

    // A feed that does not answer holds up no other.
    fixtures.set("/slow", Reply::Hang);
    fixtures.set("/c", Reply::Body(SINGLE_ITEM_RSS.into()));
    fixtures.set("/slow-site", page(&["/slow", "/c"]));
    let body = json!({ "keyword": fixtures.url("/slow-site"), "target": "feeds" });
    let request = app
        .client
        .post(format!("{}/api/discover", app.url))
        .json(&body)
        .send();
    let pending = tokio::spawn(request);
    for _ in 0..100 {
        if !fixtures.requests("/c").is_empty() {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    assert_eq!(fixtures.requests("/c").len(), 1);
    pending.abort();
}
