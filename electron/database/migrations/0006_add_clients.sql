CREATE TABLE `clients` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`phone` text NOT NULL,
	`address` text,
	`is_active` integer DEFAULT true NOT NULL,
	`is_system` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clients_name_unique` ON `clients` (lower(`name`));
--> statement-breakpoint
CREATE UNIQUE INDEX `clients_phone_unique` ON `clients` (`phone`);
--> statement-breakpoint
CREATE INDEX `clients_is_active_idx` ON `clients` (`is_active`);