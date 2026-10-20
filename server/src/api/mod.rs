mod categories;
mod discover;
mod error;
mod feeds;
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
        .route("/discover", post(discover::discover))
        .route("/feeds", get(feeds::get))
        .route("/feeds/refresh", get(feeds::refresh))
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
        .route("/sync/state", get(sync::state))
        .route("/sync/delta", get(sync::delta))
        .nest("/better-auth", auth.axum_router_with_state())
        .fallback(async || ApiError::new(ExceptionCode::NotFound, "Not found"))
}
