mod common;

use common::{FCM_SEND_PATH, Fixtures, TestApp, assert_error, fake_fcm, json};
use jsonwebtoken::{Algorithm, DecodingKey, Validation};
use sea_orm::{ConnectionTrait, DbBackend, Statement};
use serde_json::{Value, json};

/// The `messaging` changes in the signed-in user's log: action, channel and data.
async fn changes(app: &TestApp) -> Vec<(Value, Value, Value)> {
    app.actions()
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
        .collect()
}

fn change(action: &str, channel: &str, token: &str) -> (Value, Value, Value) {
    let data = json!({ "channel": channel, "token": token });
    (json!(action), json!(channel), data)
}

#[tokio::test]
async fn tokens_are_kept_per_device() {
    let app = TestApp::spawn().await;
    app.sign_up("alice@example.com").await;
    let alice = app.user_id().await;
    app.insert_user("bob").await;
    let sql = "INSERT INTO messaging_tokens (user_id, channel, token)
        VALUES ('bob', 'android', 'shared'), ('bob', 'ios', 'bob-phone')";
    app.state.db.execute_unprepared(sql).await.unwrap();
    let register = async |token: &str, channel: &str| {
        let body = json!({ "token": token, "channel": channel });
        app.post("/api/messaging", body).await
    };

    let first = json(register("mac", "macos").await).await;
    assert!(first["lastSyncId"].is_i64());
    register("mac", "macos").await;
    register("other-mac", "macos").await;
    register("phone", "ios").await;
    register("shared", "web").await;
    assert_error(register("fax", "fax").await, 400, 4).await;
    for _ in 0..2 {
        app.delete("/api/messaging", json!({ "token": "phone" }))
            .await;
    }
    app.delete("/api/messaging", json!({ "token": "bob-phone" }))
        .await;
    assert_error(app.get("/api/messaging/test").await, 403, 5).await;

    let tokens = json(app.get("/api/messaging").await).await;
    assert_eq!(
        tokens["data"],
        json!([
            { "userId": alice, "token": "mac", "channel": "macos" },
            { "userId": alice, "token": "other-mac", "channel": "macos" },
            { "userId": alice, "token": "shared", "channel": "web" },
        ])
    );
    assert_eq!(
        changes(&app).await,
        [
            change("U", "macos", "mac"),
            change("U", "macos", "other-mac"),
            change("U", "ios", "phone"),
            change("U", "web", "shared"),
            change("D", "ios", "phone"),
        ]
    );
    // The shared device moved to Alice: Bob loses it and is told so; his phone stays his.
    let sql = "SELECT
            (SELECT count(*) FROM messaging_tokens WHERE user_id = 'bob') AS tokens,
            (SELECT count(*) FROM sync_actions
             WHERE user_id = 'bob' AND model = 'messaging' AND action = 'D' AND model_id = 'android'
                AND data->>'token' = 'shared') AS removals";
    let bob = app
        .state
        .db
        .query_one_raw(Statement::from_string(DbBackend::Postgres, sql))
        .await
        .unwrap()
        .unwrap();
    let count = |column| bob.try_get::<i64>("", column).unwrap();
    assert_eq!((count("tokens"), count("removals")), (1, 1));
}

#[tokio::test]
async fn test_push_sends_through_fcm() {
    let fixtures = Fixtures::spawn().await;
    let token_uri = fixtures.url("/token");
    let (push, _key_file) = fake_fcm(&fixtures);
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
    assert_eq!(claims["iss"], "push@yanrr-test.iam.gserviceaccount.com");
    assert_eq!(
        claims["scope"],
        "https://www.googleapis.com/auth/firebase.messaging"
    );

    let sent = fixtures.requests(FCM_SEND_PATH);
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0].authorization.as_deref(), Some("Bearer fcm-access"));
    let message: Value = serde_json::from_str(&sent[0].body).unwrap();
    assert_eq!(
        message,
        json!({ "message": {
            "token": "mac-token",
            "notification": { "title": "Yanrr", "body": "Test notification" },
            "data": {
                "type": "new-entry",
                "feedId": "",
                "entryId": "",
                "view": "0",
                "title": "Yanrr",
                "description": "Test notification",
            },
        }})
    );
}

#[tokio::test]
async fn push_reaches_every_device_and_forgets_unregistered_ones() {
    let fixtures = Fixtures::spawn().await;
    let (push, _key_file) = fake_fcm(&fixtures);
    let app = TestApp::spawn_with(move |config| config.push = Some(push)).await;
    app.sign_up("alice@example.com").await;
    for (token, channel) in [
        ("gone-token", "macos"),
        ("phone-token", "ios"),
        ("denied-token", "android"),
    ] {
        let body = json!({ "token": token, "channel": channel });
        app.post("/api/messaging", body).await;
    }

    // A device FCM no longer knows is forgotten, which is no failure.
    let tested = app.get("/api/messaging/test?channel=macos").await;
    assert_eq!(json(tested).await, json!({ "code": 0 }));
    let kept: Vec<_> = json(app.get("/api/messaging").await).await["data"]
        .as_array()
        .unwrap()
        .iter()
        .map(|token| token["token"].clone())
        .collect();
    assert_eq!(kept, ["denied-token", "phone-token"]);
    let forgotten = changes(&app).await.pop();
    assert_eq!(forgotten, Some(change("D", "macos", "gone-token")));

    // A refused device fails the test push, after every device was tried; what FCM said stays in the log.
    let tested = app.get("/api/messaging/test").await;
    assert_eq!(tested.status(), 500);
    let tested = json(tested).await;
    assert_eq!(tested["code"], 1005);
    let message = tested["message"].as_str().unwrap();
    assert!(!message.contains("PERMISSION_DENIED"), "{message}");
    let mut tried: Vec<_> = fixtures
        .requests(FCM_SEND_PATH)
        .iter()
        .map(|sent| serde_json::from_str::<Value>(&sent.body).unwrap()["message"]["token"].clone())
        .collect();
    tried.sort_by_key(|token| token.to_string());
    assert_eq!(tried, ["denied-token", "gone-token", "phone-token"]);
    // The access token is kept for the next notification.
    assert_eq!(fixtures.requests("/token").len(), 1);
}
