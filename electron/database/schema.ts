import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'
import type { StockDirection, StockMovementType } from '../types'

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().defaultNow(),
})

export const settings = sqliteTable('settings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  shopName: text('shop_name').notNull(),
  phone: text('phone'),
  ownerName: text('owner_name'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().defaultNow(),
})

export const categories = sqliteTable('categories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().defaultNow(),
})

/**
 * Products are never deleted physically (they will carry stock, transformation,
 * sale and adjustment history): `isActive` is the only "removal" mechanism.
 *
 * Money is stored as whole FCFA in integer columns: no float is used for amounts.
 *
 * Transformation columns are NULL for a simple product. They are only filled when
 * `isTransformable` is true: 1 primary form = conversionQuantity secondary forms.
 *
 * `primary_form` is always filled: it is the single logical form of a simple
 * product (the unit its stock is counted in) and the reference form of a
 * transformable product.
 */
export const products = sqliteTable(
  'products',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    categoryId: integer('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    purchasePrice: integer('purchase_price').notNull(),
    salePrice: integer('sale_price').notNull(),
    isTransformable: integer('is_transformable', { mode: 'boolean' }).notNull().default(false),
    primaryForm: text('primary_form'),
    secondaryForm: text('secondary_form'),
    conversionQuantity: integer('conversion_quantity'),
    secondarySalePrice: integer('secondary_sale_price'),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().defaultNow(),
  },
  (table) => [
    // Product names keep their original case ("Chocopain 5 kg"), so the database
    // enforces the case-insensitive uniqueness itself instead of the renderer.
    uniqueIndex('products_name_unique').on(sql`lower(${table.name})`),
    index('products_category_id_idx').on(table.categoryId),
    check('products_purchase_price_check', sql`${table.purchasePrice} >= 0`),
    check('products_sale_price_check', sql`${table.salePrice} >= 0`),
  ],
)

/**
 * Stock is an append-only ledger: the current quantity of a form is always the
 * sum of its movements, never a column of `products`.
 *
 * `quantity` is always a strictly positive integer, `direction` carries the
 * sign (IN / OUT) and `movement_type` carries the origin of the movement.
 *
 * Business rules enforced by the database itself:
 * - `stock_movements_initial_unique` is a partial unique index on
 *   (product_id, form) for STOCK_INITIAL rows only: a form can never be
 *   initialized twice, even if the service layer is bypassed.
 * - STOCK_INITIAL is always IN and never carries a reason.
 * - AJUSTEMENT always carries a non empty reason.
 */
export const stockMovements = sqliteTable(
  'stock_movements',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    form: text('form').notNull(),
    movementType: text('movement_type').$type<StockMovementType>().notNull(),
    direction: text('direction').$type<StockDirection>().notNull(),
    quantity: integer('quantity').notNull(),
    reason: text('reason'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
  },
  (table) => [
    index('stock_movements_product_id_idx').on(table.productId),
    index('stock_movements_product_form_idx').on(table.productId, table.form),
    uniqueIndex('stock_movements_initial_unique')
      .on(table.productId, table.form)
      .where(sql`${table.movementType} = 'STOCK_INITIAL'`),
    check('stock_movements_quantity_check', sql`${table.quantity} > 0`),
    check(
      'stock_movements_direction_check',
      sql`${table.direction} in ('IN', 'OUT')`,
    ),
    check(
      'stock_movements_type_check',
      sql`${table.movementType} in ('STOCK_INITIAL', 'AJUSTEMENT')`,
    ),
    check(
      'stock_movements_initial_direction_check',
      sql`${table.movementType} <> 'STOCK_INITIAL' or ${table.direction} = 'IN'`,
    ),
    check(
      'stock_movements_reason_check',
      sql`${table.movementType} <> 'AJUSTEMENT' or (${table.reason} is not null and length(trim(${table.reason})) > 0)`,
    ),
  ],
)

export const schema = { users, settings, categories, products, stockMovements }
