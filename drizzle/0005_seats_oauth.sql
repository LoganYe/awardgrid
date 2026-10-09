CREATE TABLE `seats_connections` (
	`user_id` text PRIMARY KEY NOT NULL,
	`ciphertext` text NOT NULL,
	`iv` text NOT NULL,
	`tag` text NOT NULL,
	`expires_at` text NOT NULL,
	`generation` integer DEFAULT 1 NOT NULL,
	`connected_at` text NOT NULL,
	`refreshed_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `seats_oauth_states` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `seats_oauth_states_user_idx` ON `seats_oauth_states` (`user_id`);--> statement-breakpoint
ALTER TABLE `query_runs` ADD `cells_purged_at` text;--> statement-breakpoint
ALTER TABLE `users` ADD `seats_reconnect_notice` integer DEFAULT false NOT NULL;--> statement-breakpoint
-- The web app moves to Login with Seats.aero: every pasted seats.aero key is deleted, and its account is flagged so
-- Settings and the search pages ask, once, to connect seats.aero instead (src/lib/seats-oauth).
UPDATE `users` SET `seats_reconnect_notice` = 1 WHERE `id` IN (SELECT `user_id` FROM `user_keys` WHERE `provider` = 'seats_aero');--> statement-breakpoint
DELETE FROM `user_keys` WHERE `provider` = 'seats_aero';
