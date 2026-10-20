use chrono::{DateTime, SecondsFormat, Utc};

/// ISO 8601 with milliseconds, as JavaScript's `Date.toISOString` writes it.
pub fn iso(time: DateTime<Utc>) -> String {
    time.to_rfc3339_opts(SecondsFormat::Millis, true)
}
