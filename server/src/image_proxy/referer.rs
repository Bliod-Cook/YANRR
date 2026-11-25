//! The request headers image hosts accept, from the rules the clients use too.

use std::sync::LazyLock;

use regex::Regex;
use reqwest::Url;
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Rules {
    user_agent: String,
    referers: Vec<RefererRule>,
}

#[derive(Deserialize)]
struct RefererRule {
    url: String,
    referer: String,
}

struct Compiled {
    user_agent: String,
    referers: Vec<(Regex, String)>,
}

static RULES: LazyLock<Compiled> = LazyLock::new(|| {
    let json = include_str!("../../../packages/internal/utils/src/image-request.json");
    let rules: Rules = serde_json::from_str(json).expect("image-request.json is valid");
    Compiled {
        user_agent: rules.user_agent,
        referers: rules
            .referers
            .into_iter()
            .map(|rule| {
                let pattern = Regex::new(&rule.url).expect("image-request.json patterns compile");
                (pattern, rule.referer)
            })
            .collect(),
    }
});

/// The browser's User-Agent, which some hosts want.
pub fn user_agent() -> &'static str {
    &RULES.user_agent
}

/// The Referer, and Origin, to ask for `url` with: the site its host wants it from, else its own origin.
pub fn referer(url: &Url) -> String {
    RULES
        .referers
        .iter()
        .find(|(pattern, _)| pattern.is_match(url.as_str()))
        .map_or_else(
            || url.origin().ascii_serialization(),
            |(_, site)| site.clone(),
        )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn asks_hotlink_protected_hosts_from_their_site_and_the_rest_from_themselves() {
        let referer = |url: &str| referer(&Url::parse(url).unwrap());
        assert_eq!(
            referer("https://sns-webpic-qc.xhscdn.com/a/b.jpg"),
            "https://www.xiaohongshu.com"
        );
        assert_eq!(
            referer("https://i.pximg.net/img-original/a.png"),
            "https://www.pixiv.net"
        );
        assert_eq!(
            referer("https://cdn.example.com:8443/a.png"),
            "https://cdn.example.com:8443"
        );
    }
}
