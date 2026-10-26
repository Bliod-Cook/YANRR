mod common;

use common::{TestApp, assert_error, json};
use sea_orm::{ConnectionTrait, DbBackend, Statement};
use serde_json::{Value, json};

#[tokio::test]
async fn rules_round_trip_and_conflict() {
    let app = TestApp::spawn().await;
    app.sign_up("alice@example.com").await;
    assert_eq!(
        json(app.get("/api/actions").await).await["data"],
        Value::Null
    );

    // Older clients wrote a single group flat, and the editor sends its `index` along.
    let flat = json!({
        "name": "Star news",
        "index": 0,
        "condition": [{ "field": "entry_title", "operator": "contains", "value": "news" }],
        "result": { "star": true, "disabled": false },
    });
    let rules = json!([{
        "name": "Star news",
        "condition": [[{ "field": "entry_title", "operator": "contains", "value": "news" }]],
        "result": { "star": true, "disabled": false },
    }]);
    let first = json!({ "rules": [flat], "expectedUpdatedAt": null });
    let saved = json(app.put("/api/actions", first).await).await;
    assert!(saved["lastSyncId"].is_i64());
    let stored = json(app.get("/api/actions").await).await["data"].clone();
    assert_eq!(stored["rules"], rules);
    assert_eq!(stored["updatedAt"], saved["updatedAt"]);
    assert_eq!(stored["userId"], app.user_id().await);

    for stale in [Value::Null, json!("2026-01-01T00:00:00.000Z")] {
        let body = json!({ "rules": [], "expectedUpdatedAt": stale });
        assert_error(app.put("/api/actions", body).await, 409, 12001).await;
    }
    let body = json!({ "rules": [], "expectedUpdatedAt": saved["updatedAt"] });
    let cleared = json(app.put("/api/actions", body).await).await;
    let overwritten = json(app.put("/api/actions", json!({ "rules": rules })).await).await;
    assert_eq!(
        json(app.get("/api/actions").await).await["data"]["rules"],
        rules
    );

    let logged: Vec<_> = app
        .actions()
        .await
        .into_iter()
        .filter(|action| action["model"] == "action")
        .map(|action| {
            (
                action["action"].clone(),
                action["modelId"].clone(),
                action["data"].clone(),
            )
        })
        .collect();
    let updated = |rules: &Value, saved: &Value| {
        let data = json!({ "rules": rules, "updatedAt": saved["updatedAt"] });
        (json!("U"), Value::Null, data)
    };
    assert_eq!(
        logged,
        [
            updated(&rules, &saved),
            updated(&json!([]), &cleared),
            updated(&rules, &overwritten),
        ]
    );
}

#[tokio::test]
async fn invalid_rules_are_refused() {
    let app = TestApp::spawn().await;
    app.sign_up("alice@example.com").await;
    let regex = |pattern: &str| {
        json!({
            "name": "Match",
            "condition": [[{ "field": "entry_title", "operator": "regex", "value": pattern }]],
            "result": { "star": true },
        })
    };
    let refused = async |rules: Value, path: &str| {
        let response = app.put("/api/actions", json!({ "rules": rules })).await;
        assert_eq!(response.status(), 422);
        let body = json(response).await;
        assert_eq!(body["code"], 3);
        let message = body["message"].as_str().unwrap().to_string();
        assert!(message.starts_with(path), "{message}");
    };

    let webhook = json!({ "name": "Forward", "condition": [], "result": { "webhooks": ["ftp://example.com"] } });
    refused(json!([webhook]), "`rules.0.result.webhooks.0`: Invalid URL").await;
    refused(
        json!([regex("ok"), regex("(")]),
        "`rules.1.condition.0.0.value`: Invalid regex",
    )
    .await;

    // A pattern stored before is not checked again, so it does not keep other edits from being saved.
    let stored = json!([regex("(")]);
    let sql = "INSERT INTO action_rules VALUES ($1, $2, now(), now())";
    let values = [app.user_id().await.into(), stored.into()];
    let statement = Statement::from_sql_and_values(DbBackend::Postgres, sql, values);
    app.state.db.execute_raw(statement).await.unwrap();
    let saved = app
        .put(
            "/api/actions",
            json!({ "rules": [regex("("), regex("ok")] }),
        )
        .await;
    assert_eq!(saved.status(), 200);
}
