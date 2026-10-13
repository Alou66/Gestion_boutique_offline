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
CREATE UNIQUE INDEX `clients_name_unique` ON `clients` (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX `clients_phone_unique` ON `clients` (`phone`);--> statement-breakpoint
CREATE INDEX `clients_is_active_idx` ON `clients` (`is_active`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sale_id` integer NOT NULL,
	`amount` integer NOT NULL,
	`payment_date` integer NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "payments_amount_check" CHECK("payments"."amount" > 0)
);
--> statement-breakpoint
CREATE INDEX `payments_sale_id_idx` ON `payments` (`sale_id`);--> statement-breakpoint
CREATE INDEX `payments_payment_date_idx` ON `payments` (`payment_date`);--> statement-breakpoint
CREATE TABLE `sale_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sale_id` integer NOT NULL,
	`product_id` integer NOT NULL,
	`form` text NOT NULL,
	`quantity` real NOT NULL,
	`unit_price` integer NOT NULL,
	`line_total` integer NOT NULL,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "sale_items_quantity_check" CHECK("sale_items"."quantity" > 0),
	CONSTRAINT "sale_items_unit_price_check" CHECK("sale_items"."unit_price" >= 0),
	CONSTRAINT "sale_items_line_total_check" CHECK("sale_items"."line_total" >= 0)
);
--> statement-breakpoint
CREATE INDEX `sale_items_sale_id_idx` ON `sale_items` (`sale_id`);--> statement-breakpoint
CREATE INDEX `sale_items_product_id_idx` ON `sale_items` (`product_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `sale_items_sale_product_form_unique` ON `sale_items` (`sale_id`,`product_id`,`form`);--> statement-breakpoint
CREATE TABLE `sales` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`reference` text NOT NULL,
	`client_id` integer NOT NULL,
	`sale_date` integer NOT NULL,
	`status` text NOT NULL,
	`total_amount` integer NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "sales_status_check" CHECK("sales"."status" in ('VALIDEE', 'ANNULEE')),
	CONSTRAINT "sales_total_amount_check" CHECK("sales"."total_amount" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sales_reference_unique` ON `sales` (`reference`);--> statement-breakpoint
CREATE INDEX `sales_client_id_idx` ON `sales` (`client_id`);--> statement-breakpoint
CREATE INDEX `sales_sale_date_idx` ON `sales` (`sale_date`);--> statement-breakpoint
CREATE INDEX `sales_status_idx` ON `sales` (`status`);--> statement-breakpoint
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
CREATE UNIQUE INDEX `suppliers_name_unique` ON `suppliers` (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX `suppliers_phone_unique` ON `suppliers` (`phone`);--> statement-breakpoint
CREATE INDEX `suppliers_is_active_idx` ON `suppliers` (`is_active`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_stock_movements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer NOT NULL,
	`form` text NOT NULL,
	`movement_type` text NOT NULL,
	`direction` text NOT NULL,
	`quantity` real NOT NULL,
	`reason` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "stock_movements_quantity_check" CHECK("__new_stock_movements"."quantity" > 0),
	CONSTRAINT "stock_movements_direction_check" CHECK("__new_stock_movements"."direction" in ('IN', 'OUT')),
	CONSTRAINT "stock_movements_type_check" CHECK("__new_stock_movements"."movement_type" in ('STOCK_INITIAL', 'AJUSTEMENT', 'APPROVISIONNEMENT', 'TRANSFORMATION', 'SALE')),
	CONSTRAINT "stock_movements_initial_direction_check" CHECK("__new_stock_movements"."movement_type" <> 'STOCK_INITIAL' or "__new_stock_movements"."direction" = 'IN'),
	CONSTRAINT "stock_movements_supply_direction_check" CHECK("__new_stock_movements"."movement_type" <> 'APPROVISIONNEMENT' or "__new_stock_movements"."direction" = 'IN'),
	CONSTRAINT "stock_movements_reason_check" CHECK("__new_stock_movements"."movement_type" <> 'AJUSTEMENT' or ("__new_stock_movements"."reason" is not null and length(trim("__new_stock_movements"."reason")) > 0)),
	CONSTRAINT "stock_movements_transformation_reason_check" CHECK("__new_stock_movements"."movement_type" <> 'TRANSFORMATION' or "__new_stock_movements"."reason" is null),
	CONSTRAINT "stock_movements_sale_direction_check" CHECK("__new_stock_movements"."movement_type" <> 'SALE' or "__new_stock_movements"."direction" = 'OUT'),
	CONSTRAINT "stock_movements_sale_reason_check" CHECK("__new_stock_movements"."movement_type" <> 'SALE' or ("__new_stock_movements"."reason" is not null and length(trim("__new_stock_movements"."reason")) > 0))
);
--> statement-breakpoint
INSERT INTO `__new_stock_movements`("id", "product_id", "form", "movement_type", "direction", "quantity", "reason", "created_at") SELECT "id", "product_id", "form", "movement_type", "direction", "quantity", "reason", "created_at" FROM `stock_movements`;--> statement-breakpoint
DROP TABLE `stock_movements`;--> statement-breakpoint
ALTER TABLE `__new_stock_movements` RENAME TO `stock_movements`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `stock_movements_product_id_idx` ON `stock_movements` (`product_id`);--> statement-breakpoint
CREATE INDEX `stock_movements_product_form_idx` ON `stock_movements` (`product_id`,`form`);--> statement-breakpoint
CREATE UNIQUE INDEX `stock_movements_initial_unique` ON `stock_movements` (`product_id`,`form`) WHERE "stock_movements"."movement_type" = 'STOCK_INITIAL';--> statement-breakpoint
CREATE TABLE `__new_supply_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`supply_id` integer NOT NULL,
	`product_id` integer NOT NULL,
	`form` text NOT NULL,
	`quantity` real NOT NULL,
	`purchase_unit_price` integer NOT NULL,
	`line_total` integer NOT NULL,
	FOREIGN KEY (`supply_id`) REFERENCES `supplies`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "supply_items_quantity_check" CHECK("__new_supply_items"."quantity" > 0),
	CONSTRAINT "supply_items_purchase_unit_price_check" CHECK("__new_supply_items"."purchase_unit_price" >= 0),
	CONSTRAINT "supply_items_line_total_check" CHECK("__new_supply_items"."line_total" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_supply_items`("id", "supply_id", "product_id", "form", "quantity", "purchase_unit_price", "line_total") SELECT "id", "supply_id", "product_id", "form", "quantity", "purchase_unit_price", "line_total" FROM `supply_items`;--> statement-breakpoint
DROP TABLE `supply_items`;--> statement-breakpoint
ALTER TABLE `__new_supply_items` RENAME TO `supply_items`;--> statement-breakpoint
CREATE INDEX `supply_items_supply_id_idx` ON `supply_items` (`supply_id`);--> statement-breakpoint
CREATE INDEX `supply_items_product_id_idx` ON `supply_items` (`product_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `supply_items_supply_product_form_unique` ON `supply_items` (`supply_id`,`product_id`,`form`);--> statement-breakpoint
CREATE TABLE `__new_transformations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`reference` text NOT NULL,
	`product_id` integer NOT NULL,
	`source_form` text NOT NULL,
	`source_quantity` real NOT NULL,
	`destination_form` text NOT NULL,
	`destination_quantity` real NOT NULL,
	`date` integer NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "transformations_source_quantity_check" CHECK("__new_transformations"."source_quantity" > 0),
	CONSTRAINT "transformations_destination_quantity_check" CHECK("__new_transformations"."destination_quantity" > 0),
	CONSTRAINT "transformations_forms_check" CHECK("__new_transformations"."source_form" <> "__new_transformations"."destination_form")
);
--> statement-breakpoint
INSERT INTO `__new_transformations`("id", "reference", "product_id", "source_form", "source_quantity", "destination_form", "destination_quantity", "date", "created_at") SELECT "id", "reference", "product_id", "source_form", "source_quantity", "destination_form", "destination_quantity", "date", "created_at" FROM `transformations`;--> statement-breakpoint
DROP TABLE `transformations`;--> statement-breakpoint
ALTER TABLE `__new_transformations` RENAME TO `transformations`;--> statement-breakpoint
CREATE UNIQUE INDEX `transformations_reference_unique` ON `transformations` (`reference`);--> statement-breakpoint
CREATE INDEX `transformations_product_id_idx` ON `transformations` (`product_id`);--> statement-breakpoint
CREATE INDEX `transformations_date_idx` ON `transformations` (`date`);--> statement-breakpoint
ALTER TABLE `settings` ADD `address` text;--> statement-breakpoint
ALTER TABLE `settings` ADD `phone2` text;--> statement-breakpoint
ALTER TABLE `settings` ADD `ninea` text;--> statement-breakpoint
ALTER TABLE `supplies` ADD `supplier_id` integer REFERENCES suppliers(id);--> statement-breakpoint
CREATE INDEX `supplies_supplier_id_idx` ON `supplies` (`supplier_id`);