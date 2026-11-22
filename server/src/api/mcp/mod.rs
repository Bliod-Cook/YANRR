//! The MCP server at `/api/mcp`: tools for an agent to read what a user follows, reached with a bearer token the
//! user issued. Only the token authenticates, never a session cookie, and its scopes decide which tools there are.

pub(super) mod history;
pub(super) mod tokens;
mod tools;

use std::sync::Arc;

use axum::{
    Router,
    extract::{Request, State},
    http::{HeaderValue, header, request::Parts},
    middleware::{self, Next},
    response::{IntoResponse, Response},
};
use rmcp::{
    ErrorData, RoleServer, ServerHandler,
    handler::server::{router::tool::ToolRouter, tool::ToolCallContext},
    model::{CallToolRequestParams, CallToolResponse, ListToolsResult, PaginatedRequestParams},
    service::RequestContext,
    tool_handler,
    transport::streamable_http_server::{
        StreamableHttpServerConfig, StreamableHttpService, session::never::NeverSessionManager,
    },
};

use self::tokens::{Principal, Scope};
use super::error::{ApiError, ApiResult, ExceptionCode};
use crate::AppState;

/// Entries the tools show: of a feed the user follows or starred by them, and not blocked; a condition on
/// [`super::entries::TIMELINE`].
const VISIBLE: &str = "(s.feed_id IS NOT NULL OR c.entry_id IS NOT NULL) AND b.entry_id IS NULL";

/// Refuses requests while the server is configured without MCP.
fn enabled(state: &AppState) -> ApiResult<()> {
    match state.config.mcp.enabled {
        true => Ok(()),
        false => Err(ApiError::new(
            ExceptionCode::MissingConfiguration,
            "MCP is not enabled",
        )),
    }
}

/// `/api/mcp`, served statelessly: each request is authenticated on its own and answered with JSON.
pub fn router(state: &AppState) -> Router<AppState> {
    let server = Server::new(state.clone());
    let config = StreamableHttpServerConfig::default()
        .with_legacy_session_mode(false)
        .with_json_response(true)
        // Host checks keep rebound browser pages away from servers that trust whoever reaches them; this one trusts
        // bearer tokens only, and reverse proxies often pass on a `Host` of their own.
        .disable_allowed_hosts();
    let service = StreamableHttpService::new(
        move || Ok(server.clone()),
        Arc::new(NeverSessionManager::default()),
        config,
    );
    Router::new()
        .route_service("/api/mcp", service)
        .route_layer(middleware::from_fn_with_state(state.clone(), authenticate))
}

/// Lets through requests with a valid bearer token, carrying its [`Principal`].
async fn authenticate(State(state): State<AppState>, mut request: Request, next: Next) -> Response {
    let token = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "));
    let principal = match token {
        Some(token) => tokens::principal(&state.db, token).await,
        None => Ok(None),
    };
    match principal {
        Ok(Some(principal)) => {
            request.extensions_mut().insert(principal);
            next.run(request).await
        }
        Ok(None) => {
            let mut response = ApiError::unauthorized().into_response();
            let challenge = HeaderValue::from_static("Bearer");
            response
                .headers_mut()
                .insert(header::WWW_AUTHENTICATE, challenge);
            response
        }
        Err(err) => ApiError::from(err).into_response(),
    }
}

/// The principal [`authenticate`] let through.
fn principal(parts: &Parts) -> &Principal {
    parts
        .extensions
        .get()
        .expect("MCP requests are authenticated first")
}

fn principal_of(context: &RequestContext<RoleServer>) -> Result<&Principal, ErrorData> {
    context
        .extensions
        .get::<Parts>()
        .map(principal)
        .ok_or_else(|| ErrorData::internal_error("The request has no HTTP parts", None))
}

/// The scope a tool needs.
fn scope_of(tool: &str) -> Option<Scope> {
    match tool {
        "list_feeds" => Some(Scope::Feeds),
        "list_entries" | "search_entries" | "get_entry" => Some(Scope::Entries),
        "list_recent_reads" => Some(Scope::History),
        _ => None,
    }
}

#[derive(Clone)]
struct Server {
    state: AppState,
    tools: ToolRouter<Self>,
}

impl Server {
    fn new(state: AppState) -> Self {
        Self {
            state,
            tools: Self::tool_router(),
        }
    }
}

#[tool_handler(
    router = self.tools,
    name = "yanrr",
    instructions = "The user's RSS reader: the feeds they follow, their entries, a search of them, and what the \
        user opened lately. Pass a page's nextCursor back for the next one."
)]
impl ServerHandler for Server {
    async fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, ErrorData> {
        let principal = principal_of(&context)?;
        let tools = self
            .tools
            .list_all()
            .into_iter()
            .filter(|tool| {
                scope_of(&tool.name).is_some_and(|scope| principal.scopes.contains(&scope))
            })
            .collect();
        Ok(ListToolsResult::with_all_items(tools))
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResponse, ErrorData> {
        let principal = principal_of(&context)?;
        match scope_of(&request.name) {
            Some(scope) if principal.scopes.contains(&scope) => {
                self.tools
                    .call(ToolCallContext::new(self, request, context))
                    .await
            }
            Some(scope) => Err(ErrorData::invalid_request(
                format!("The token lacks the {} scope", scope.name()),
                None,
            )),
            None => Err(ErrorData::invalid_params("Unknown tool", None)),
        }
    }
}
