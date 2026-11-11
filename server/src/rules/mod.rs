//! Action rules: what a user has done to entries that meet conditions.

pub mod deliver;

use std::collections::HashMap;

use regex::Regex;
use sea_orm::{ColumnTrait, ConnectionTrait, DbErr, EntityTrait, QueryFilter};
use serde::{Deserialize, Serialize};
use serde_json::{Number, Value};

use crate::entity::{action_rule, entry, feed, subscription};

/// An entry as one user's rules see it.
#[derive(Clone, Copy)]
pub struct Subject<'a> {
    pub feed: &'a feed::Model,
    pub entry: &'a entry::Model,
    /// The view the user follows the feed in, if any.
    pub view: Option<i16>,
    /// The user's own title for the feed.
    pub title: Option<&'a str>,
    pub category: Option<&'a str>,
    pub read: bool,
    pub collected: bool,
}

impl<'a> Subject<'a> {
    /// A new entry arriving in a subscription, so neither read nor collected yet.
    pub fn arriving(
        feed: &'a feed::Model,
        entry: &'a entry::Model,
        subscription: &'a subscription::Model,
    ) -> Self {
        Self {
            feed,
            entry,
            view: Some(subscription.view),
            title: subscription.title.as_deref(),
            category: subscription.category.as_deref(),
            read: false,
            collected: false,
        }
    }
}

/// A user's rules, ready to match entries.
#[derive(Default)]
pub struct Rules {
    rules: Vec<Rule>,
    /// Regex conditions and block rules by pattern; one that does not compile is missing and never matches.
    patterns: HashMap<String, Regex>,
}

impl Rules {
    pub fn new(rules: Vec<Rule>) -> Self {
        let conditions = rules
            .iter()
            .flat_map(|rule| rule.condition.0.iter().flatten())
            .filter(|item| item.operator == Operator::Regex)
            .map(|item| item.value.clone());
        let block_rules = rules
            .iter()
            .flat_map(|rule| rule.result.block_rules.iter().flatten())
            .filter(|rule| rule.operator == Operator::Regex)
            .map(BlockRule::value);
        let patterns = conditions
            .chain(block_rules)
            .filter_map(|pattern| Some((pattern.clone(), Regex::new(&pattern).ok()?)))
            .collect();
        Self { rules, patterns }
    }

    /// Whether `settings`, which these rules gave, hide the entry: blocked outright, or by a block rule.
    pub fn blocks(&self, settings: &EntrySettings, entry: &entry::Model) -> bool {
        settings.block == Some(true)
            || settings
                .block_rules
                .iter()
                .flatten()
                .any(|rule| rule.holds(entry, &self.patterns))
    }

    /// The user's rules, none until they save some.
    pub async fn load(db: &impl ConnectionTrait, user_id: &str) -> Result<Self, DbErr> {
        let mut rules = Self::load_many(db, [user_id.to_string()]).await?;
        Ok(rules.remove(user_id).unwrap_or_default())
    }

    /// The rules of those users who saved some, by user id.
    pub async fn load_many(
        db: &impl ConnectionTrait,
        user_ids: impl IntoIterator<Item = String>,
    ) -> Result<HashMap<String, Self>, DbErr> {
        let rows = action_rule::Entity::find()
            .filter(action_rule::Column::UserId.is_in(user_ids))
            .all(db)
            .await?;
        rows.into_iter()
            .map(|row| {
                let rules = parse(row.rules).map_err(|err| DbErr::Json(err.to_string()))?;
                Ok((row.user_id, Self::new(rules)))
            })
            .collect()
    }

    /// Whether an enabled rule's condition reads the entry's content, so entries must be loaded with it.
    pub fn reads_content(&self) -> bool {
        self.rules
            .iter()
            .filter(|rule| rule.result.disabled != Some(true))
            .flat_map(|rule| rule.condition.0.iter().flatten())
            .any(|item| item.field == Field::EntryContent)
    }

    /// What the enabled rules matching the entry do together, or `None` when none matches.
    pub fn apply(&self, subject: &Subject) -> Option<EntrySettings> {
        combine(self.matching(subject))
    }

    /// What the enabled rules matching the collected entry only because it is collected do together, or `None`
    /// when none does.
    pub fn apply_collected(&self, subject: &Subject) -> Option<EntrySettings> {
        let uncollected = Subject {
            collected: false,
            ..*subject
        };
        let newly = self
            .matching(subject)
            .filter(|rule| !rule.condition.holds(&uncollected, &self.patterns));
        combine(newly)
    }

    fn matching<'r>(&'r self, subject: &'r Subject) -> impl Iterator<Item = &'r Rule> {
        self.rules
            .iter()
            .filter(|rule| rule.result.disabled != Some(true))
            .filter(|rule| rule.condition.holds(subject, &self.patterns))
    }
}

/// What the rules do together, or `None` when there are none.
fn combine<'r>(rules: impl Iterator<Item = &'r Rule>) -> Option<EntrySettings> {
    let mut rules = rules.peekable();
    rules.peek()?;
    let mut settings = EntrySettings::default();
    for rule in rules {
        settings.add(&rule.result);
    }
    Some(settings)
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Rule {
    pub name: String,
    pub condition: Condition,
    pub result: EntrySettings,
}

/// Groups of conditions: a rule applies when every condition of some group holds, or always when there is none.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(from = "Groups")]
pub struct Condition(pub Vec<Vec<ConditionItem>>);

/// Older clients wrote a single group as a flat list.
#[derive(Deserialize)]
#[serde(untagged)]
enum Groups {
    Nested(Vec<Vec<ConditionItem>>),
    Flat(Vec<ConditionItem>),
}

impl From<Groups> for Condition {
    fn from(groups: Groups) -> Self {
        match groups {
            Groups::Nested(groups) => Self(groups),
            Groups::Flat(group) => Self(vec![group]),
        }
    }
}

impl Condition {
    fn holds(&self, subject: &Subject, patterns: &HashMap<String, Regex>) -> bool {
        self.0.is_empty()
            || self
                .0
                .iter()
                .any(|group| group.iter().all(|item| item.holds(subject, patterns)))
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ConditionItem {
    pub field: Field,
    pub operator: Operator,
    pub value: String,
}

impl ConditionItem {
    fn holds(&self, subject: &Subject, patterns: &HashMap<String, Regex>) -> bool {
        let Subject { feed, entry, .. } = subject;
        let text = match self.field {
            Field::View => {
                let value = self.value.trim().parse::<i16>().ok();
                return (subject.view.zip(value))
                    .is_some_and(|(view, value)| equality(self.operator, view == value));
            }
            Field::Status => {
                let state = match self.value.as_str() {
                    "read" => subject.read,
                    "collected" => subject.collected,
                    _ => return false,
                };
                return equality(self.operator, state);
            }
            Field::EntryMediaLength => {
                return compare(self.operator, Some(media_length(entry)), &self.value);
            }
            Field::EntryAttachmentsDuration => {
                return compare(self.operator, duration(entry), &self.value);
            }
            Field::Title => subject.title.or(feed.title.as_deref()),
            Field::SiteUrl => feed.site_url.as_deref(),
            Field::FeedUrl => Some(feed.url.as_str()),
            Field::Category => subject.category,
            Field::EntryTitle => entry.title.as_deref(),
            Field::EntryContent => content(entry),
            Field::EntryUrl => entry.url.as_deref(),
            Field::EntryAuthor => entry.author.as_deref(),
        };
        let pattern = patterns.get(&self.value);
        matches_text(
            self.operator,
            &self.value,
            pattern,
            text.unwrap_or_default(),
        )
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Field {
    Title,
    View,
    SiteUrl,
    FeedUrl,
    Category,
    EntryTitle,
    EntryContent,
    EntryUrl,
    EntryAuthor,
    EntryMediaLength,
    EntryAttachmentsDuration,
    Status,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Operator {
    Contains,
    NotContains,
    Eq,
    NotEq,
    Gt,
    Lt,
    Regex,
}

/// What rules do to an entry. Kept as the client wrote it, `false` included, as clients count the keys present.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntrySettings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub translation: Option<Translation>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub readability: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_content: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub silence: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub block: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub star: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_entry_notification: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rewrite_rules: Option<Vec<RewriteRule>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub block_rules: Option<Vec<BlockRule>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub webhooks: Option<Vec<String>>,
}

impl EntrySettings {
    /// Adds what another matching rule does: a switch is on when some rule turns it on, and lists add up.
    fn add(&mut self, other: &Self) {
        let switches = [
            (&mut self.summary, other.summary),
            (&mut self.readability, other.readability),
            (&mut self.source_content, other.source_content),
            (&mut self.silence, other.silence),
            (&mut self.block, other.block),
            (&mut self.star, other.star),
            (
                &mut self.new_entry_notification,
                other.new_entry_notification,
            ),
        ];
        for (switch, other) in switches {
            if other == Some(true) {
                *switch = Some(true);
            }
        }
        if self.translation.is_none() && other.translation.as_ref().is_some_and(Translation::is_on)
        {
            self.translation.clone_from(&other.translation);
        }
        extend(&mut self.rewrite_rules, &other.rewrite_rules);
        extend(&mut self.block_rules, &other.block_rules);
        extend(&mut self.webhooks, &other.webhooks);
    }

    /// Replaces text in the entry's title, description and content, rule by rule.
    pub fn rewrite(&self, entry: &mut entry::Model) {
        let rules = self.rewrite_rules.iter().flatten();
        for rule in rules.filter(|rule| !rule.from.is_empty()) {
            let texts = [&mut entry.title, &mut entry.description, &mut entry.content];
            for text in texts.into_iter().flatten() {
                *text = text.replace(&rule.from, &rule.to);
            }
        }
    }
}

fn extend<T: Clone>(list: &mut Option<Vec<T>>, other: &Option<Vec<T>>) {
    if let Some(other) = other.as_ref().filter(|other| !other.is_empty()) {
        list.get_or_insert_default().extend_from_slice(other);
    }
}

/// On or off, or on into a language.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Translation {
    Enabled(bool),
    Language(String),
}

impl Translation {
    fn is_on(&self) -> bool {
        !matches!(self, Self::Enabled(false))
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RewriteRule {
    pub from: String,
    pub to: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct BlockRule {
    pub field: BlockField,
    pub operator: Operator,
    pub value: BlockValue,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BlockField {
    Title,
    All,
    Content,
    Author,
    Url,
    Order,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum BlockValue {
    Text(String),
    Number(Number),
}

impl BlockRule {
    fn value(&self) -> String {
        match &self.value {
            BlockValue::Text(text) => text.clone(),
            BlockValue::Number(number) => number.to_string(),
        }
    }

    fn holds(&self, entry: &entry::Model, patterns: &HashMap<String, Regex>) -> bool {
        let all;
        let text = match self.field {
            BlockField::Title => entry.title.as_deref(),
            BlockField::Content => content(entry),
            BlockField::Author => entry.author.as_deref(),
            BlockField::Url => entry.url.as_deref(),
            BlockField::All => {
                let fields = [
                    entry.title.as_deref(),
                    content(entry),
                    entry.author.as_deref(),
                    entry.url.as_deref(),
                ];
                all = fields.map(Option::unwrap_or_default).join("\n");
                Some(all.as_str())
            }
            // What `order` refers to is unknown.
            BlockField::Order => return false,
        };
        let value = self.value();
        let pattern = patterns.get(&value);
        matches_text(self.operator, &value, pattern, text.unwrap_or_default())
    }
}

/// Rules as stored.
pub fn parse(rules: Value) -> Result<Vec<Rule>, serde_json::Error> {
    serde_json::from_value(rules)
}

/// Text comparisons ignore case; a pattern decides that for itself.
fn matches_text(operator: Operator, value: &str, pattern: Option<&Regex>, text: &str) -> bool {
    let contains = || text.to_lowercase().contains(&value.to_lowercase());
    let equals = || text.to_lowercase() == value.to_lowercase();
    match operator {
        Operator::Contains => contains(),
        Operator::NotContains => !contains(),
        Operator::Eq => equals(),
        Operator::NotEq => !equals(),
        Operator::Regex => pattern.is_some_and(|pattern| pattern.is_match(text)),
        Operator::Gt | Operator::Lt => false,
    }
}

fn equality(operator: Operator, equal: bool) -> bool {
    match operator {
        Operator::Eq => equal,
        Operator::NotEq => !equal,
        _ => false,
    }
}

/// Compares a number with the condition's value; nothing holds when either is missing.
fn compare(operator: Operator, actual: Option<f64>, value: &str) -> bool {
    let (Some(actual), Ok(value)) = (actual, value.trim().parse::<f64>()) else {
        return false;
    };
    match operator {
        Operator::Eq => actual == value,
        Operator::NotEq => actual != value,
        Operator::Gt => actual > value,
        Operator::Lt => actual < value,
        _ => false,
    }
}

/// The entry's content, or its description when it has none.
fn content(entry: &entry::Model) -> Option<&str> {
    entry.content.as_deref().or(entry.description.as_deref())
}

fn media_length(entry: &entry::Model) -> f64 {
    let media = entry.media.as_ref().and_then(Value::as_array);
    media.map_or(0, Vec::len) as f64
}

/// The attachments' total duration in seconds, if any has one.
fn duration(entry: &entry::Model) -> Option<f64> {
    let attachments = entry.attachments.as_ref()?.as_array()?;
    attachments
        .iter()
        .filter_map(|attachment| attachment.get("duration_in_seconds")?.as_f64())
        .reduce(|total, duration| total + duration)
}

#[cfg(test)]
mod tests {
    use chrono::Utc;
    use serde_json::json;

    use super::*;

    fn feed() -> feed::Model {
        feed::Model {
            id: 1,
            url: "rsshub://example/news".into(),
            title: Some("Example News".into()),
            description: None,
            image: None,
            site_url: Some("https://example.com".into()),
            language: None,
            ttl: None,
            etag_header: None,
            last_modified_header: None,
            checked_at: Utc::now(),
            refresh_enqueued_at: None,
            error_message: None,
            error_at: None,
            migrate_to: None,
        }
    }

    fn entry() -> entry::Model {
        entry::Model {
            id: 2,
            feed_id: 1,
            guid: "post".into(),
            title: Some("Rust News".into()),
            url: Some("https://example.com/post".into()),
            description: Some("A summary".into()),
            content: Some("<p>Rust body</p>".into()),
            author: Some("Alice".into()),
            author_url: None,
            author_avatar: None,
            categories: None,
            media: Some(json!([{ "url": "a.png" }, { "url": "b.png" }])),
            attachments: Some(json!([
                { "url": "a.mp3", "duration_in_seconds": 60 },
                { "url": "b.mp3", "duration_in_seconds": 30 },
            ])),
            extra: None,
            language: None,
            published_at: Utc::now(),
            inserted_at: Utc::now(),
        }
    }

    fn rules(rules: Value) -> Rules {
        Rules::new(serde_json::from_value(rules).unwrap())
    }

    fn rule(condition: Value, result: Value) -> Value {
        json!({ "name": "rule", "condition": condition, "result": result })
    }

    fn apply(rules: &Rules, entry: &entry::Model) -> Option<EntrySettings> {
        let feed = feed();
        let subject = Subject {
            feed: &feed,
            entry,
            view: Some(2),
            title: Some("My Feed"),
            category: Some("Tech"),
            read: false,
            collected: true,
        };
        rules.apply(&subject)
    }

    #[test]
    fn conditions_compare_fields_by_their_type() {
        let cases = [
            ("title", "contains", "my feed", true),
            ("title", "eq", "Example News", false),
            ("view", "eq", "2", true),
            ("view", "not_eq", "2", false),
            ("view", "eq", "two", false),
            ("site_url", "contains", "EXAMPLE.com", true),
            ("feed_url", "eq", "rsshub://example/news", true),
            ("category", "eq", "tech", true),
            ("entry_title", "not_contains", "rust", false),
            ("entry_title", "gt", "1", false),
            ("entry_content", "contains", "body", true),
            ("entry_url", "regex", r"^https://example\.com/", true),
            ("entry_author", "regex", "alice", false),
            ("entry_author", "regex", "(?i)alice", true),
            ("entry_author", "regex", "(", false),
            ("entry_media_length", "eq", "2", true),
            ("entry_media_length", "lt", "2", false),
            ("entry_media_length", "eq", "", false),
            ("entry_attachments_duration", "eq", "90", true),
            ("entry_attachments_duration", "gt", "100", false),
            ("status", "eq", "read", false),
            ("status", "not_eq", "read", true),
            ("status", "eq", "collected", true),
        ];
        let entry = entry();
        for (field, operator, value, expected) in cases {
            let item = json!({ "field": field, "operator": operator, "value": value });
            let rules = rules(json!([rule(json!([[item]]), json!({ "star": true }))]));
            assert_eq!(
                apply(&rules, &entry).is_some(),
                expected,
                "{field} {operator} {value:?}"
            );
        }
        let mut silent = entry;
        silent.attachments = None;
        let item =
            json!({ "field": "entry_attachments_duration", "operator": "lt", "value": "10" });
        let rules = rules(json!([rule(json!([[item]]), json!({}))]));
        assert!(apply(&rules, &silent).is_none());
    }

    #[test]
    fn matching_rules_add_up() {
        let yes = json!({ "field": "entry_title", "operator": "contains", "value": "rust" });
        let no = json!({ "field": "entry_title", "operator": "contains", "value": "go" });
        let rules = rules(json!([
            rule(
                json!([]),
                json!({ "summary": true, "readability": false, "webhooks": ["https://a.example"] })
            ),
            rule(
                json!([[no, yes], [yes]]),
                json!({ "readability": true, "translation": "ja", "disabled": false })
            ),
            rule(json!([[no]]), json!({ "star": true })),
            rule(json!([]), json!({ "star": true, "disabled": true })),
            rule(
                json!([]),
                json!({ "translation": "en", "webhooks": ["https://b.example"] })
            ),
        ]));

        let settings = apply(&rules, &entry()).unwrap();

        assert_eq!(
            json!(settings),
            json!({
                "summary": true,
                "readability": true,
                "translation": "ja",
                "webhooks": ["https://a.example", "https://b.example"],
            })
        );
        assert!(
            apply(
                &self::rules(json!([rule(json!([[no]]), json!({}))])),
                &entry()
            )
            .is_none()
        );
    }

    #[test]
    fn block_rules_hide_entries() {
        let blocks = |result: Value| {
            let rules = rules(json!([rule(json!([]), result)]));
            let entry = entry();
            let settings = apply(&rules, &entry).unwrap();
            rules.blocks(&settings, &entry)
        };
        let block_rule = |field: &str, operator: &str, value: Value| json!({ "blockRules": [{ "field": field, "operator": operator, "value": value }] });

        assert!(blocks(json!({ "block": true })));
        assert!(!blocks(json!({ "block": false, "star": true })));
        assert!(blocks(block_rule("all", "contains", json!("alice"))));
        assert!(!blocks(block_rule("all", "not_contains", json!("alice"))));
        assert!(blocks(block_rule("url", "regex", json!("/post$"))));
        assert!(!blocks(block_rule("url", "regex", json!("("))));
        assert!(blocks(block_rule("title", "eq", json!("rust news"))));
        assert!(!blocks(block_rule("order", "gt", json!(0))));
    }

    #[test]
    fn rewrite_rules_replace_text_in_order() {
        let settings: EntrySettings = serde_json::from_value(json!({ "rewriteRules": [
            { "from": "Rust", "to": "Go" },
            { "from": "Go body", "to": "Go text" },
            { "from": "", "to": "x" },
        ] }))
        .unwrap();
        let mut entry = entry();

        settings.rewrite(&mut entry);

        assert_eq!(entry.title.as_deref(), Some("Go News"));
        assert_eq!(entry.description.as_deref(), Some("A summary"));
        assert_eq!(entry.content.as_deref(), Some("<p>Go text</p>"));
    }
}
