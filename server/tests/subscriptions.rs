mod common;

use common::{Fixtures, TestApp, assert_error, json};
use sea_orm::{EntityTrait, PaginatorTrait};
use serde_json::{Value, json};
use yanrr::entity::unread;

#[tokio::test]
async fn subscription_lifecycle() {
    let (app, fixtures) = (TestApp::spawn().await, Fixtures::spawn().await);
    app.sign_up("alice@example.com").await;
    let url = fixtures.url("/rss");
    let form = json!({
        "url": url, "view": 1, "category": "Tech", "title": "", "hideFromTimeline": true,
    });

    let created = json(app.post("/api/subscriptions", form.clone()).await).await;
    let feed_id = created["feed"]["id"].as_str().unwrap().to_string();
    assert_eq!(created["feed"]["url"], url);
    assert_eq!(created["list"], Value::Null);
    assert_eq!(created["unread"][&feed_id], 2);
    let again = json(app.post("/api/subscriptions", form).await).await;
    assert!(again["lastSyncId"].as_i64() > created["lastSyncId"].as_i64());

    let listed = json(app.get("/api/subscriptions").await).await;
    let subscription = &listed["data"][0];
    assert_eq!(subscription["feedId"], feed_id);
    assert_eq!(subscription["feeds"]["id"], feed_id);
    assert_eq!(subscription["view"], 1);
    assert_eq!(subscription["category"], "Tech");
    assert_eq!(subscription["title"], Value::Null);
    assert_eq!(subscription["hideFromTimeline"], true);
    assert_eq!(subscription["isPrivate"], false);
    assert_eq!(subscription.get("lists"), None);
    let other_view = json(app.get("/api/subscriptions?view=0").await).await;
    assert_eq!(other_view["data"], json!([]));

    let title = json!({ "feedId": feed_id, "title": "Mine" });
    app.patch("/api/subscriptions", title).await;
    let view = json!({ "feedIds": [feed_id], "view": 2 });
    app.patch("/api/subscriptions/batch", view).await;
    let subscription = &json(app.get("/api/subscriptions").await).await["data"][0];
    assert_eq!(subscription["title"], "Mine");
    assert_eq!(subscription["category"], "Tech");
    assert_eq!(subscription["view"], 2);

    let deleted = app
        .delete("/api/subscriptions", json!({ "feedIdList": [feed_id] }))
        .await;
    assert!(json(deleted).await["lastSyncId"].is_i64());
    let listed = json(app.get("/api/subscriptions").await).await;
    assert_eq!(listed["data"], json!([]));
    let unread = unread::Entity::find().count(&app.state.db).await.unwrap();
    assert_eq!(unread, 0);

    let actions = app.actions().await;
    let kinds: Vec<_> = actions
        .iter()
        .map(|action| (action["model"].as_str(), action["action"].as_str()))
        .collect();
    let subscription = |action| (Some("subscription"), Some(action));
    assert_eq!(kinds, ["I", "I", "U", "U", "D"].map(subscription).to_vec());
    assert!(actions.iter().all(|action| action["modelId"] == feed_id));
    assert_eq!(actions[0]["data"]["feeds"]["url"], url);
    assert_eq!(actions[2]["data"], json!({ "title": "Mine" }));
    assert_eq!(actions[3]["data"], json!({ "view": 2 }));
    assert_eq!(actions[4]["data"], Value::Null);
}

#[tokio::test]
async fn subscription_input_errors() {
    let (app, fixtures) = (TestApp::spawn().await, Fixtures::spawn().await);
    app.sign_up("alice@example.com").await;

    let post = |body| app.post("/api/subscriptions", body);
    assert_error(post(json!({})).await, 422, 2002).await;
    let bad_view = json!({ "url": fixtures.url("/rss"), "view": 9 });
    assert_error(post(bad_view).await, 422, 3).await;
    assert_error(post(json!({ "feedId": "1" })).await, 404, 2001).await;
    let unreachable = json!({ "url": fixtures.url("/missing") });
    assert_error(post(unreachable).await, 400, 2003).await;
    let patch = json!({ "feedId": "1", "title": "x" });
    assert_error(app.patch("/api/subscriptions", patch).await, 404, 6).await;
}

#[tokio::test]
async fn categories_rename_and_delete() {
    let (app, fixtures) = (TestApp::spawn().await, Fixtures::spawn().await);
    app.sign_up("alice@example.com").await;
    let mut ids = Vec::new();
    for (path, view) in [("/rss", 0), ("/etag", 1)] {
        let form = json!({ "url": fixtures.url(path), "view": view, "category": "News" });
        let created = json(app.post("/api/subscriptions", form).await).await;
        ids.push(created["feed"]["id"].as_str().unwrap().to_string());
    }
    let [articles, social] = &ids[..] else {
        unreachable!()
    };
    let categories = async || {
        let listed = json(app.get("/api/subscriptions").await).await;
        let category = |id: &str| {
            let subscriptions = listed["data"].as_array().unwrap();
            let subscription = subscriptions.iter().find(|s| s["feedId"] == id);
            subscription.map(|s| s["category"].clone())
        };
        (category(articles), category(social))
    };

    let rename = json!({ "from": "News", "to": "Daily", "view": 0 });
    app.patch("/api/categories", rename).await;
    assert_eq!(
        categories().await,
        (Some(json!("Daily")), Some(json!("News")))
    );
    let assign = json!({ "feedIdList": [social], "category": "Daily" });
    app.patch("/api/categories", assign).await;
    assert_eq!(
        categories().await,
        (Some(json!("Daily")), Some(json!("Daily")))
    );
    let clear = json!({ "feedIdList": [articles], "deleteSubscriptions": false });
    app.delete("/api/categories", clear).await;
    let unfollow = json!({ "feedIdList": [social], "deleteSubscriptions": true });
    app.delete("/api/categories", unfollow).await;
    assert_eq!(categories().await, (Some(Value::Null), None));

    let actions = app.actions().await;
    let logged: Vec<_> = actions[2..]
        .iter()
        .map(|action| (&action["action"], &action["modelId"], &action["data"]))
        .collect();
    let u = json!("U");
    let d = json!("D");
    let (articles, social) = (json!(articles), json!(social));
    let daily = json!({ "category": "Daily" });
    let cleared = json!({ "category": null });
    assert_eq!(
        logged,
        [
            (&u, &articles, &daily),
            (&u, &social, &daily),
            (&u, &articles, &cleared),
            (&d, &social, &Value::Null),
        ]
    );
}
