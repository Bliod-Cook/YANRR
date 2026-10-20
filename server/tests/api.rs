mod common;

use common::TestApp;
use sea_orm::ConnectionTrait;
use serde_json::{Value, json};

#[tokio::test]
async fn status_configs_is_public() {
    let app = TestApp::spawn().await;

    let res = app.get("/api/status/configs").await;

    assert_eq!(res.status(), 200);
    assert_eq!(
        res.json::<Value>().await.unwrap(),
        json!({ "code": 0, "data": {} })
    );
}

#[tokio::test]
async fn api_errors_use_exception_codes() {
    let app = TestApp::spawn().await;

    let res = app.get("/api/feeds/refresh?id=1").await;
    assert_eq!(res.status(), 401);
    assert_eq!(res.json::<Value>().await.unwrap()["code"], 1000);

    app.sign_up("alice@example.com").await;
    let res = app.get("/api/feeds/refresh").await;
    assert_eq!(res.status(), 400);
    let body: Value = res.json().await.unwrap();
    assert_eq!(body["code"], 4);
    assert!(body["data"].is_array());

    let expire = "UPDATE sessions SET expires_at = now() - interval '1 minute'";
    app.state.db.execute_unprepared(expire).await.unwrap();
    let res = app.get("/api/feeds/refresh?id=1").await;
    assert_eq!(res.status(), 401);
}

#[tokio::test]
async fn web_build_served_with_spa_fallback() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("index.html"), "<html>app</html>").unwrap();
    std::fs::create_dir(dir.path().join("assets")).unwrap();
    std::fs::write(dir.path().join("assets/app.js"), "run()").unwrap();
    let web_dir = dir.path().to_path_buf();
    let app = TestApp::spawn_with(|config| config.server.web_dir = Some(web_dir)).await;

    assert_eq!(
        app.get("/settings/general").await.text().await.unwrap(),
        "<html>app</html>"
    );
    assert_eq!(
        app.get("/assets/app.js").await.text().await.unwrap(),
        "run()"
    );
    let res = app.get("/api/unknown").await;
    assert_eq!(res.status(), 404);
    assert_eq!(res.json::<Value>().await.unwrap()["code"], 6);
}
