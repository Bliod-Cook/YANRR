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
/// How long the old catalog, or the failure when there is none, is served after fetching a new one failed.
const RETRY: Duration = Duration::from_secs(60);

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

/// The catalog, fetched when first asked for and again, in the background, once it is older than [`TTL`].
#[derive(Default)]
pub struct Catalog {
    cached: Mutex<Option<Cached>>,
    /// Held while fetching, so that one request at a time asks the instance.
    fetching: Mutex<()>,
}

/// What the last fetch left, the catalog or why there is none, and until when it is served without asking the
/// instance.
#[derive(Clone)]
struct Cached {
    until: Instant,
    namespaces: Result<Arc<Namespaces>, String>,
}

impl Catalog {
    /// The catalog of `instance`. A stale one is served at once while a fresh one is fetched; with none, the
    /// request waits for the fetch, and its failure is served for [`RETRY`] rather than asking again.
    pub async fn namespaces(
        self: &Arc<Self>,
        client: &Client,
        instance: &str,
    ) -> Result<Arc<Namespaces>, String> {
        let cached = self.cached.lock().await.clone();
        match cached {
            Some(cached) if Instant::now() < cached.until => cached.namespaces,
            Some(Cached {
                namespaces: Ok(stale),
                ..
            }) => {
                if self.fetching.try_lock().is_ok() {
                    let (catalog, client, instance) =
                        (self.clone(), client.clone(), instance.to_owned());
                    tokio::spawn(async move { catalog.refresh(&client, &instance).await });
                }
                Ok(stale)
            }
            _ => self.refresh(client, instance).await,
        }
    }

    /// Fetches the catalog, unless another request did while this one waited, and caches what came of it.
    async fn refresh(&self, client: &Client, instance: &str) -> Result<Arc<Namespaces>, String> {
        let _fetching = self.fetching.lock().await;
        if let Some(cached) = &*self.cached.lock().await
            && Instant::now() < cached.until
        {
            return cached.namespaces.clone();
        }
        let fetched = fetch(client, instance).await;
        let mut cached = self.cached.lock().await;
        let stale = cached.take().and_then(|cached| cached.namespaces.ok());
        let (namespaces, fresh_for) = match (fetched, stale) {
            (Ok(namespaces), _) => (Ok(Arc::new(namespaces)), TTL),
            // The old catalog beats none while the instance is down; it is asked again shortly.
            (Err(err), Some(stale)) => {
                tracing::warn!("RSSHub catalog refetch failed: {err}");
                (Ok(stale), RETRY)
            }
            (Err(err), None) => (Err(err), RETRY),
        };
        *cached = Some(Cached {
            until: Instant::now() + fresh_for,
            namespaces: namespaces.clone(),
        });
        namespaces
    }
}

async fn fetch(client: &Client, instance: &str) -> Result<Namespaces, String> {
    let url = format!("{}/api/namespace", instance.trim_end_matches('/'));
    http::get(client, &url, &Validators::default())
        .await
        .and_then(|fetched| fetched.ok_or("HTTP 304".into()))
        .and_then(|fetched| parse(&fetched.body))
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
    use std::sync::atomic::{AtomicUsize, Ordering};

    use axum::{Router, http::StatusCode, routing::get};
    use serde_json::json;
    use tokio::net::TcpListener;

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

    /// An RSSHub instance whose catalog fails, or never comes when `hang`, and how often it was asked for.
    async fn broken_instance(hang: bool) -> (String, Arc<AtomicUsize>) {
        let requests = Arc::new(AtomicUsize::new(0));
        let counter = requests.clone();
        let router = Router::new().route(
            "/api/namespace",
            get(move || async move {
                counter.fetch_add(1, Ordering::SeqCst);
                if hang {
                    std::future::pending::<()>().await;
                }
                StatusCode::SERVICE_UNAVAILABLE
            }),
        );
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let instance = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
        (instance, requests)
    }

    /// A catalog holding `old`, which has just gone stale.
    async fn stale(old: &Arc<Namespaces>) -> Arc<Catalog> {
        let catalog = Arc::new(Catalog::default());
        *catalog.cached.lock().await = Some(Cached {
            until: Instant::now(),
            namespaces: Ok(old.clone()),
        });
        catalog
    }

    fn client() -> Client {
        Client::builder().no_proxy().build().unwrap()
    }

    #[tokio::test]
    async fn a_stale_catalog_is_served_at_once_while_a_fresh_one_is_fetched() {
        let (instance, requests) = broken_instance(true).await;
        let old = Arc::new(catalog());
        let catalog = stale(&old).await;

        let served = tokio::time::timeout(
            Duration::from_secs(5),
            catalog.namespaces(&client(), &instance),
        )
        .await
        .expect("served without waiting for the instance");

        assert!(Arc::ptr_eq(&served.unwrap(), &old));
        while requests.load(Ordering::SeqCst) == 0 {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }

    #[tokio::test]
    async fn a_failed_refetch_serves_the_old_catalog_for_a_while() {
        let (instance, requests) = broken_instance(false).await;
        let old = Arc::new(catalog());
        let catalog = stale(&old).await;

        catalog.namespaces(&client(), &instance).await.unwrap();
        // Until the refetch in the background failed
        while catalog
            .cached
            .lock()
            .await
            .as_ref()
            .is_some_and(|cached| cached.until <= Instant::now())
        {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        let served = catalog.namespaces(&client(), &instance).await.unwrap();

        assert!(Arc::ptr_eq(&served, &old));
        assert_eq!(requests.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn a_catalog_that_could_not_be_fetched_is_not_asked_for_again_at_once() {
        let (instance, requests) = broken_instance(false).await;
        let catalog = Arc::new(Catalog::default());

        for _ in 0..2 {
            assert!(catalog.namespaces(&client(), &instance).await.is_err());
        }
        assert_eq!(requests.load(Ordering::SeqCst), 1);
    }
}
