CREATE TABLE `stock_movements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer NOT NULL,
	`form` text NOT NULL,
	`movement_type` text NOT NULL,
	`direction` text NOT NULL,
	`quantity` integer NOT NULL,
	`reason` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "stock_movements_quantity_check" CHECK("stock_movements"."quantity" > 0),
	CONSTRAINT "stock_movements_direction_check" CHECK("stock_movements"."direction" in ('IN', 'OUT')),
	CONSTRAINT "stock_movements_type_check" CHECK("stock_movements"."movement_type" in ('STOCK_INITIAL', 'AJUSTEMENT')),
	CONSTRAINT "stock_movements_initial_direction_check" CHECK("stock_movements"."movement_type" <> 'STOCK_INITIAL' or "stock_movements"."direction" = 'IN'),
	CONSTRAINT "stock_movements_reason_check" CHECK("stock_movements"."movement_type" <> 'AJUSTEMENT' or ("stock_movements"."reason" is not null and length(trim("stock_movements"."reason")) > 0))
);
--> statement-breakpoint
CREATE INDEX `stock_movements_product_id_idx` ON `stock_movements` (`product_id`);--> statement-breakpoint
CREATE INDEX `stock_movements_product_form_idx` ON `stock_movements` (`product_id`,`form`);--> statement-breakpoint
CREATE UNIQUE INDEX `stock_movements_initial_unique` ON `stock_movements` (`product_id`,`form`) WHERE "stock_movements"."movement_type" = 'STOCK_INITIAL';--> statement-breakpoint
-- Backfill: a simple product now carries its single logical form in primary_form,
-- which is the unit its stock is counted in. Rows created before that rule are
-- filled with a neutral unit instead of being dropped or rebuilt.
UPDATE `products` SET `primary_form` = 'UNITE' WHERE `is_transformable` = 0 AND (`primary_form` IS NULL OR trim(`primary_form`) = '');
