mod common;

use std::time::Duration;

use common::TestApp;
use sea_orm::{ConnectionTrait, TransactionTrait};
use serde_json::{Value, json};
use yannr::sync::{self, Action};

async fn insert_user(app: &TestApp, id: &str) {
    let sql = format!(
        "INSERT INTO users (id, email, email_verified, created_at, updated_at)
         VALUES ('{id}', '{id}@example.com', false, now(), now())"
    );
    app.state.db.execute_unprepared(&sql).await.unwrap();
}

async fn record(app: &TestApp, user_id: &str) -> i64 {
    let txn = app.state.db.begin().await.unwrap();
    let action = Action {
        model: "setting",
        model_id: Some("general".into()),
        action: "U",
        data: json!({}),
    };
    let id = sync::record(&txn, user_id, vec![action]).await.unwrap();
    txn.commit().await.unwrap();
    id
}

async fn get(app: &TestApp, path: &str) -> Value {
    app.get(path).await.json().await.unwrap()
}

#[tokio::test]
async fn delta_pages_through_own_actions() {
    let app = TestApp::spawn().await;
    app.sign_up("alice@example.com").await;
    insert_user(&app, "bob").await;

    let mut ids = Vec::new();
    for (tab, payload) in [
        ("general", json!({ "a": 1 })),
        ("appearance", json!({ "b": 2 })),
    ] {
        let res: Value = app
            .patch(&format!("/api/settings/{tab}"), payload)
            .await
            .json()
            .await
            .unwrap();
        ids.push(res["lastSyncId"].as_i64().unwrap());
        record(&app, "bob").await;
    }
    let res = app
        .patch("/api/settings/ai", json!({ "apiKey": "secret" }))
        .await;
    ids.push(
        res.json::<Value>().await.unwrap()["lastSyncId"]
            .as_i64()
            .unwrap(),
    );

    assert_eq!(
        get(&app, "/api/sync/state").await["data"]["lastSyncId"],
        ids[2]
    );

    let first = &get(&app, "/api/sync/delta?lastSyncId=0&limit=2").await["data"];
    assert_eq!(first["hasMore"], true);
    assert_eq!(first["reset"], false);
    assert_eq!(first["lastSyncId"], ids[1]);
    let general = &first["actions"][0];
    assert_eq!(general["id"], ids[0]);
    assert_eq!(general["model"], "setting");
    assert_eq!(general["modelId"], "general");
    assert_eq!(general["action"], "U");
    assert_eq!(general["data"]["payload"], json!({ "a": 1 }));
    assert!(general["data"]["updatedAt"].is_string());
    assert!(general["createdAt"].is_string());

    let path = format!("/api/sync/delta?lastSyncId={}&limit=2", ids[1]);
    let second = &get(&app, &path).await["data"];
    assert_eq!(second["hasMore"], false);
    assert_eq!(second["lastSyncId"], ids[2]);
    let ai = &second["actions"][0];
    assert_eq!(second["actions"].as_array().unwrap().len(), 1);
    assert_eq!(ai["modelId"], "ai");
    assert_eq!(ai["data"].get("payload"), None);
}

#[tokio::test]
async fn delta_resets_outside_retained_log() {
    let app = TestApp::spawn().await;
    app.sign_up("alice@example.com").await;
    let user_id = app.session().await["user"]["id"]
        .as_str()
        .unwrap()
        .to_string();
    let old = format!(
        "INSERT INTO sync_actions (user_id, model, model_id, action, data, created_at) VALUES
         ('{user_id}', 'setting', 'general', 'U', '{{}}', now() - interval '31 days'),
         ('{user_id}', 'setting', 'general', 'U', '{{}}', now() - interval '31 days')"
    );
    app.state.db.execute_unprepared(&old).await.unwrap();
    let latest = record(&app, &user_id).await;

    sync::prune(&app.state.db).await.unwrap();

    let expired = &get(&app, "/api/sync/delta?lastSyncId=0").await["data"];
    assert_eq!(expired["reset"], true);
    assert_eq!(expired["lastSyncId"], latest);
    assert_eq!(expired["actions"], json!([]));

    let horizon = &get(&app, &format!("/api/sync/delta?lastSyncId={}", latest - 1)).await["data"];
    assert_eq!(horizon["reset"], false);
    assert_eq!(horizon["actions"][0]["id"], latest);

    let ahead = &get(&app, &format!("/api/sync/delta?lastSyncId={}", latest + 1)).await["data"];
    assert_eq!(ahead["reset"], true);
}

#[tokio::test]
async fn record_commits_in_id_order() {
    let app = TestApp::spawn().await;
    insert_user(&app, "alice").await;

    let first = app.state.db.begin().await.unwrap();
    let action = || Action {
        model: "setting",
        model_id: None,
        action: "U",
        data: json!({}),
    };
    let first_id = sync::record(&first, "alice", vec![action()]).await.unwrap();
    let db = app.state.db.clone();
    let mut second = tokio::spawn(async move {
        let txn = db.begin().await.unwrap();
        let id = sync::record(&txn, "alice", vec![action()]).await.unwrap();
        txn.commit().await.unwrap();
        id
    });

    let blocked = tokio::time::timeout(Duration::from_millis(300), &mut second).await;
    assert!(
        blocked.is_err(),
        "the second writer must wait for the first commit"
    );
    first.commit().await.unwrap();
    assert!(second.await.unwrap() > first_id);
}
