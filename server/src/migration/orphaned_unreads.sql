-- Drops unread marks left without a subscription by marking an entry unread while unsubscribing; they made
-- following the feed again fail.
DELETE FROM unreads u WHERE NOT EXISTS (
    SELECT 1 FROM subscriptions s WHERE s.user_id = u.user_id AND s.feed_id = u.feed_id
);
