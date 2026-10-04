CREATE TABLE `products` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`category_id` integer NOT NULL,
	`purchase_price` integer NOT NULL,
	`sale_price` integer NOT NULL,
	`is_transformable` integer DEFAULT false NOT NULL,
	`primary_form` text,
	`secondary_form` text,
	`conversion_quantity` integer,
	`secondary_sale_price` integer,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "products_purchase_price_check" CHECK("products"."purchase_price" >= 0),
	CONSTRAINT "products_sale_price_check" CHECK("products"."sale_price" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `products_name_unique` ON `products` (lower("name"));--> statement-breakpoint
CREATE INDEX `products_category_id_idx` ON `products` (`category_id`);