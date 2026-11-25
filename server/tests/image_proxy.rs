mod common;

use common::{TestApp, assert_error, json};
use serde_json::{Value, json};
use yanrr::config::ImageProxyConfig;

#[tokio::test]
async fn hands_signed_in_clients_the_image_proxy_they_sign_urls_for() {
    let configured = TestApp::spawn_with(|config| {
        config.image_proxy = Some(ImageProxyConfig {
            url: "https://img.example.com".into(),
            key: "image-proxy-key".into(),
        });
    })
    .await;
    let plain = TestApp::spawn().await;

    assert_error(configured.get("/api/image-proxy").await, 401, 1000).await;
    configured.sign_up("proxy@example.com").await;
    let proxy = json!({ "url": "https://img.example.com", "key": "image-proxy-key" });
    assert_eq!(
        json(configured.get("/api/image-proxy").await).await["data"],
        proxy
    );

    plain.sign_up("plain@example.com").await;
    assert_eq!(
        json(plain.get("/api/image-proxy").await).await["data"],
        Value::Null
    );
}
