DELETE FROM `subscriptions` WHERE `type` = 'list';--> statement-breakpoint
DROP TABLE `lists`;--> statement-breakpoint
ALTER TABLE `subscriptions` DROP COLUMN `list_id`;