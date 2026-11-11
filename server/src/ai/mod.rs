//! Summaries and translations by a model behind an OpenAI-compatible Chat Completions API, cached for every user
//! by the model, the prompt and the text they are made from.

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
    /// The model failed or answered with what can't be used; what it said was logged, as it may name the
    /// service's account or address.
    Model,
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
    let system = format!(
        "Summarize the user's article in {}: a few sentences, or a short Markdown list for an article with \
        several points. Reply with the summary only.",
        language.name()
    );
    let key = key(config, &system, article);
    let mut cached = cached(&state.db, SUMMARY, language, vec![key.clone()]).await?;
    if let Some(summary) = cached.remove(&key) {
        return Ok(summary);
    }
    let summary = complete(&state.http, config, &system, article).await?;
    let summary = summary.trim().to_string();
    store(&state.db, SUMMARY, language, &[(key, summary.clone())]).await?;
    Ok(summary)
}

/// The translations of `texts` into `language`, in order.
pub async fn translate(
    state: &AppState,
    config: &AiConfig,
    language: Language,
    texts: &[String],
) -> Result<Vec<String>, AiError> {
    let system = format!(
        "Translate each string of the JSON array the user sends into {}, leaving code and URLs as they are. \
        Reply with only a JSON array of the translations, in the same order.",
        language.name()
    );
    let keys: Vec<_> = texts
        .iter()
        .map(|text| key(config, &system, text))
        .collect();
    let mut translations = cached(&state.db, TRANSLATION, language, keys.clone()).await?;
    let mut seen = HashSet::new();
    let missing: Vec<_> = keys
        .iter()
        .zip(texts)
        .filter(|(key, _)| !translations.contains_key(*key) && seen.insert(*key))
        .map(|(key, text)| (key.clone(), text.as_str()))
        .collect();
    // Made before streaming: a stream mapping borrowed chunks fails the compiler's `Send` check of the handler.
    let calls: Vec<_> = chunks(&missing)
        .into_iter()
        .map(|chunk| translate_chunk(state, config, &system, language, chunk))
        .collect();
    let translated: Vec<_> = stream::iter(calls)
        .buffered(CONCURRENCY)
        .try_collect()
        .await?;
    translations.extend(translated.into_iter().flatten());
    Ok(keys.iter().map(|key| translations[key].clone()).collect())
}

/// Translates `texts`, each by its key, with one call, and caches the translations. When the model merges or
/// splits texts, which a long list makes likelier, each half is translated on its own.
async fn translate_chunk(
    state: &AppState,
    config: &AiConfig,
    system: &str,
    language: Language,
    texts: &[(Vec<u8>, &str)],
) -> Result<Vec<(Vec<u8>, String)>, AiError> {
    let mut translated = Vec::new();
    let mut pending = vec![texts];
    while let Some(texts) = pending.pop() {
        let originals: Vec<_> = texts.iter().map(|(_, text)| text).collect();
        let answer = complete(&state.http, config, system, &json!(originals).to_string()).await?;
        let translations =
            json_array(&answer).and_then(|array| serde_json::from_str::<Vec<String>>(array).ok());
        match translations {
            Some(translations) if translations.len() == texts.len() => {
                let translations: Vec<_> = texts
                    .iter()
                    .map(|(key, _)| key.clone())
                    .zip(translations)
                    .collect();
                store(&state.db, TRANSLATION, language, &translations).await?;
                translated.extend(translations);
            }
            Some(_) if texts.len() > 1 => {
                let (first, second) = texts.split_at(texts.len() / 2);
                pending.extend([second, first]);
            }
            _ => {
                tracing::warn!("the model gave not one translation per text: {answer}");
                return Err(AiError::Model);
            }
        }
    }
    Ok(translated)
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
) -> Result<String, AiError> {
    let url = format!("{}/chat/completions", config.base_url.trim_end_matches('/'));
    let body = json!({
        "model": config.model,
        "messages": [{ "role": "system", "content": system }, { "role": "user", "content": user }],
    });
    let mut request = http.post(url).timeout(TIMEOUT).json(&body);
    if let Some(key) = &config.api_key {
        request = request.bearer_auth(key);
    }
    let answer = async {
        let response = successful(request.send().await.map_err(describe)?).await?;
        let completion: Completion = response.json().await.map_err(describe)?;
        let choice = completion.choices.into_iter().next();
        choice
            .map(|choice| choice.message.content)
            .ok_or_else(|| "The model gave no answer".to_string())
    };
    answer.await.map_err(|err| {
        tracing::warn!("the model failed: {err}");
        AiError::Model
    })
}

/// What an output is cached by: the model, the prompt, which tells what was asked for, and the text it was made
/// from.
fn key(config: &AiConfig, system: &str, text: &str) -> Vec<u8> {
    Sha256::new()
        .chain_update(&config.model)
        .chain_update(b"\0")
        .chain_update(system)
        .chain_update(b"\0")
        .chain_update(text)
        .finalize()
        .to_vec()
}

/// What was made of `kind` in `language` with `keys`, by key.
async fn cached(
    db: &DatabaseConnection,
    kind: &str,
    language: Language,
    keys: Vec<Vec<u8>>,
) -> Result<HashMap<Vec<u8>, String>, DbErr> {
    let rows = ai_cache::Entity::find()
        .filter(ai_cache::Column::Kind.eq(kind))
        .filter(ai_cache::Column::Language.eq(language.name()))
        .filter(ai_cache::Column::SourceHash.is_in(keys))
        .all(db)
        .await?;
    Ok(rows
        .into_iter()
        .map(|row| (row.source_hash, row.output))
        .collect())
}

/// Caches `outputs` of `kind` in `language` by their keys.
async fn store(
    db: &DatabaseConnection,
    kind: &str,
    language: Language,
    outputs: &[(Vec<u8>, String)],
) -> Result<(), DbErr> {
    let rows = outputs.iter().map(|(key, output)| ai_cache::ActiveModel {
        kind: Set(kind.into()),
        language: Set(language.name().into()),
        source_hash: Set(key.clone()),
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
