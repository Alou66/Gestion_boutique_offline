import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'
import type { SaleStatus, StockDirection, StockMovementType } from '../types'

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
  address: text('address'),
  phone: text('phone'),
  phone2: text('phone2'),
  ninea: text('ninea'),
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
 * - APPROVISIONNEMENT is always IN (a reception can only increase the stock) and
 *   carries no reason: its origin is the supply document it comes from.
 * - TRANSFORMATION is the only movement type that exists in both directions: it
 *   moves a quantity from one form of the product to its other form, so it is
 *   OUT on the source form and IN on the destination form. Both movements of one
 *   document are always written together by the transformation service, in a
 *   single transaction. It carries no reason: its origin is the transformation
 *   document it comes from.
 * - SALE is the OUT movement written by a facture (VTE-000001) when it is
 *   created or when its content grows: it always names the facture it comes from
 *   as its reason ("Facture VTE-000001"), like AJUSTEMENT does. It is always
 *   OUT, never IN: the movements that give a stock back (modification of an
 *   unpaid facture, cancellation) are AJUSTEMENT entries naming the same
 *   facture, so a movement is never deleted to undo a previous one.
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
      sql`${table.movementType} in ('STOCK_INITIAL', 'AJUSTEMENT', 'APPROVISIONNEMENT', 'TRANSFORMATION', 'SALE')`,
    ),
    check(
      'stock_movements_initial_direction_check',
      sql`${table.movementType} <> 'STOCK_INITIAL' or ${table.direction} = 'IN'`,
    ),
    check(
      'stock_movements_supply_direction_check',
      sql`${table.movementType} <> 'APPROVISIONNEMENT' or ${table.direction} = 'IN'`,
    ),
    check(
      'stock_movements_reason_check',
      sql`${table.movementType} <> 'AJUSTEMENT' or (${table.reason} is not null and length(trim(${table.reason})) > 0)`,
    ),
    // A transformation is a transfer, never a loss: the OUT half and the IN half
    // are the two sides of one document, so the table itself refuses a null
    // quantity and the service always writes both rows together.
    check(
      'stock_movements_transformation_reason_check',
      sql`${table.movementType} <> 'TRANSFORMATION' or ${table.reason} is null`,
    ),
    // A SALE only ever removes stock: it is OUT, and it always names the facture
    // that created it.
    check(
      'stock_movements_sale_direction_check',
      sql`${table.movementType} <> 'SALE' or ${table.direction} = 'OUT'`,
    ),
    check(
      'stock_movements_sale_reason_check',
      sql`${table.movementType} <> 'SALE' or (${table.reason} is not null and length(trim(${table.reason})) > 0)`,
    ),
  ],
)

/**
 * A supply (approvisionnement) is an immutable reception document: its header
 * carries the automatic reference, the reception date and the total recomputed
 * from its lines. The shopkeeper never types the reference nor the total.
 *
 * There is now a real `suppliers` table: `supplierId` is a nullable FK to it.
 * The `supplierName` column is kept as a free-text snapshot for backward
 * compatibility and for documents created before the supplier table existed;
 * it is always populated from the supplier row when `supplierId` is set.
 *
 * Money is stored as whole FCFA in integer columns, like every other amount of
 * the project: no float is used.
 */
export const supplies = sqliteTable(
  'supplies',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** APP-000001, APP-000002, ... generated by the service, unique. */
    reference: text('reference').notNull(),
    /** FK to the `suppliers` table, NULL when the document has no supplier. */
    supplierId: integer('supplier_id').references(() => suppliers.id, {
      onDelete: 'restrict',
      onUpdate: 'cascade',
    }),
    /** Free text snapshot, populated from the supplier row when `supplierId` is set. */
    supplierName: text('supplier_name'),
    /** Reception date (local midnight), as typed by the shopkeeper. */
    date: integer('date', { mode: 'timestamp' }).notNull(),
    /** Sum of the line totals, recomputed by the service before insertion. */
    totalAmount: integer('total_amount').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('supplies_reference_unique').on(table.reference),
    index('supplies_date_idx').on(table.date),
    index('supplies_supplier_id_idx').on(table.supplierId),
    check('supplies_total_amount_check', sql`${table.totalAmount} >= 0`),
  ],
)

/**
 * One received line of a supply. `form` is the form physically received (a
 * transformable product can be supplied in either of its two forms, with no
 * automatic conversion) and `purchase_unit_price` is the real price paid for
 * that document: the price of the product can change later without rewriting
 * the history.
 */
export const supplyItems = sqliteTable(
  'supply_items',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    supplyId: integer('supply_id')
      .notNull()
      .references(() => supplies.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    form: text('form').notNull(),
    quantity: integer('quantity').notNull(),
    purchaseUnitPrice: integer('purchase_unit_price').notNull(),
    /** Always quantity * purchase_unit_price, recomputed by the service. */
    lineTotal: integer('line_total').notNull(),
  },
  (table) => [
    index('supply_items_supply_id_idx').on(table.supplyId),
    index('supply_items_product_id_idx').on(table.productId),
    // The same product cannot be received twice in the same form on one
    // document: the shopkeeper must group the quantities instead.
    uniqueIndex('supply_items_supply_product_form_unique').on(
      table.supplyId,
      table.productId,
      table.form,
    ),
    check('supply_items_quantity_check', sql`${table.quantity} > 0`),
    check('supply_items_purchase_unit_price_check', sql`${table.purchaseUnitPrice} >= 0`),
    check('supply_items_line_total_check', sql`${table.lineTotal} >= 0`),
  ],
)

/**
 * A transformation is an immutable document that moves a quantity from one form
 * of a transformable product to its other form. It never creates stock: the OUT
 * movement on the source form and the IN movement on the destination form are
 * both written in the same transaction as this header.
 *
 * `source_form` and `destination_form` are the two forms of the product and can
 * never be equal. `source_quantity` and `destination_quantity` are strictly
 * positive whole numbers computed from the conversion of the product
 * (1 primary form = conversion_quantity secondary forms), never typed by the
 * shopkeeper and never rounded.
 *
 * The purchase price of the product is never touched by a transformation: it is
 * a conversion of the same product, not a reception.
 */
export const transformations = sqliteTable(
  'transformations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** TRF-000001, TRF-000002, ... generated by the service, unique. */
    reference: text('reference').notNull(),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    /** Form taken out of the stock (CARTON or SEAU). */
    sourceForm: text('source_form').notNull(),
    /** Strictly positive whole number of units removed from `source_form`. */
    sourceQuantity: integer('source_quantity').notNull(),
    /** Form put into the stock, always the other form of the product. */
    destinationForm: text('destination_form').notNull(),
    /** Strictly positive whole number of units added to `destination_form`. */
    destinationQuantity: integer('destination_quantity').notNull(),
    /** Transformation day (local midnight), as typed by the shopkeeper. */
    date: integer('date', { mode: 'timestamp' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('transformations_reference_unique').on(table.reference),
    index('transformations_product_id_idx').on(table.productId),
    index('transformations_date_idx').on(table.date),
    check('transformations_source_quantity_check', sql`${table.sourceQuantity} > 0`),
    check('transformations_destination_quantity_check', sql`${table.destinationQuantity} > 0`),
    check(
      'transformations_forms_check',
      sql`${table.sourceForm} <> ${table.destinationForm}`,
    ),
  ],
)

/**
 * A client represents a customer of the shop. Clients are never deleted
 * physically: `isActive` is the only "removal" mechanism. The system client
 * "CLIENT COMPTANT" is created automatically and cannot be modified,
 * deactivated or deleted.
 */
export const clients = sqliteTable(
  'clients',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    phone: text('phone').notNull(),
    address: text('address'),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    isSystem: integer('is_system', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('clients_name_unique').on(sql`lower(${table.name})`),
    uniqueIndex('clients_phone_unique').on(table.phone),
    index('clients_is_active_idx').on(table.isActive),
  ],
)

/**
 * A supplier provides goods to the shop. Suppliers are never deleted physically:
 * `isActive` is the only "removal" mechanism. The system supplier
 * "FOURNISSEUR COMPTANT" is created automatically and cannot be modified,
 * deactivated or deleted.
 */
export const suppliers = sqliteTable(
  'suppliers',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    phone: text('phone').notNull(),
    address: text('address'),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    isSystem: integer('is_system', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().defaultNow(),
  },
  (table) => [
    // Supplier names keep their original case ("SODEXO 5 kg"), so the database
    // enforces the case-insensitive uniqueness itself instead of the renderer.
    uniqueIndex('suppliers_name_unique').on(sql`lower(${table.name})`),
    uniqueIndex('suppliers_phone_unique').on(table.phone),
    index('suppliers_is_active_idx').on(table.isActive),
  ],
)

/**
 * A sale (a facture) is the commercial document of a sale. Its header carries
 * the automatic reference (VTE-000001), the sale date, the client (always
 * present: the system client "CLIENT COMPTANT" is used when none is selected),
 * the status (VALIDEE at creation, ANNULEE after a cancellation) and the total
 * recomputed from its lines. A sale is never physically deleted: it is cancelled
 * (ANNULEE) and then optionally physically removed, and only when it carries no
 * payment at all.
 *
 * Money is stored as whole FCFA in integer columns, like every other amount of
 * the project: no float is used.
 */
export const sales = sqliteTable(
  'sales',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** VTE-000001, VTE-000002, ... generated by the service, unique. */
    reference: text('reference').notNull(),
    /** A sale always has a client: the system client is used when none is selected. */
    clientId: integer('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    /** Sale day (local midnight), as typed by the shopkeeper. */
    saleDate: integer('sale_date', { mode: 'timestamp' }).notNull(),
    /**
     * VALIDEE at creation, ANNULEE after a cancellation. A cancelled sale can be
     * physically deleted, a validated one can never be.
     */
    status: text('status').$type<SaleStatus>().notNull(),
    /** Sum of the line totals, recomputed by the service before insertion. */
    totalAmount: integer('total_amount').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('sales_reference_unique').on(table.reference),
    index('sales_client_id_idx').on(table.clientId),
    index('sales_sale_date_idx').on(table.saleDate),
    index('sales_status_idx').on(table.status),
    check('sales_status_check', sql`${table.status} in ('VALIDEE', 'ANNULEE')`),
    check('sales_total_amount_check', sql`${table.totalAmount} >= 0`),
  ],
)

/**
 * One line of a sale. `form` is the form really sold (a transformable product can
 * be sold in either of its two forms, with no automatic conversion) and
 * `unit_price` is the real price applied on this document: the price of the
 * product can change later without rewriting the history.
 *
 * The same product cannot appear twice with the same form on one document:
 * `sale_items_sale_product_form_unique` enforces it and the service refuses a
 * duplicate line before the write.
 */
export const saleItems = sqliteTable(
  'sale_items',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    saleId: integer('sale_id')
      .notNull()
      .references(() => sales.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    form: text('form').notNull(),
    quantity: integer('quantity').notNull(),
    unitPrice: integer('unit_price').notNull(),
    /** Always quantity * unit_price, recomputed by the service. */
    lineTotal: integer('line_total').notNull(),
  },
  (table) => [
    index('sale_items_sale_id_idx').on(table.saleId),
    index('sale_items_product_id_idx').on(table.productId),
    uniqueIndex('sale_items_sale_product_form_unique').on(
      table.saleId,
      table.productId,
      table.form,
    ),
    check('sale_items_quantity_check', sql`${table.quantity} > 0`),
    check('sale_items_unit_price_check', sql`${table.unitPrice} >= 0`),
    check('sale_items_line_total_check', sql`${table.lineTotal} >= 0`),
  ],
)

/**
 * A payment of a sale. There is no payment method in this version: only the
 * amount and the date are recorded. The payment status is always recomputed
 * from the sum of the payments against the total of the sale, never stored.
 */
export const payments = sqliteTable(
  'payments',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    saleId: integer('sale_id')
      .notNull()
      .references(() => sales.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    amount: integer('amount').notNull(),
    paymentDate: integer('payment_date', { mode: 'timestamp' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().defaultNow(),
  },
  (table) => [
    index('payments_sale_id_idx').on(table.saleId),
    index('payments_payment_date_idx').on(table.paymentDate),
    check('payments_amount_check', sql`${table.amount} > 0`),
  ],
)

export const schema = {
  users,
  settings,
  categories,
  products,
  stockMovements,
  suppliers,
  supplies,
  supplyItems,
  transformations,
  clients,
  sales,
  saleItems,
  payments,
}
