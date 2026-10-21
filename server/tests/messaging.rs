mod common;

use std::io::Write;

use common::{Fixtures, Reply, TestApp, assert_error, json};
use jsonwebtoken::{Algorithm, DecodingKey, Validation};
use sea_orm::{ConnectionTrait, DbBackend, Statement};
use serde_json::{Value, json};
use yannr::config::PushConfig;

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
    assert_error(app.get("/api/messaging/test").await, 500, 5).await;

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

#[tokio::test]
async fn test_push_sends_through_fcm() {
    let fixtures = Fixtures::spawn().await;
    let token_uri = fixtures.url("/token");
    let send_path = "/v1/projects/yannr-test/messages:send";
    fixtures.set(
        "/token",
        Reply::Body(json!({ "access_token": "fcm-access", "expires_in": 3599 }).to_string()),
    );
    fixtures.set(
        send_path,
        Reply::Body(json!({ "name": "sent" }).to_string()),
    );
    let account = json!({
        "type": "service_account",
        "project_id": "yannr-test",
        "client_email": "push@yannr-test.iam.gserviceaccount.com",
        "private_key": include_str!("fixtures/push-key.pem"),
        "token_uri": token_uri,
    });
    let mut key_file = tempfile::NamedTempFile::new().unwrap();
    key_file.write_all(account.to_string().as_bytes()).unwrap();
    let push = PushConfig {
        firebase_service_account: key_file.path().into(),
        fcm_url: fixtures.url(""),
    };
    let app = TestApp::spawn_with(move |config| config.push = Some(push)).await;
    app.sign_up("alice@example.com").await;
    for (token, channel) in [("mac-token", "macos"), ("phone-token", "ios")] {
        let body = json!({ "token": token, "channel": channel });
        app.post("/api/messaging", body).await;
    }

    let tested = app.get("/api/messaging/test?channel=macos").await;
    assert_eq!(json(tested).await, json!({ "code": 0 }));

    let exchanges = fixtures.requests("/token");
    assert_eq!(exchanges.len(), 1);
    let form = &exchanges[0].body;
    assert!(form.contains("grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer"));
    let assertion = form
        .split('&')
        .find_map(|pair| pair.strip_prefix("assertion="))
        .unwrap();
    let key = DecodingKey::from_rsa_pem(include_bytes!("fixtures/push-key.pub.pem")).unwrap();
    let mut validation = Validation::new(Algorithm::RS256);
    validation.set_audience(&[&token_uri]);
    let claims = jsonwebtoken::decode::<Value>(assertion, &key, &validation)
        .unwrap()
        .claims;
    assert_eq!(claims["iss"], "push@yannr-test.iam.gserviceaccount.com");
    assert_eq!(
        claims["scope"],
        "https://www.googleapis.com/auth/firebase.messaging"
    );

    let sent = fixtures.requests(send_path);
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0].authorization.as_deref(), Some("Bearer fcm-access"));
    let message: Value = serde_json::from_str(&sent[0].body).unwrap();
    assert_eq!(
        message,
        json!({ "message": {
            "token": "mac-token",
            "notification": { "title": "Yannr", "body": "Test notification" },
            "data": {
                "type": "new-entry",
                "feedId": "",
                "entryId": "",
                "view": "0",
                "title": "Yannr",
                "description": "Test notification",
            },
        }})
    );
}
