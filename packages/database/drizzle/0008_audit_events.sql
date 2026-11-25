CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`at` integer NOT NULL,
	`action` text NOT NULL,
	`outcome` text NOT NULL,
	`address` text,
	`target` text,
	`count` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_events_at_idx` ON `audit_events` (`at`,`id`);