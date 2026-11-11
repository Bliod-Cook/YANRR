DROP TABLE `translations`;--> statement-breakpoint
CREATE TABLE `translations` (
	`entry_id` text NOT NULL,
	`language` text NOT NULL,
	`mode` text NOT NULL,
	`title` text,
	`description` text,
	`content` text,
	`readability_content` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `translation-unique-index` ON `translations` (`entry_id`,`language`,`mode`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_summaries` (
	`entry_id` text NOT NULL,
	`summary` text NOT NULL,
	`readability_summary` text,
	`created_at` text,
	`language` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_summaries`("entry_id", "summary", "readability_summary", "created_at", "language") SELECT "entry_id", "summary", "readability_summary", "created_at", "language" FROM `summaries` WHERE "language" IS NOT NULL;--> statement-breakpoint
DROP TABLE `summaries`;--> statement-breakpoint
ALTER TABLE `__new_summaries` RENAME TO `summaries`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `unq` ON `summaries` (`entry_id`,`language`);--> statement-breakpoint
ALTER TABLE `feeds` DROP COLUMN `subscription_count`;--> statement-breakpoint
ALTER TABLE `feeds` DROP COLUMN `updates_per_week`;--> statement-breakpoint
ALTER TABLE `feeds` DROP COLUMN `latest_entry_published_at`;
