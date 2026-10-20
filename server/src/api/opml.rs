use std::collections::{HashMap, HashSet};

use axum::{
    Json,
    body::Bytes,
    extract::{Multipart, State},
    http::header,
    response::IntoResponse,
};
use futures::{StreamExt, stream};
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, QueryOrder, TransactionTrait};
use serde::Deserialize;
use serde_json::{Value, json};

use super::{
    error::{ApiError, ApiQuery, ApiResult, ExceptionCode},
    response::ok,
    session::AuthUser,
};
use crate::{
    AppState,
    entity::{feed, subscription},
    fetch::{self, FetchError},
    opml,
    subscription::{self as subscriptions, Form},
    sync,
};

const IMPORT_CONCURRENCY: usize = 8;
const VIEW_NAMES: [&str; 6] = [
    "Articles",
    "SocialMedia",
    "Pictures",
    "Videos",
    "Audios",
    "Notifications",
];

fn invalid(message: impl Into<String>) -> ApiError {
    ApiError::new(ExceptionCode::InvalidInput, message)
}

/// `POST /subscriptions/parse-opml`: the feeds of an OPML file, for the user to pick from.
pub async fn parse(user: AuthUser, body: Bytes) -> ApiResult<Json<Value>> {
    let outlines = opml::parse(&body).map_err(invalid)?;
    let subscriptions: Vec<_> = outlines
        .iter()
        .map(|outline| {
            json!({
                "userId": user.id,
                "url": outline.url,
                "view": 0,
                "category": outline.category,
                "title": outline.title,
            })
        })
        .collect();
    // There is no quota: what remains is everything found, so no selection ever exceeds it.
    let remaining = subscriptions.len();
    Ok(ok(
        json!({ "subscriptions": subscriptions, "remaining": remaining }),
    ))
}

/// `POST /subscriptions/import`: follows the feeds of the OPML `file` whose URLs `items` lists, or all of them.
pub async fn import(
    State(state): State<AppState>,
    user: AuthUser,
    mut form: Multipart,
) -> ApiResult<Json<Value>> {
    let (mut file, mut items) = (None, None);
    while let Some(field) = form
        .next_field()
        .await
        .map_err(|err| invalid(err.body_text()))?
    {
        match field.name() {
            Some("file") => {
                file = Some(
                    field
                        .bytes()
                        .await
                        .map_err(|err| invalid(err.body_text()))?,
                )
            }
            Some("items") => {
                items = Some(field.text().await.map_err(|err| invalid(err.body_text()))?)
            }
            _ => {}
        }
    }
    let file = file.ok_or_else(|| invalid("file required"))?;
    let selected: Option<HashSet<String>> = items
        .map(|items| serde_json::from_str(&items))
        .transpose()
        .map_err(|_| invalid("items must be a JSON array of URLs"))?;
    let mut seen = HashSet::new();
    let outlines = opml::parse(&file)
        .map_err(invalid)?
        .into_iter()
        .filter(|outline| {
            selected
                .as_ref()
                .is_none_or(|urls| urls.contains(&outline.url))
        })
        .filter(|outline| seen.insert(outline.url.clone()));

    let followed: HashMap<_, _> = subscription::Entity::find()
        .filter(subscription::Column::UserId.eq(&user.id))
        .find_also_related(feed::Entity)
        .all(&state.db)
        .await?
        .into_iter()
        .filter_map(|(_, feed)| feed.map(|feed| (feed.url, feed.id)))
        .collect();
    let item = |id: Option<i64>, outline: &opml::Outline| json!({ "id": id.map(|id| id.to_string()), "url": outline.url, "title": outline.title });
    let (mut successful, mut conflicts, mut errors) = (Vec::new(), Vec::new(), Vec::new());
    let (known, new): (Vec<_>, Vec<_>) =
        outlines.partition(|outline| followed.contains_key(&outline.url));
    for outline in &known {
        conflicts.push(item(followed.get(&outline.url).copied(), outline));
    }
    let fetched: Vec<_> = stream::iter(new)
        .map(async |outline| {
            let feed = fetch::add_feed(&state, &outline.url).await;
            (outline, feed)
        })
        .buffer_unordered(IMPORT_CONCURRENCY)
        .collect()
        .await;

    let txn = state.db.begin().await?;
    let mut actions = Vec::new();
    for (outline, feed) in fetched {
        let feed = match feed {
            Ok(feed) => feed,
            Err(FetchError::Db(err)) => return Err(err.into()),
            Err(_) => {
                errors.push(item(None, &outline));
                continue;
            }
        };
        let feed = subscriptions::resolve(&txn, feed.id)
            .await?
            .ok_or_else(ApiError::feed_not_found)?;
        // A name given in the old reader is kept; the feed's own title needs no copy.
        let title = outline
            .title
            .clone()
            .filter(|title| feed.title.as_ref() != Some(title));
        let form = Form {
            view: 0,
            category: outline.category.clone(),
            title,
            hide_from_timeline: None,
        };
        let subscribed = subscriptions::subscribe(&txn, &user.id, &feed, form).await?;
        if subscribed.created {
            successful.push(item(Some(feed.id), &outline));
            actions.push(subscribed.action);
        } else {
            conflicts.push(item(Some(feed.id), &outline));
        }
    }
    let last_sync_id = sync::record(&txn, actions).await?;
    txn.commit().await?;
    Ok(Json(json!({
        "code": 0,
        "data": {
            "successfulItems": successful,
            "conflictItems": conflicts,
            "parsedErrorItems": errors,
        },
        "lastSyncId": last_sync_id,
    })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportQuery {
    folder_mode: Option<String>,
}

/// `GET /subscriptions/export`: folders by view, or by category; `rsshub://` feeds point at the configured
/// instance, whatever `RSSHubURL` says.
pub async fn export(
    State(state): State<AppState>,
    user: AuthUser,
    ApiQuery(query): ApiQuery<ExportQuery>,
) -> ApiResult<impl IntoResponse> {
    let by_category = query.folder_mode.as_deref() == Some("category");
    let rows = subscription::Entity::find()
        .filter(subscription::Column::UserId.eq(user.id))
        .order_by_asc(subscription::Column::CreatedAt)
        .find_also_related(feed::Entity)
        .all(&state.db)
        .await?;
    let instance = state.config.rsshub.url.trim_end_matches('/');
    let outlines: Vec<_> = rows
        .into_iter()
        .filter_map(|(subscription, feed)| {
            let feed = feed?;
            let url = match feed.url.strip_prefix("rsshub://") {
                Some(route) => format!("{instance}/{route}"),
                None => feed.url,
            };
            let category = match by_category {
                true => subscription.category,
                false => Some(view_name(subscription.view).into()),
            };
            Some(opml::Outline {
                url,
                title: subscription.title.or(feed.title),
                category,
            })
        })
        .collect();
    Ok((
        [(header::CONTENT_TYPE, "application/xml")],
        opml::write(&outlines),
    ))
}

fn view_name(view: i16) -> &'static str {
    usize::try_from(view)
        .ok()
        .and_then(|view| VIEW_NAMES.get(view))
        .copied()
        .unwrap_or("All")
}
