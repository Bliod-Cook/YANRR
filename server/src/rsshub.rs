//! The route catalog of the configured RSSHub instance.

use std::{
    collections::BTreeMap,
    sync::Arc,
    time::{Duration, Instant},
};

use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tokio::sync::Mutex;

use crate::fetch::http::{self, Validators};

/// How long a fetched catalog is served before the instance is asked again.
const TTL: Duration = Duration::from_secs(60 * 60);

/// Namespaces by their key, the first segment of their routes.
pub type Namespaces = BTreeMap<String, Namespace>;

#[derive(Clone, Deserialize, Serialize)]
pub struct Namespace {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub lang: String,
    #[serde(default)]
    pub routes: BTreeMap<String, Route>,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct Route {
    /// The route's key. RSSHub lists a route with several paths under each of them but keeps the whole list
    /// here, which clients cannot read.
    #[serde(skip_deserializing)]
    pub path: String,
    #[serde(default)]
    pub categories: Vec<String>,
    #[serde(default)]
    pub example: String,
    /// Descriptions by parameter name: a string, or an object with a description, default and options.
    #[serde(default)]
    pub parameters: Map<String, Value>,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub maintainers: Vec<String>,
    #[serde(default)]
    pub location: String,
    #[serde(default)]
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub view: Option<i16>,
}

/// The catalog, fetched when first asked for and again once it is older than [`TTL`].
#[derive(Default)]
pub struct Catalog {
    cached: Mutex<Option<(Instant, Arc<Namespaces>)>>,
}

impl Catalog {
    pub async fn namespaces(
        &self,
        client: &Client,
        instance: &str,
    ) -> Result<Arc<Namespaces>, String> {
        // Held while fetching, so concurrent requests wait for one fetch instead of each starting their own.
        let mut cached = self.cached.lock().await;
        if let Some((fetched_at, namespaces)) = &*cached
            && fetched_at.elapsed() < TTL
        {
            return Ok(namespaces.clone());
        }
        let url = format!("{}/api/namespace", instance.trim_end_matches('/'));
        let fetched = http::get(client, &url, &Validators::default())
            .await?
            .ok_or("HTTP 304")?;
        let namespaces = Arc::new(parse(&fetched.body)?);
        *cached = Some((Instant::now(), namespaces.clone()));
        Ok(namespaces)
    }
}

fn parse(body: &[u8]) -> Result<Namespaces, String> {
    let mut namespaces: Namespaces = serde_json::from_slice(body).map_err(|err| err.to_string())?;
    for namespace in namespaces.values_mut() {
        for (path, route) in &mut namespace.routes {
            route.path = path.clone();
        }
    }
    Ok(namespaces)
}

/// What `GET /discover/rsshub` narrows the catalog to.
#[derive(Default, Deserialize)]
pub struct Filter {
    category: Option<String>,
    namespace: Option<String>,
    lang: Option<String>,
    /// Comma-separated, each required like `category`.
    categories: Option<String>,
}

/// The namespaces `filter` matches, with only the routes in every category it names. Namespaces left without
/// routes are dropped: clients expect each to have one.
pub fn select(namespaces: &Namespaces, filter: &Filter) -> Namespaces {
    let categories: Vec<_> = filter
        .category
        .iter()
        .map(String::as_str)
        .chain(filter.categories.iter().flat_map(|list| list.split(',')))
        .filter(|category| !category.is_empty())
        .collect();
    namespaces
        .iter()
        .filter(|(key, namespace)| {
            filter
                .namespace
                .as_ref()
                .is_none_or(|wanted| wanted == *key)
                && filter
                    .lang
                    .as_ref()
                    .is_none_or(|lang| *lang == namespace.lang)
        })
        .filter_map(|(key, namespace)| {
            let routes: BTreeMap<_, _> = namespace
                .routes
                .iter()
                .filter(|(_, route)| {
                    categories
                        .iter()
                        .all(|wanted| route.categories.iter().any(|category| category == wanted))
                })
                .map(|(path, route)| (path.clone(), route.clone()))
                .collect();
            let namespace = Namespace {
                name: namespace.name.clone(),
                url: namespace.url.clone(),
                description: namespace.description.clone(),
                lang: namespace.lang.clone(),
                routes,
            };
            (!namespace.routes.is_empty()).then(|| (key.clone(), namespace))
        })
        .collect()
}

/// The namespace key, namespace and route a path like `/github/issue/:user/:repo?` names.
pub fn find<'a>(
    namespaces: &'a Namespaces,
    route: &str,
) -> Option<(&'a str, &'a Namespace, &'a Route)> {
    let route = route.trim_start_matches('/');
    let (prefix, path) = route.split_once('/').unwrap_or((route, ""));
    let (prefix, namespace) = namespaces.get_key_value(prefix)?;
    let route = namespace.routes.get(&format!("/{path}"))?;
    Some((prefix, namespace, route))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn catalog() -> Namespaces {
        parse(include_bytes!("../tests/fixtures/rsshub-namespaces.json")).unwrap()
    }

    /// Route keys by namespace key.
    fn keys(namespaces: Namespaces) -> Value {
        let keys: Map<_, _> = namespaces
            .into_iter()
            .map(|(key, namespace)| (key, json!(namespace.routes.into_keys().collect::<Vec<_>>())))
            .collect();
        Value::Object(keys)
    }

    #[test]
    fn select_filters_routes() {
        let catalog = catalog();
        let select = |query: Value| keys(select(&catalog, &serde_json::from_value(query).unwrap()));

        assert_eq!(
            select(json!({})),
            json!({
                "bilibili": ["/user/dynamic/:uid"],
                "github": ["/issue/:user/:repo?", "/trending/:since"],
            })
        );
        assert_eq!(
            select(json!({ "categories": "popular" })),
            json!({ "bilibili": ["/user/dynamic/:uid"], "github": ["/issue/:user/:repo?"] })
        );
        assert_eq!(
            select(json!({ "category": "programming", "categories": "popular" })),
            json!({ "github": ["/issue/:user/:repo?"] })
        );
        assert_eq!(
            select(json!({ "categories": "popular", "lang": "zh-CN" })),
            json!({ "bilibili": ["/user/dynamic/:uid"] })
        );
        assert_eq!(
            select(json!({ "namespace": "github", "category": "programming" })),
            json!({ "github": ["/issue/:user/:repo?", "/trending/:since"] })
        );
    }

    #[test]
    fn routes_are_written_with_their_key_and_defaults() {
        let catalog = catalog();
        let (prefix, namespace, route) = find(&catalog, "github/trending/:since").unwrap();
        assert_eq!((prefix, namespace.name.as_str()), ("github", "GitHub"));
        assert_eq!(
            serde_json::to_value(route).unwrap(),
            json!({
                "path": "/trending/:since",
                "categories": ["programming"],
                "example": "",
                "parameters": {},
                "name": "Trending",
                "maintainers": ["DIYgod"],
                "location": "trending.ts",
                "description": "",
            })
        );
        assert!(find(&catalog, "/github/issue/:user/:repo?").is_some());
        assert!(find(&catalog, "/github/nothing").is_none());
    }
}
