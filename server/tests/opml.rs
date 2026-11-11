mod common;

use common::{Fixtures, TestApp, json};
use serde_json::{Value, json};
use yanrr::opml;

fn urls(items: &Value) -> Vec<&str> {
    let items = items.as_array().unwrap();
    items
        .iter()
        .map(|item| item["url"].as_str().unwrap())
        .collect()
}

#[tokio::test]
async fn opml_import_and_export() {
    let fixtures = Fixtures::spawn().await;
    let instance = fixtures.url("/rsshub");
    let app = TestApp::spawn_with(|config| config.rsshub.url = instance.clone()).await;
    app.sign_up("alice@example.com").await;
    let (rss, etag, missing) = (
        fixtures.url("/rss"),
        fixtures.url("/etag"),
        fixtures.url("/missing"),
    );
    let social = "rsshub://social/alice";
    app.post("/api/subscriptions", json!({ "url": etag })).await;
    let file = format!(
        r#"<?xml version="1.0"?><opml version="1.0"><head><title>Old reader</title></head><body>
            <outline text="Tech &amp; Science" title="Tech &amp; Science">
                <outline type="rss" text="Example" title="Example" xmlUrl="{rss}"/>
                <outline text="Nested"><outline type="rss" text="Gone" xmlUrl="{missing}"/></outline>
            </outline>
            <outline type="rss" text="Etag" xmlUrl="{etag}"/>
            <outline type="rss" text="Social" xmlUrl="{social}"/>
        </body></opml>"#
    );

    let parsed = json(
        app.post_bytes("/api/subscriptions/parse-opml", file.clone())
            .await,
    )
    .await;
    let subscriptions: Vec<_> = parsed["data"]["subscriptions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| {
            (
                item["url"].clone(),
                item["category"].clone(),
                item["title"].clone(),
            )
        })
        .collect();
    assert_eq!(
        subscriptions,
        [
            (json!(rss), json!("Tech & Science"), json!("Example")),
            (json!(missing), json!("Nested"), json!("Gone")),
            (json!(etag), Value::Null, json!("Etag")),
            (json!(social), Value::Null, json!("Social")),
        ]
    );
    assert_eq!(parsed["data"]["remaining"], 4);

    // Clients send the feeds picked from what they parsed.
    let picked = json!([
        { "url": rss, "title": "Example", "category": "Tech & Science" },
        { "url": missing, "title": "Gone", "category": "Nested" },
        { "url": etag },
        { "url": rss },
    ]);
    let import = async |body: Value| json(app.post("/api/subscriptions/import", body).await).await;
    let imported = import(json!({ "items": picked })).await;
    let data = &imported["data"];
    assert_eq!(urls(&data["successfulItems"]), [rss.as_str()]);
    assert_eq!(urls(&data["conflictItems"]), [etag.as_str()]);
    assert_eq!(urls(&data["parsedErrorItems"]), [missing.as_str()]);
    assert!(imported["lastSyncId"].is_i64());
    let social_in_view = json!({ "items": [{ "url": social, "title": "Social" }], "view": 1 });
    let social_imported = import(social_in_view.clone()).await;
    assert_eq!(urls(&social_imported["data"]["successfulItems"]), [social]);
    // Nothing new to follow is an answer like any other.
    let again = import(social_in_view).await;
    assert_eq!(urls(&again["data"]["conflictItems"]), [social]);
    assert_eq!(again["data"]["successfulItems"], json!([]));

    let listed = json(app.get("/api/subscriptions").await).await;
    let followed = listed["data"].as_array().unwrap();
    let example = followed.iter().find(|s| s["feeds"]["url"] == rss).unwrap();
    assert_eq!(example["category"], "Tech & Science");
    let social_followed = followed
        .iter()
        .find(|s| s["feeds"]["url"] == social)
        .unwrap();
    assert_eq!(social_followed["view"], 1);

    let export = app
        .get("/api/subscriptions/export?folderMode=category")
        .await;
    assert_eq!(export.headers()["content-type"], "application/xml");
    let mut exported = opml::parse(&export.bytes().await.unwrap()).unwrap();
    exported.sort_by(|a, b| a.url.cmp(&b.url));
    let exported: Vec<_> = exported
        .iter()
        .map(|outline| (outline.url.as_str(), outline.category.as_deref()))
        .collect();
    let expanded = format!("{instance}/social/alice");
    let mut expected = [
        (rss.as_str(), Some("Tech & Science")),
        (etag.as_str(), None),
        (expanded.as_str(), None),
    ];
    expected.sort();
    assert_eq!(exported, expected);
    let by_view = app.get("/api/subscriptions/export").await;
    let by_view = opml::parse(&by_view.bytes().await.unwrap()).unwrap();
    for outline in by_view {
        let view = match outline.url == expanded {
            true => "SocialMedia",
            false => "Articles",
        };
        assert_eq!(outline.category.as_deref(), Some(view), "{}", outline.url);
    }
}
