CREATE TABLE `dav_properties` (
	`backend_id` text NOT NULL,
	`path` text NOT NULL,
	`name` text NOT NULL,
	`xml` text NOT NULL,
	PRIMARY KEY(`backend_id`, `path`, `name`)
);
