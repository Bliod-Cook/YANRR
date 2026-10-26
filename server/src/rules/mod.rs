//! Action rules: what a user has done to entries that meet conditions.

use serde::{Deserialize, Serialize};
use serde_json::{Number, Value};

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

#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ConditionItem {
    pub field: Field,
    pub operator: Operator,
    pub value: String,
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

/// On or off, or on into a language.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Translation {
    Enabled(bool),
    Language(String),
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

/// Rules as stored.
pub fn parse(rules: Value) -> Result<Vec<Rule>, serde_json::Error> {
    serde_json::from_value(rules)
}
