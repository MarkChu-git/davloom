CREATE TABLE `verification_attempts` (
	`user_id` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`last_attempt` integer NOT NULL
);
