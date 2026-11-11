-- Unread marks belong to a subscription and go with it. Marks left without one are dropped first.
DELETE FROM unreads u WHERE NOT EXISTS (
    SELECT 1 FROM subscriptions s WHERE s.user_id = u.user_id AND s.feed_id = u.feed_id
);
ALTER TABLE unreads ADD CONSTRAINT unreads_subscription_fkey
    FOREIGN KEY (user_id, feed_id) REFERENCES subscriptions (user_id, feed_id) ON DELETE CASCADE;
