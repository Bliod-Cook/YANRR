use axum::{
    Json,
    extract::{
        FromRequest, FromRequestParts,
        rejection::{JsonRejection, QueryRejection},
    },
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::{Value, json};

use crate::fetch::FetchError;

/// Error codes from the Folo API contract; add variants as features need them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExceptionCode {
    UnprocessableContent = 3,
    InvalidInput = 4,
    MissingConfiguration = 5,
    NotFound = 6,
    AuthError = 1000,
    InternalError = 1005,
    FeedNoFound = 2001,
    FeedMissingId = 2002,
    FeedFetchError = 2003,
    FeedParseError = 2004,
    EntryNoFound = 3000,
    SettingInvalidTab = 7001,
    SettingPayloadInvalid = 7002,
    InboxNotFound = 10000,
    InboxAlreadyExists = 10001,
    InboxPermissionDenied = 10003,
    RSSHubRouteError = 13000,
    RSSHubUnavailable = 13007,
}

impl ExceptionCode {
    fn status(self) -> StatusCode {
        match self {
            Self::InvalidInput
            | Self::FeedFetchError
            | Self::FeedParseError
            | Self::SettingInvalidTab
            | Self::SettingPayloadInvalid
            | Self::InboxAlreadyExists
            | Self::RSSHubUnavailable => StatusCode::BAD_REQUEST,
            Self::UnprocessableContent | Self::FeedMissingId => StatusCode::UNPROCESSABLE_ENTITY,
            Self::NotFound
            | Self::FeedNoFound
            | Self::EntryNoFound
            | Self::InboxNotFound
            | Self::RSSHubRouteError => StatusCode::NOT_FOUND,
            Self::AuthError => StatusCode::UNAUTHORIZED,
            Self::InboxPermissionDenied => StatusCode::FORBIDDEN,
            Self::MissingConfiguration | Self::InternalError => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }
}

#[derive(Debug)]
pub struct ApiError {
    pub code: ExceptionCode,
    pub message: String,
    pub data: Option<Value>,
}

pub type ApiResult<T> = Result<T, ApiError>;

impl ApiError {
    pub fn new(code: ExceptionCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            data: None,
        }
    }

    pub fn unauthorized() -> Self {
        Self::new(ExceptionCode::AuthError, "Unauthorized")
    }

    pub fn feed_not_found() -> Self {
        Self::new(ExceptionCode::FeedNoFound, "Feed not found")
    }

    pub fn feed_missing_id() -> Self {
        Self::new(ExceptionCode::FeedMissingId, "feedId or url required")
    }

    pub fn entry_not_found() -> Self {
        Self::new(ExceptionCode::EntryNoFound, "Entry not found")
    }

    pub fn validation(message: String) -> Self {
        Self {
            data: Some(json!([{ "message": message }])),
            ..Self::new(ExceptionCode::InvalidInput, message)
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let mut body = json!({ "code": self.code as i32, "message": self.message });
        if let Some(data) = self.data {
            body["data"] = data;
        }
        (self.code.status(), Json(body)).into_response()
    }
}

impl From<sea_orm::DbErr> for ApiError {
    fn from(err: sea_orm::DbErr) -> Self {
        tracing::error!("database error: {err}");
        Self::new(ExceptionCode::InternalError, "Internal error")
    }
}

impl From<FetchError> for ApiError {
    fn from(err: FetchError) -> Self {
        match err {
            FetchError::Fetch(message) => Self::new(ExceptionCode::FeedFetchError, message),
            FetchError::Parse(message) => Self::new(ExceptionCode::FeedParseError, message),
            FetchError::Db(err) => err.into(),
        }
    }
}

impl From<QueryRejection> for ApiError {
    fn from(rejection: QueryRejection) -> Self {
        Self::validation(rejection.body_text())
    }
}

impl From<JsonRejection> for ApiError {
    fn from(rejection: JsonRejection) -> Self {
        Self::validation(rejection.body_text())
    }
}

/// `Query` whose rejection follows the API error format.
#[derive(FromRequestParts)]
#[from_request(via(axum::extract::Query), rejection(ApiError))]
pub struct ApiQuery<T>(pub T);

/// `Json` whose rejection follows the API error format.
#[derive(FromRequest)]
#[from_request(via(axum::Json), rejection(ApiError))]
pub struct ApiJson<T>(pub T);

/// A `FeedViewType`; All (-1) included, as the contract allows it wherever a view is written.
pub fn view(view: i16) -> ApiResult<i16> {
    if (-1..=5).contains(&view) {
        Ok(view)
    } else {
        Err(ApiError::new(
            ExceptionCode::UnprocessableContent,
            "Invalid view",
        ))
    }
}
