//! Summaries and translations by a model behind an OpenAI-compatible Chat Completions API, cached for every user
//! by the text they are made from.

pub mod html;

use std::{
    collections::{HashMap, HashSet},
    time::Duration,
};

use futures::{StreamExt, TryStreamExt, stream};
use reqwest::Client;
use sea_orm::{
    ActiveValue::Set, ColumnTrait, DatabaseConnection, DbErr, EntityTrait, QueryFilter,
    sea_query::OnConflict,
};
use serde::Deserialize;
use serde_json::json;
use sha2::{Digest, Sha256};

use crate::{
    AppState,
    config::AiConfig,
    entity::ai_cache,
    fetch::http::{describe, successful},
};

/// Bounds one answer, just under the minute clients wait for a summary.
const TIMEOUT: Duration = Duration::from_secs(55);
/// Bytes of an article a summary is made from; the rest is left out.
const SUMMARY_INPUT: usize = 32 << 10;
/// Bytes of text translated per call, which keeps an answer well inside [`TIMEOUT`]; a longer text goes alone.
const CHUNK: usize = 4 << 10;
/// Calls one translation makes at once.
const CONCURRENCY: usize = 4;
const SUMMARY: &str = "summary";
const TRANSLATION: &str = "translation";

/// A language clients ask for output in.
#[derive(Clone, Copy, Deserialize)]
pub enum Language {
    #[serde(rename = "en")]
    English,
    #[serde(rename = "fr-FR")]
    French,
    #[serde(rename = "ja")]
    Japanese,
    #[serde(rename = "zh-CN")]
    SimplifiedChinese,
    #[serde(rename = "zh-TW")]
    TraditionalChinese,
}

impl Language {
    fn name(self) -> &'static str {
        match self {
            Self::English => "English",
            Self::French => "French",
            Self::Japanese => "Japanese",
            Self::SimplifiedChinese => "Simplified Chinese",
            Self::TraditionalChinese => "Traditional Chinese",
        }
    }
}

#[derive(Debug)]
pub enum AiError {
    Model(String),
    Db(DbErr),
}

impl From<DbErr> for AiError {
    fn from(err: DbErr) -> Self {
        Self::Db(err)
    }
}

/// A summary of `article` in `language`.
pub async fn summarize(
    state: &AppState,
    config: &AiConfig,
    language: Language,
    article: &str,
) -> Result<String, AiError> {
    let article = &article[..article.floor_char_boundary(SUMMARY_INPUT)];
    let hash = hash(article);
    let mut cached = cached(&state.db, SUMMARY, language, vec![hash.clone()]).await?;
    if let Some(summary) = cached.remove(&hash) {
        return Ok(summary);
    }
    let system = format!(
        "Summarize the user's article in {}: a few sentences, or a short Markdown list for an article with \
        several points. Reply with the summary only.",
        language.name()
    );
    let summary = complete(&state.http, config, &system, article)
        .await
        .map_err(AiError::Model)?;
    let summary = summary.trim().to_string();
    store(&state.db, SUMMARY, language, &[(hash, summary.clone())]).await?;
    Ok(summary)
}

/// The translations of `texts` into `language`, in order.
pub async fn translate(
    state: &AppState,
    config: &AiConfig,
    language: Language,
    texts: &[String],
) -> Result<Vec<String>, AiError> {
    let hashes: Vec<_> = texts.iter().map(|text| hash(text)).collect();
    let mut translations = cached(&state.db, TRANSLATION, language, hashes.clone()).await?;
    let mut seen = HashSet::new();
    let missing: Vec<_> = hashes
        .iter()
        .zip(texts)
        .filter(|(hash, _)| !translations.contains_key(*hash) && seen.insert(*hash))
        .map(|(hash, text)| (hash.clone(), text.as_str()))
        .collect();
    // Made before streaming: a stream mapping borrowed chunks fails the compiler's `Send` check of the handler.
    let calls: Vec<_> = chunks(&missing)
        .into_iter()
        .map(|chunk| translate_chunk(state, config, language, chunk))
        .collect();
    let translated: Vec<_> = stream::iter(calls)
        .buffered(CONCURRENCY)
        .try_collect()
        .await?;
    translations.extend(translated.into_iter().flatten());
    Ok(hashes
        .iter()
        .map(|hash| translations[hash].clone())
        .collect())
}

/// Translates `texts`, each by the hash of it, with one call, and caches the translations.
async fn translate_chunk(
    state: &AppState,
    config: &AiConfig,
    language: Language,
    texts: &[(Vec<u8>, &str)],
) -> Result<Vec<(Vec<u8>, String)>, AiError> {
    let system = format!(
        "Translate each string of the JSON array the user sends into {}, leaving code and URLs as they are. \
        Reply with only a JSON array of the translations, in the same order.",
        language.name()
    );
    let originals: Vec<_> = texts.iter().map(|(_, text)| text).collect();
    let answer = complete(&state.http, config, &system, &json!(originals).to_string())
        .await
        .map_err(AiError::Model)?;
    let translations = json_array(&answer)
        .and_then(|array| serde_json::from_str::<Vec<String>>(array).ok())
        .filter(|translations| translations.len() == texts.len())
        .ok_or_else(|| AiError::Model(format!("Not one translation per text: {answer}")))?;
    let translations: Vec<_> = texts
        .iter()
        .map(|(hash, _)| hash.clone())
        .zip(translations)
        .collect();
    store(&state.db, TRANSLATION, language, &translations).await?;
    Ok(translations)
}

/// `texts` in runs of up to [`CHUNK`] bytes.
fn chunks<'a, 'b>(texts: &'a [(Vec<u8>, &'b str)]) -> Vec<&'a [(Vec<u8>, &'b str)]> {
    let mut chunks = Vec::new();
    let (mut start, mut size) = (0, 0);
    for (end, (_, text)) in texts.iter().enumerate() {
        if size > 0 && size + text.len() > CHUNK {
            chunks.push(&texts[start..end]);
            (start, size) = (end, 0);
        }
        size += text.len();
    }
    if start < texts.len() {
        chunks.push(&texts[start..]);
    }
    chunks
}

/// The JSON array in an answer, which models like to put in a Markdown code block or after a few words.
fn json_array(answer: &str) -> Option<&str> {
    answer.get(answer.find('[')?..=answer.rfind(']')?)
}

#[derive(Deserialize)]
struct Completion {
    choices: Vec<Choice>,
}

#[derive(Deserialize)]
struct Choice {
    message: Message,
}

#[derive(Deserialize)]
struct Message {
    content: String,
}

/// The model's answer to the `user` message under the `system` prompt.
async fn complete(
    http: &Client,
    config: &AiConfig,
    system: &str,
    user: &str,
) -> Result<String, String> {
    let url = format!("{}/chat/completions", config.base_url.trim_end_matches('/'));
    let body = json!({
        "model": config.model,
        "messages": [{ "role": "system", "content": system }, { "role": "user", "content": user }],
    });
    let mut request = http.post(url).timeout(TIMEOUT).json(&body);
    if let Some(key) = &config.api_key {
        request = request.bearer_auth(key);
    }
    let response = successful(request.send().await.map_err(describe)?).await?;
    let completion: Completion = response.json().await.map_err(describe)?;
    let choice = completion.choices.into_iter().next();
    choice
        .map(|choice| choice.message.content)
        .ok_or_else(|| "The model gave no answer".into())
}

fn hash(text: &str) -> Vec<u8> {
    Sha256::digest(text).to_vec()
}

/// What was made of `kind` in `language` from the texts with `hashes`, by hash.
async fn cached(
    db: &DatabaseConnection,
    kind: &str,
    language: Language,
    hashes: Vec<Vec<u8>>,
) -> Result<HashMap<Vec<u8>, String>, DbErr> {
    let rows = ai_cache::Entity::find()
        .filter(ai_cache::Column::Kind.eq(kind))
        .filter(ai_cache::Column::Language.eq(language.name()))
        .filter(ai_cache::Column::SourceHash.is_in(hashes))
        .all(db)
        .await?;
    Ok(rows
        .into_iter()
        .map(|row| (row.source_hash, row.output))
        .collect())
}

/// Caches `outputs` of `kind` in `language` by the hashes of the texts they were made from.
async fn store(
    db: &DatabaseConnection,
    kind: &str,
    language: Language,
    outputs: &[(Vec<u8>, String)],
) -> Result<(), DbErr> {
    let rows = outputs.iter().map(|(hash, output)| ai_cache::ActiveModel {
        kind: Set(kind.into()),
        language: Set(language.name().into()),
        source_hash: Set(hash.clone()),
        output: Set(output.clone()),
    });
    let key = [
        ai_cache::Column::Kind,
        ai_cache::Column::Language,
        ai_cache::Column::SourceHash,
    ];
    ai_cache::Entity::insert_many(rows)
        .on_conflict(OnConflict::columns(key).do_nothing().to_owned())
        .exec_without_returning(db)
        .await?;
    Ok(())
}
