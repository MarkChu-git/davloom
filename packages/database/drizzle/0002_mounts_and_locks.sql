CREATE TABLE `dav_locks` (
	`token` text PRIMARY KEY NOT NULL,
	`root` text NOT NULL,
	`depth` text NOT NULL,
	`scope` text NOT NULL,
	`owner` text NOT NULL,
	`timeout` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `dav_locks_root_idx` ON `dav_locks` (`root`);--> statement-breakpoint
CREATE TABLE `mounts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`backend_id` text NOT NULL,
	`root` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`backend_id`) REFERENCES `storage_backends`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mounts_name_unique` ON `mounts` (`name`);