mod common;

use std::io::Read;

use common::{Fixtures, TestApp, assert_error, fake_ai, fake_fcm};
use flate2::read::GzDecoder;
use reqwest::header;
use sea_orm::ConnectionTrait;
use serde_json::{Value, json};

#[tokio::test]
async fn status_configs_tells_signed_out_clients_what_is_offered() {
    let fixtures = Fixtures::spawn().await;
    let (push, _key_file) = fake_fcm(&fixtures);
    let ai = fake_ai(&fixtures);
    let plain = TestApp::spawn().await;
    let configured = TestApp::spawn_with(move |config| {
        config.ai = Some(ai);
        config.push = Some(push);
        config.auth.registration = false;
        config.mcp.enabled = true;
    })
    .await;

    let res = plain.get("/api/status/configs").await;

    assert_eq!(res.status(), 200);
    let offered = json!({ "ai": false, "registration": true, "push": false, "mcp": false });
    assert_eq!(
        res.json::<Value>().await.unwrap(),
        json!({ "code": 0, "data": offered })
    );
    let res = configured.get("/api/status/configs").await;
    let offered = json!({ "ai": true, "registration": false, "push": true, "mcp": true });
    assert_eq!(res.json::<Value>().await.unwrap()["data"], offered);
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

    // A session that cannot be looked up is the server's failure, not a signed-out client.
    let gone = "ALTER TABLE sessions RENAME TO sessions_gone";
    app.state.db.execute_unprepared(gone).await.unwrap();
    assert_error(app.get("/api/feeds/refresh?id=1").await, 500, 1005).await;
}

#[tokio::test]
async fn web_build_served_with_spa_fallback() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("index.html"), "<html>app</html>").unwrap();
    std::fs::create_dir(dir.path().join("assets")).unwrap();
    let script = "run();\n".repeat(100);
    std::fs::write(dir.path().join("assets/app.js"), &script).unwrap();
    let web_dir = dir.path().to_path_buf();
    let app = TestApp::spawn_with(|config| config.server.web_dir = Some(web_dir)).await;
    let cache_control = |res: &reqwest::Response| res.headers()[header::CACHE_CONTROL].clone();

    let page = app.get("/settings/general").await;
    assert_eq!(cache_control(&page), "no-cache");
    assert_eq!(page.text().await.unwrap(), "<html>app</html>");
    let res = app.get("/favicon.ico").await;
    assert_eq!(res.text().await.unwrap(), "<html>app</html>");

    let asset = app.get("/assets/app.js").await;
    assert_eq!(cache_control(&asset), "public, max-age=31536000, immutable");
    assert_eq!(asset.text().await.unwrap(), script);
    // A chunk an old page asks for after an upgrade is missing, not the page.
    let missing = app.get("/assets/gone.js").await;
    assert_eq!(missing.status(), 404);
    assert_eq!(missing.headers().get(header::CACHE_CONTROL), None);

    let res = app.get("/api/unknown").await;
    assert_eq!(res.status(), 404);
    assert_eq!(res.json::<Value>().await.unwrap()["code"], 6);

    let raw = reqwest::Client::builder().no_gzip().build().unwrap();
    let res = raw
        .get(format!("{}/assets/app.js", app.url))
        .header(header::ACCEPT_ENCODING, "gzip")
        .send()
        .await
        .unwrap();
    assert_eq!(res.headers()[header::CONTENT_ENCODING], "gzip");
    let mut decoded = String::new();
    GzDecoder::new(&res.bytes().await.unwrap()[..])
        .read_to_string(&mut decoded)
        .unwrap();
    assert_eq!(decoded, script);
}
