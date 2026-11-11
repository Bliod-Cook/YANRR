ALTER TABLE `ai_chat_sessions` DROP COLUMN `is_local`;--> statement-breakpoint
ALTER TABLE `entries` DROP COLUMN `sources`;--> statement-breakpoint
ALTER TABLE `feeds` DROP COLUMN `owner_user_id`;--> statement-breakpoint
ALTER TABLE `feeds` DROP COLUMN `tip_users`;--> statement-breakpoint
ALTER TABLE `subscriptions` DROP COLUMN `is_private`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `handle`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `bio`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `website`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `social_links`;