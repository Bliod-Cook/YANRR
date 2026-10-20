use axum::{extract::FromRequestParts, http::request::Parts};
use better_auth::integrations::axum::OptionalSession;

use super::error::{ApiError, ExceptionCode};
use crate::{AppState, auth::AppAuthSchema};

/// The signed-in user; rejects with the API's 401 format instead of Better Auth's.
pub struct AuthUser {
    pub id: String,
}

impl FromRequestParts<AppState> for AuthUser {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, ApiError> {
        match OptionalSession::<AppAuthSchema>::from_request_parts(parts, state).await {
            Ok(OptionalSession(Some(session))) => Ok(Self {
                id: session.user.id,
            }),
            _ => Err(ApiError::new(ExceptionCode::AuthError, "Unauthorized")),
        }
    }
}
