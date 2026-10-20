use std::convert::Infallible;

use axum::{
    extract::{FromRequestParts, OptionalFromRequestParts},
    http::request::Parts,
};
use better_auth::integrations::axum::OptionalSession;

use super::error::{ApiError, ExceptionCode};
use crate::{AppState, auth::AppAuthSchema};

/// The signed-in user; rejects with the API's 401 format instead of Better Auth's.
pub struct AuthUser {
    pub id: String,
}

async fn signed_in(parts: &mut Parts, state: &AppState) -> Option<AuthUser> {
    match OptionalSession::<AppAuthSchema>::from_request_parts(parts, state).await {
        Ok(OptionalSession(Some(session))) => Some(AuthUser {
            id: session.user.id,
        }),
        _ => None,
    }
}

impl FromRequestParts<AppState> for AuthUser {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, ApiError> {
        signed_in(parts, state)
            .await
            .ok_or_else(|| ApiError::new(ExceptionCode::AuthError, "Unauthorized"))
    }
}

/// For routes that also answer signed-out visitors.
impl OptionalFromRequestParts<AppState> for AuthUser {
    type Rejection = Infallible;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Option<Self>, Infallible> {
        Ok(signed_in(parts, state).await)
    }
}
