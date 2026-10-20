use std::{
    sync::atomic::{AtomicI64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

/// Folo clients only treat 13–19 digit snowflakes on this epoch as real feed and entry ids (`isBizId`).
const EPOCH_MS: i64 = 1_712_546_615_000;
const TIMESTAMP_SHIFT: u32 = 22;

static LAST: AtomicI64 = AtomicI64::new(0);

/// Returns a unique, increasing snowflake id.
pub fn next_id() -> i64 {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;
    let floor = (now - EPOCH_MS) << TIMESTAMP_SHIFT;
    let previous = LAST
        .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |last| {
            Some(floor.max(last + 1))
        })
        .unwrap();
    floor.max(previous + 1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_increase_and_carry_folo_epoch_timestamp() {
        let (a, b) = (next_id(), next_id());
        assert!(b > a);
        let digits = a.to_string().len();
        assert!((13..=19).contains(&digits));
        let ms = (a >> TIMESTAMP_SHIFT) + EPOCH_MS;
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64;
        assert!((now - ms).abs() < 1_000);
    }
}
