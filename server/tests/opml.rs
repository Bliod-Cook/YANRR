mod common;

use common::{Fixtures, TestApp, json};
use reqwest::multipart::{Form, Part};
use serde_json::{Value, json};
use yannr::opml;

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

    let import = |items: Option<Value>| {
        let mut form = Form::new().part("file", Part::text(file.clone()).file_name("feeds.opml"));
        if let Some(items) = items {
            form = form.text("items", items.to_string());
        }
        app.post_form("/api/subscriptions/import", form)
    };
    let imported = json(import(Some(json!([rss, missing, etag]))).await).await;
    let data = &imported["data"];
    assert_eq!(urls(&data["successfulItems"]), [rss.as_str()]);
    assert_eq!(urls(&data["conflictItems"]), [etag.as_str()]);
    assert_eq!(urls(&data["parsedErrorItems"]), [missing.as_str()]);
    assert!(imported["lastSyncId"].is_i64());
    let everything = json(import(None).await).await;
    assert_eq!(urls(&everything["data"]["successfulItems"]), [social]);

    let listed = json(app.get("/api/subscriptions").await).await;
    let followed = listed["data"].as_array().unwrap();
    let example = followed.iter().find(|s| s["feeds"]["url"] == rss).unwrap();
    assert_eq!(example["category"], "Tech & Science");

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
    assert!(
        by_view
            .iter()
            .all(|outline| outline.category.as_deref() == Some("Articles"))
    );
}
