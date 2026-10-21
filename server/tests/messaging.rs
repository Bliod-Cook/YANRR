mod common;

use common::{TestApp, assert_error, json};
use sea_orm::{ConnectionTrait, DbBackend, Statement};
use serde_json::json;

#[tokio::test]
async fn tokens_replace_per_channel() {
    let app = TestApp::spawn().await;
    app.sign_up("alice@example.com").await;
    let alice = app.user_id().await;
    app.insert_user("bob").await;
    let sql = "INSERT INTO messaging_tokens VALUES ('bob', 'android', 'shared')";
    app.state.db.execute_unprepared(sql).await.unwrap();
    let register = async |token: &str, channel: &str| {
        let body = json!({ "token": token, "channel": channel });
        app.post("/api/messaging", body).await
    };

    let first = json(register("a", "macos").await).await;
    assert!(first["lastSyncId"].is_i64());
    register("b", "macos").await;
    register("c", "ios").await;
    register("shared", "web").await;
    assert_error(register("d", "fax").await, 400, 4).await;
    for _ in 0..2 {
        app.delete("/api/messaging", json!({ "channel": "ios" }))
            .await;
    }

    let tokens = json(app.get("/api/messaging").await).await;
    assert_eq!(
        tokens["data"],
        json!([
            { "userId": alice, "token": "b", "channel": "macos" },
            { "userId": alice, "token": "shared", "channel": "web" },
        ])
    );
    let logged: Vec<_> = app
        .actions()
        .await
        .into_iter()
        .filter(|action| action["model"] == "messaging")
        .map(|action| {
            (
                action["action"].clone(),
                action["modelId"].clone(),
                action["data"].clone(),
            )
        })
        .collect();
    let change = |action: &str, channel: &str| {
        (json!(action), json!(channel), json!({ "channel": channel }))
    };
    assert_eq!(
        logged,
        [
            change("U", "macos"),
            change("U", "macos"),
            change("U", "ios"),
            change("U", "web"),
            change("D", "ios"),
        ]
    );
    // The shared device moved to Alice: Bob loses it and is told so.
    let sql = "SELECT
            (SELECT count(*) FROM messaging_tokens WHERE user_id = 'bob') AS tokens,
            (SELECT count(*) FROM sync_actions
             WHERE user_id = 'bob' AND model = 'messaging' AND action = 'D' AND model_id = 'android') AS removals";
    let bob = app
        .state
        .db
        .query_one_raw(Statement::from_string(DbBackend::Postgres, sql))
        .await
        .unwrap()
        .unwrap();
    let count = |column| bob.try_get::<i64>("", column).unwrap();
    assert_eq!((count("tokens"), count("removals")), (0, 1));
}
