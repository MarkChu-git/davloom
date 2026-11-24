CREATE TABLE `operation_errors` (
	`id` text PRIMARY KEY NOT NULL,
	`at` integer NOT NULL,
	`method` text NOT NULL,
	`path` text NOT NULL,
	`destination` text,
	`status` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `operation_errors_at_idx` ON `operation_errors` (`at`);--> statement-breakpoint
CREATE TABLE `operation_hours` (
	`hour` integer PRIMARY KEY NOT NULL,
	`operations` integer NOT NULL,
	`failed` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
