mod common;

use common::{PASSWORD, TestApp};
use serde_json::{Value, json};

const EMAIL: &str = "alice@example.com";

#[tokio::test]
async fn sign_up_sign_in_and_out() {
    let app = TestApp::spawn().await;

    app.sign_up(EMAIL).await;
    assert_eq!(app.session().await["user"]["email"], EMAIL);

    assert_eq!(
        app.post("/api/better-auth/sign-out", json!({}))
            .await
            .status(),
        200
    );
    assert_eq!(app.session().await, Value::Null);

    let credentials = json!({ "email": EMAIL, "password": PASSWORD });
    let res = app
        .post("/api/better-auth/sign-in/email", credentials)
        .await;
    assert_eq!(res.status(), 200);
    assert_eq!(app.session().await["user"]["email"], EMAIL);
}

#[tokio::test]
async fn update_profile_and_change_password() {
    let app = TestApp::spawn().await;
    app.sign_up(EMAIL).await;

    let profile = json!({ "name": "Alice", "image": "https://example.com/alice.png" });
    assert_eq!(
        app.post("/api/better-auth/update-user", profile)
            .await
            .status(),
        200
    );
    let user = &app.session().await["user"];
    assert_eq!(user["name"], "Alice");
    assert_eq!(user["image"], "https://example.com/alice.png");

    let change = json!({
        "currentPassword": PASSWORD,
        "newPassword": "new-password-456",
        "revokeOtherSessions": true,
    });
    assert_eq!(
        app.post("/api/better-auth/change-password", change)
            .await
            .status(),
        200
    );
    app.post("/api/better-auth/sign-out", json!({})).await;

    let sign_in = |password| json!({ "email": EMAIL, "password": password });
    let res = app
        .post("/api/better-auth/sign-in/email", sign_in(PASSWORD))
        .await;
    assert_eq!(res.status(), 401);
    let res = app
        .post(
            "/api/better-auth/sign-in/email",
            sign_in("new-password-456"),
        )
        .await;
    assert_eq!(res.status(), 200);
}

#[tokio::test]
async fn registration_disabled_rejects_sign_up() {
    let app = TestApp::spawn_with(|config| config.auth.registration = false).await;

    let body = json!({ "email": EMAIL, "password": PASSWORD, "name": "alice" });
    let res = app.post("/api/better-auth/sign-up/email", body).await;

    assert_eq!(res.status(), 404);
}
