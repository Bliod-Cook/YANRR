mod common;

use common::TestApp;
use serde_json::{Value, json};

#[tokio::test]
async fn settings_round_trip() {
    let app = TestApp::spawn().await;
    app.sign_up("alice@example.com").await;

    let empty: Value = app.get("/api/settings").await.json().await.unwrap();
    assert_eq!(empty, json!({ "code": 0, "settings": {}, "updated": {} }));

    for patch in [json!({ "a": 1 }), json!({ "b": 2 })] {
        let res: Value = app
            .patch("/api/settings/general", patch)
            .await
            .json()
            .await
            .unwrap();
        assert_eq!(res["code"], 0);
        assert!(res["lastSyncId"].is_u64());
    }
    app.patch("/api/settings/appearance", json!({ "c": 3 }))
        .await;

    let all: Value = app.get("/api/settings").await.json().await.unwrap();
    assert_eq!(all["settings"]["general"], json!({ "a": 1, "b": 2 }));
    assert!(all["updated"]["general"].is_string());
    let general: Value = app
        .get("/api/settings?tab=general")
        .await
        .json()
        .await
        .unwrap();
    assert_eq!(
        general["settings"],
        json!({ "general": { "a": 1, "b": 2 } })
    );
}

#[tokio::test]
async fn settings_rejects_bad_tab_and_payload() {
    let app = TestApp::spawn().await;
    app.sign_up("alice@example.com").await;

    // No client keeps an integration tab; one would put third-party tokens into the change log.
    let res = app.patch("/api/settings/integration", json!({})).await;
    assert_eq!(res.status(), 400);
    assert_eq!(res.json::<Value>().await.unwrap()["code"], 7001);

    let res = app.patch("/api/settings/general", json!([1])).await;
    assert_eq!(res.status(), 400);
    assert_eq!(res.json::<Value>().await.unwrap()["code"], 7002);
}
