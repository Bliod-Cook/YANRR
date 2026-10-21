mod categories;
mod collections;
mod discover;
mod entries;
mod error;
mod feeds;
mod inboxes;
mod messaging;
mod opml;
mod reads;
mod response;
mod session;
mod settings;
mod status;
mod subscriptions;
mod sync;

use std::sync::Arc;

use axum::{
    Router,
    routing::{get, patch, post},
};
use better_auth::integrations::axum::AxumIntegration;

use self::error::{ApiError, ExceptionCode};
use crate::{AppState, auth::Auth};

pub fn router(auth: Arc<Auth>) -> Router<AppState> {
    Router::new()
        .route("/status/configs", get(status::configs))
        .route(
            "/categories",
            patch(categories::update).delete(categories::delete),
        )
        .route(
            "/collections",
            post(collections::collect).delete(collections::uncollect),
        )
        .route("/discover", post(discover::discover))
        .route("/discover/rsshub", get(discover::rsshub))
        .route("/discover/rsshub/route", get(discover::rsshub_route))
        .route("/entries", get(entries::get).post(entries::timeline))
        .route("/entries/stream", post(entries::stream))
        .route("/entries/readability", get(entries::readability))
        .route("/feeds", get(feeds::get))
        .route("/feeds/refresh", get(feeds::refresh))
        .route(
            "/inboxes",
            get(inboxes::get)
                .post(inboxes::create)
                .put(inboxes::update)
                .delete(inboxes::delete),
        )
        .route("/inboxes/email", post(inboxes::email))
        .route("/inboxes/list", get(inboxes::list))
        .route("/inboxes/webhook", post(inboxes::webhook))
        .route(
            "/messaging",
            get(messaging::list)
                .post(messaging::create)
                .delete(messaging::delete),
        )
        .route("/messaging/test", get(messaging::test))
        .route(
            "/reads",
            get(reads::counts)
                .post(reads::mark_read)
                .delete(reads::mark_unread),
        )
        .route("/reads/all", post(reads::mark_all_read))
        .route("/reads/total-count", get(reads::total))
        .route("/settings", get(settings::get))
        .route("/settings/{tab}", patch(settings::update))
        .route(
            "/subscriptions",
            get(subscriptions::list)
                .post(subscriptions::create)
                .patch(subscriptions::update)
                .delete(subscriptions::delete),
        )
        .route("/subscriptions/batch", patch(subscriptions::update_batch))
        .route("/subscriptions/parse-opml", post(opml::parse))
        .route("/subscriptions/import", post(opml::import))
        .route("/subscriptions/export", get(opml::export))
        .route("/sync/state", get(sync::state))
        .route("/sync/delta", get(sync::delta))
        .nest("/better-auth", auth.axum_router_with_state())
        .fallback(async || ApiError::new(ExceptionCode::NotFound, "Not found"))
}
