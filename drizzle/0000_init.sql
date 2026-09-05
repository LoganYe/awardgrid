CREATE TABLE `api_usage` (
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`day` text NOT NULL,
	`calls` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`user_id`, `provider`, `day`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `ask_usage` (
	`user_id` text NOT NULL,
	`day` text NOT NULL,
	`cost_micro_usd` integer DEFAULT 0 NOT NULL,
	`requests` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`user_id`, `day`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `availability_cache` (
	`user_id` text NOT NULL,
	`program` text NOT NULL,
	`origin` text NOT NULL,
	`dest` text NOT NULL,
	`date` text NOT NULL,
	`cabin` text NOT NULL,
	`miles` integer NOT NULL,
	`fees_cents` integer,
	`currency` text,
	`seats_left` integer DEFAULT 0 NOT NULL,
	`direct` integer DEFAULT false NOT NULL,
	`airlines` text DEFAULT '[]' NOT NULL,
	`computed_last_seen` text NOT NULL,
	`source_id` text NOT NULL,
	`booking_url` text,
	`fetched_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `program`, `origin`, `dest`, `date`, `cabin`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `availability_cache_lookup_idx` ON `availability_cache` (`user_id`,`origin`,`dest`,`date`);--> statement-breakpoint
CREATE TABLE `cache_coverage` (
	`user_id` text NOT NULL,
	`origin` text NOT NULL,
	`dest` text NOT NULL,
	`date` text NOT NULL,
	`cabin` text NOT NULL,
	`programs_key` text NOT NULL,
	`fetched_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `origin`, `dest`, `date`, `cabin`, `programs_key`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `invite_codes` (
	`code` text PRIMARY KEY NOT NULL,
	`created_by` text NOT NULL,
	`intended_for` text,
	`created_at` text NOT NULL,
	`used_by` text,
	`used_at` text
);
--> statement-breakpoint
CREATE TABLE `query_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`saved_query_id` text NOT NULL,
	`ran_at` text NOT NULL,
	`cells_hash` text NOT NULL,
	`cells_json` text DEFAULT '[]' NOT NULL,
	`new_cells` integer DEFAULT 0 NOT NULL,
	`dropped_cells` integer DEFAULT 0 NOT NULL,
	`notified` integer DEFAULT false NOT NULL,
	`skipped_reason` text,
	FOREIGN KEY (`saved_query_id`) REFERENCES `saved_queries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `query_runs_saved_query_idx` ON `query_runs` (`saved_query_id`,`ran_at`);--> statement-breakpoint
CREATE TABLE `routes_cache` (
	`user_id` text NOT NULL,
	`source` text NOT NULL,
	`routes_json` text NOT NULL,
	`fetched_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `source`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `saved_queries` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`query_json` text NOT NULL,
	`schedule_cron` text DEFAULT '0 */3 * * *' NOT NULL,
	`notify_on` text DEFAULT 'both' NOT NULL,
	`drop_threshold_pct` integer DEFAULT 10 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`last_run_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `saved_queries_user_idx` ON `saved_queries` (`user_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `telegram_link_tokens` (
	`token` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user_keys` (
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`ciphertext` text NOT NULL,
	`iv` text NOT NULL,
	`tag` text NOT NULL,
	`last4` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `provider`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`telegram_chat_id` text,
	`quiet_hours_start` text,
	`quiet_hours_end` text,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`locale` text DEFAULT 'en' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);