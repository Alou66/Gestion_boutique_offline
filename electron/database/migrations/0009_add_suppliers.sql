-- Suppliers table: a supplier provides goods to the shop. Suppliers are never
-- deleted physically: `isActive` is the only "removal" mechanism. The system
-- supplier "FOURNISSEUR COMPTANT" is created automatically and cannot be
-- modified, deactivated or deleted.
CREATE TABLE `suppliers` (
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
CREATE UNIQUE INDEX `suppliers_name_unique` ON `suppliers` (lower(`name`));
--> statement-breakpoint
CREATE UNIQUE INDEX `suppliers_phone_unique` ON `suppliers` (`phone`);
--> statement-breakpoint
CREATE INDEX `suppliers_is_active_idx` ON `suppliers` (`is_active`);
--> statement-breakpoint
-- The `supplies` table gains a nullable FK to `suppliers`. The existing
-- `supplier_name` free-text column is kept as a snapshot for backward
-- compatibility; it is always populated from the supplier row when
-- `supplier_id` is set.
ALTER TABLE `supplies` ADD COLUMN `supplier_id` integer REFERENCES `suppliers`(`id`) ON UPDATE cascade ON DELETE restrict;
--> statement-breakpoint
CREATE INDEX `supplies_supplier_id_idx` ON `supplies` (`supplier_id`);