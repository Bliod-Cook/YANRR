use std::{collections::HashMap, convert::Infallible, sync::Arc};

use axum::{Json, body::Body, extract::State, http::header, response::IntoResponse};
use futures::{StreamExt, future, stream};
use serde::{Deserialize, Deserializer, Serialize, de::IntoDeserializer};
use serde_json::{Value, json};

use super::{
    entries::{self, EntryText},
    error::{ApiError, ApiJson, ApiQuery, ApiResult, ExceptionCode},
    response::ok,
    session::AuthUser,
};
use crate::{
    AppState,
    ai::{self, Language},
    config::AiConfig,
    fetch, id,
};

/// Entries of a batch translated at once.
const CONCURRENCY: usize = 4;

/// What of an entry the model reads.
#[derive(Clone, Copy, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
enum Target {
    #[default]
    Content,
    ReadabilityContent,
}

#[derive(Deserialize)]
pub struct SummaryQuery {
    id: String,
    language: Language,
    #[serde(default)]
    target: Target,
}

/// `GET /ai/summary`: a summary of the entry, or `null` if it has no text.
pub async fn summary(
    State(state): State<AppState>,
    user: AuthUser,
    ApiQuery(query): ApiQuery<SummaryQuery>,
) -> ApiResult<Json<Value>> {
    let config = configured(&state)?;
    let id = id::parse(&query.id).ok_or_else(ApiError::entry_not_found)?;
    let entry = entries::texts(&state.db, &user.id, &[id])
        .await?
        .pop()
        .ok_or_else(ApiError::entry_not_found)?;
    let Some(html) = html(&state, &entry, query.target).await? else {
        return Ok(ok(Value::Null));
    };
    let text = ai::html::texts(&html).join("\n");
    if text.is_empty() {
        return Ok(ok(Value::Null));
    }
    let article = match entry.title {
        Some(title) => format!("{title}\n\n{text}"),
        None => text,
    };
    Ok(ok(
        ai::summarize(&state, config, query.language, &article).await?
    ))
}

/// A field of an entry clients have translated.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
enum Field {
    Title,
    Description,
    Content,
    ReadabilityContent,
}

/// How translated HTML treats the original.
#[derive(Clone, Copy, Default, PartialEq, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum Mode {
    /// Each run of text followed by its translation.
    #[default]
    Bilingual,
    TranslationOnly,
}

/// `part` is ignored: what it means is unknown, and clients never send it.
#[derive(Deserialize)]
pub struct BatchBody {
    ids: Vec<String>,
    language: Language,
    #[serde(deserialize_with = "fields")]
    fields: Vec<Field>,
    #[serde(default)]
    mode: Mode,
}

/// Field names separated by commas.
fn fields<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Vec<Field>, D::Error> {
    String::deserialize(deserializer)?
        .split(',')
        .map(|field| Field::deserialize(field.into_deserializer()))
        .collect()
}

/// `POST /ai/translation/batch`: NDJSON lines of `{ id, data }`, each entry's translated fields as soon as they
/// are ready; entries that cannot be found or translated are left out.
pub async fn translate_batch(
    State(state): State<AppState>,
    user: AuthUser,
    ApiJson(body): ApiJson<BatchBody>,
) -> ApiResult<impl IntoResponse> {
    let config = configured(&state)?.clone();
    let ids: Vec<_> = body.ids.iter().filter_map(|id| id::parse(id)).collect();
    let entries = entries::texts(&state.db, &user.id, &ids).await?;
    let body = Arc::new(body);
    let lines = stream::iter(entries)
        .map(move |entry| {
            let (state, config, body) = (state.clone(), config.clone(), body.clone());
            async move {
                let id = entry.id;
                translated(&state, &config, &body, entry)
                    .await
                    .inspect_err(|err| {
                        tracing::warn!(entry = id, "translation failed: {}", err.message)
                    })
                    .ok()
            }
        })
        .buffer_unordered(CONCURRENCY)
        .filter_map(future::ready)
        .map(Ok::<_, Infallible>);
    Ok((
        [(header::CONTENT_TYPE, "application/x-ndjson")],
        Body::from_stream(lines),
    ))
}

/// The NDJSON line of the entry's fields translated.
async fn translated(
    state: &AppState,
    config: &AiConfig,
    body: &BatchBody,
    entry: EntryText,
) -> ApiResult<String> {
    let mut sources = Vec::new();
    for &field in &body.fields {
        if let Some(source) = source(state, &entry, field).await? {
            sources.push((field, source));
        }
    }
    let texts: Vec<_> = sources.iter().map(|(_, source)| source.texts()).collect();
    let translations = ai::translate(state, config, body.language, &texts.concat()).await?;
    let mut translations = translations.into_iter();
    let data: HashMap<_, _> = sources
        .iter()
        .zip(&texts)
        .map(|((field, source), texts)| {
            let translations: Vec<_> = translations.by_ref().take(texts.len()).collect();
            (field, source.translated(&translations, body.mode))
        })
        .collect();
    Ok(json!({ "id": entry.id.to_string(), "data": data }).to_string() + "\n")
}

/// A field's value: plain text is translated whole, HTML a run of text at a time.
enum Source {
    Text(String),
    Html(String),
}

impl Source {
    fn texts(&self) -> Vec<String> {
        match self {
            Self::Text(text) => vec![text.clone()],
            Self::Html(html) => ai::html::texts(html),
        }
    }

    /// The value with `translations` of its [`Source::texts`]; clients pair plain text with its translation
    /// themselves.
    fn translated(&self, translations: &[String], mode: Mode) -> String {
        match self {
            Self::Text(_) => translations[0].clone(),
            Self::Html(html) => ai::html::translated(html, translations, mode == Mode::Bilingual),
        }
    }
}

async fn source(state: &AppState, entry: &EntryText, field: Field) -> ApiResult<Option<Source>> {
    Ok(match field {
        Field::Title => entry.title.clone().map(Source::Text),
        Field::Description => entry.description.clone().map(Source::Text),
        Field::Content => html(state, entry, Target::Content).await?.map(Source::Html),
        Field::ReadabilityContent => html(state, entry, Target::ReadabilityContent)
            .await?
            .map(Source::Html),
    })
}

fn configured(state: &AppState) -> ApiResult<&AiConfig> {
    let missing = || ApiError::new(ExceptionCode::MissingConfiguration, "AI is not configured");
    state.config.ai.as_ref().ok_or_else(missing)
}

/// The entry's content, or the readable part of its web page.
async fn html(state: &AppState, entry: &EntryText, target: Target) -> ApiResult<Option<String>> {
    match target {
        Target::Content => Ok(entry.content.clone()),
        Target::ReadabilityContent => {
            let no_url = || ApiError::new(ExceptionCode::FeedFetchError, "The entry has no URL");
            let url = entry.url.as_deref().ok_or_else(no_url)?;
            Ok(Some(fetch::readability::extract(state, url).await?))
        }
    }
}
