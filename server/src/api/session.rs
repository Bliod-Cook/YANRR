use axum::{
    extract::{FromRequestParts, OptionalFromRequestParts},
    http::request::Parts,
};
use better_auth::integrations::axum::OptionalSession;

use super::error::ApiError;
use crate::{AppState, auth::AppAuthSchema};

/// The signed-in user; rejects with the API's 401 format instead of Better Auth's.
pub struct AuthUser {
    pub id: String,
}

/// The signed-in user, or `None` when the request carries no valid session. A session that cannot be looked up
/// is the server's failure, not a signed-out client.
async fn signed_in(parts: &mut Parts, state: &AppState) -> Result<Option<AuthUser>, ApiError> {
    match OptionalSession::<AppAuthSchema>::from_request_parts(parts, state).await {
        Ok(OptionalSession(session)) => Ok(session.map(|session| AuthUser {
            id: session.user.id,
        })),
        Err(rejection) => {
            tracing::error!("looking up the session failed: {}", rejection.status());
            Err(ApiError::internal())
        }
    }
}

impl FromRequestParts<AppState> for AuthUser {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, ApiError> {
        signed_in(parts, state)
            .await?
            .ok_or_else(ApiError::unauthorized)
    }
}

/// For routes that also answer signed-out visitors.
impl OptionalFromRequestParts<AppState> for AuthUser {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Option<Self>, ApiError> {
        signed_in(parts, state).await
    }
}
