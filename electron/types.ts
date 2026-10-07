export interface DatabaseStatus {
  connected: boolean
  initialized: boolean
  version: string
}

export interface Settings {
  id: number
  shopName: string
  address?: string | null
  phone: string | null
  phone2?: string | null
  ninea?: string | null
  ownerName: string | null
  createdAt: Date
  updatedAt: Date
}

export type SettingsInput = Omit<Settings, 'id' | 'createdAt' | 'updatedAt'>

export interface Category {
  id: number
  name: string
  createdAt: Date
  updatedAt: Date
}

export interface CategoryInput {
  name: string
}

export type CategoryUpdateInput = CategoryInput

export type CategoryResult<T> =
  | { success: true; data: T }
  | { success: false; error: string }

export interface DatabaseAPI {
  getStatus: () => Promise<DatabaseStatus>
}

export interface SettingsAPI {
  get: () => Promise<Settings | null>
  save: (settings: SettingsInput) => Promise<Settings>
}

export interface PublicUser {
  id: number
  username: string
  createdAt: Date
}

export interface AuthStatus {
  isConfigured: boolean
  isAuthenticated: boolean
  user: PublicUser | null
}

export interface AuthSetupInput {
  shopName: string
  address?: string | null
  phone?: string | null
  phone2?: string | null
  ninea?: string | null
  ownerName?: string | null
  username: string
  password: string
}

export interface AuthCredentials {
  username: string
  password: string
}

export type AuthResult =
  | { success: true; user: PublicUser }
  | { success: false; error: string }

export interface AuthAPI {
  status: () => Promise<AuthStatus>
  setup: (input: AuthSetupInput) => Promise<AuthResult>
  login: (credentials: AuthCredentials) => Promise<AuthResult>
  logout: () => Promise<boolean>
}

export interface CategoryAPI {
  list: () => Promise<CategoryResult<Category[]>>
  get: (id: number) => Promise<CategoryResult<Category | null>>
  create: (input: CategoryInput) => Promise<CategoryResult<Category>>
  update: (id: number, input: CategoryUpdateInput) => Promise<CategoryResult<Category>>
  delete: (id: number) => Promise<CategoryResult<null>>
  /** excludeId ignores the category being edited: its own name stays available. */
  isNameAvailable: (name: string, excludeId?: number) => Promise<CategoryResult<boolean>>
}

export interface Product {
  id: number
  name: string
  categoryId: number
  categoryName: string
  /** Purchase price of the primary form, in whole FCFA. */
  purchasePrice: number
  /** Sale price of the primary form, in whole FCFA. */
  salePrice: number
  isTransformable: boolean
  /** Primary form label (e.g. CARTON), NULL when the product is simple. */
  primaryForm: string | null
  /** Secondary form label (e.g. SEAU), NULL when the product is simple. */
  secondaryForm: string | null
  /** 1 primary form = conversionQuantity secondary forms, NULL when simple. */
  conversionQuantity: number | null
  /** Sale price of one secondary form, in whole FCFA, NULL when simple. */
  secondarySalePrice: number | null
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

/**
 * Stock is never stored on `products`: it is always the sum of the movements of
 * `stock_movements`. TRANSFORMATION is the transfer between the two forms of a
 * transformable product (OUT on the source form, IN on the destination form);
 * SALE is the OUT movement created by a facture (VTE-000001) when it takes stock
 * out, and its reason always names that facture.
 */
export type StockMovementType =
  | 'STOCK_INITIAL'
  | 'AJUSTEMENT'
  | 'APPROVISIONNEMENT'
  | 'TRANSFORMATION'
  | 'SALE'

/**
 * Sense of a movement. `quantity` is always a positive integer: the direction
 * carries the sign, so a STOCK_INITIAL is always IN, an APPROVISIONNEMENT is
 * always IN, a SALE is always OUT and an AJUSTEMENT is explicitly IN (entrée) or
 * OUT (sortie). TRANSFORMATION is the only type that exists in both directions on
 * the same product: it is OUT on the source form and IN on the destination form.
 */
export type StockDirection = 'IN' | 'OUT'

export interface StockMovement {
  id: number
  productId: number
  form: string
  movementType: StockMovementType
  direction: StockDirection
  /** Always strictly positive, as stored. */
  quantity: number
  /** Signed quantity derived from `direction`, for display only. */
  signedQuantity: number
  /**
   * NULL for STOCK_INITIAL, APPROVISIONNEMENT and TRANSFORMATION, mandatory for
   * AJUSTEMENT and for SALE (the reference of the facture, "Facture VTE-000001").
   */
  reason: string | null
  createdAt: Date
}

export interface StockFormInput {
  form: string
  /** 0 is allowed during an initialization, as long as one form is positive. */
  quantity: number
}

export interface StockInitializeInput {
  productId: number
  quantities: StockFormInput[]
}

export interface StockAdjustInput {
  productId: number
  form: string
  direction: StockDirection
  quantity: number
  reason: string
}

export interface StockFilters {
  /** Case-insensitive partial match on the product name. */
  search?: string
  /** Case-insensitive partial match on the category name. */
  categorySearch?: string
  categoryId?: number | null
  isActive?: boolean | null
}

/** One row of the stock list: the quantity of one form of one product. */
export interface StockFormLevel {
  productId: number
  productName: string
  categoryId: number
  categoryName: string
  form: string
  quantity: number
  /**
   * True once the product has at least one movement in its history. A product
   * without any movement has a logical stock of 0, it is never "uninitialized":
   * this flag only says whether an initial stock can still be declared.
   */
  hasMovements: boolean
  isProductActive: boolean
  /**
   * True when the form only exists in the movement history (the product forms
   * were renamed after the initialization): the stock is still shown, never
   * silently dropped.
   */
  isLegacyForm: boolean
}

export interface StockAdjustResult {
  movement: StockMovement
  stock: StockFormLevel
}

export type StockResult<T> =
  | { success: true; data: T }
  | { success: false; error: string }

export interface StockAPI {
  list: (filters?: StockFilters) => Promise<StockResult<StockFormLevel[]>>
  get: (productId: number) => Promise<StockResult<StockFormLevel[]>>
  getForm: (productId: number, form: string) => Promise<StockResult<StockFormLevel>>
  initialize: (
    productId: number,
    input: StockInitializeInput,
  ) => Promise<StockResult<StockFormLevel[]>>
  adjust: (
    productId: number,
    input: StockAdjustInput,
  ) => Promise<StockResult<StockAdjustResult>>
  movements: (productId: number) => Promise<StockResult<StockMovement[]>>
}

export interface ProductInput {
  name: string
  categoryId: number
  purchasePrice: number
  salePrice: number
  isTransformable: boolean
  primaryForm?: string | null
  secondaryForm?: string | null
  conversionQuantity?: number | null
  secondarySalePrice?: number | null
}

export type ProductUpdateInput = ProductInput

export interface ProductFilters {
  /** Case-insensitive partial match on the product name. */
  search?: string
  /** Case-insensitive partial match on the category name. */
  categorySearch?: string
  categoryId?: number | null
  isActive?: boolean | null
}

export type ProductResult<T> =
  | { success: true; data: T }
  | { success: false; error: string }

export interface ProductAPI {
  list: (filters?: ProductFilters) => Promise<ProductResult<Product[]>>
  get: (id: number) => Promise<ProductResult<Product>>
  create: (input: ProductInput) => Promise<ProductResult<Product>>
  update: (id: number, input: ProductUpdateInput) => Promise<ProductResult<Product>>
  setActive: (id: number, isActive: boolean) => Promise<ProductResult<Product>>
  /** excludeId ignores the product being edited: its own name stays available. */
  isNameAvailable: (name: string, excludeId?: number) => Promise<ProductResult<boolean>>
}

/** One line typed by the shopkeeper: the amounts are recomputed by the service. */
export interface SupplyItemInput {
  productId: number
  /** Must be one of the forms of the product (SAC, CARTON, SEAU…). */
  form: string
  /** Strictly positive whole number of received units of that form. */
  quantity: number
  /** Real purchase price of one unit on this document, in whole FCFA. */
  purchaseUnitPrice: number
}

export interface SupplyCreateInput {
  /** Reception date as `YYYY-MM-DD`, defaults to today. */
  date?: string | null
  /** Optional free text: there is no supplier table in this version. */
  supplierName?: string | null
  items: SupplyItemInput[]
}

/** One row of the supply list: the header only, with its number of lines. */
export interface Supply {
  id: number
  reference: string
  supplierName: string | null
  date: Date
  /** Sum of the line totals, never typed by the shopkeeper. */
  totalAmount: number
  itemCount: number
  createdAt: Date
}

/** One received line, joined with the product name for display. */
export interface SupplyItem {
  id: number
  supplyId: number
  productId: number
  productName: string
  form: string
  quantity: number
  purchaseUnitPrice: number
  /** quantity * purchaseUnitPrice, recomputed by the service. */
  lineTotal: number
}

/** A validated supply and its lines: a supply is always validated and immutable. */
export interface SupplyDetail extends Supply {
  items: SupplyItem[]
}

export interface SupplyFilters {
  /** Case-insensitive partial match on the reference (APP-000001…). */
  search?: string
  /** Case-insensitive partial match on the free text supplier. */
  supplierSearch?: string
}

export type SupplyResult<T> =
  | { success: true; data: T }
  | { success: false; error: string }

export interface SupplyAPI {
  list: (filters?: SupplyFilters) => Promise<SupplyResult<Supply[]>>
  get: (id: number) => Promise<SupplyResult<SupplyDetail>>
  getByReference: (reference: string) => Promise<SupplyResult<SupplyDetail>>
  create: (input: SupplyCreateInput) => Promise<SupplyResult<SupplyDetail>>
}

/** Payload of a transformation, as built by the renderer form. */
export interface TransformationCreateInput {
  productId: number
  /** Must be one of the two forms of the transformable product. */
  sourceForm: string
  /** Strictly positive whole number of source units, never fractional. */
  sourceQuantity: number
  /** Transformation date as `YYYY-MM-DD`, defaults to today. */
  date?: string | null
}

/**
 * A validated transformation document: the two forms and the two exact
 * quantities, both recomputed by the service from the conversion of the product.
 */
export interface Transformation {
  id: number
  reference: string
  productId: number
  productName: string
  sourceForm: string
  sourceQuantity: number
  destinationForm: string
  destinationQuantity: number
  date: Date
  createdAt: Date
}

/** A validated transformation and the stock it produced, for the detail view. */
export interface TransformationDetail extends Transformation {
  /** Balance of each form, read back from `stock_movements` after the write. */
  stockAfter: StockFormLevel[]
}

export interface TransformationFilters {
  /** Case-insensitive partial match on the reference (TRF-000001…). */
  search?: string
  /** Case-insensitive partial match on the product name. */
  productSearch?: string
}

export type TransformationResult<T> =
  | { success: true; data: T }
  | { success: false; error: string }

export interface TransformationAPI {
  listProducts: () => Promise<TransformationResult<Product[]>>
  list: (filters?: TransformationFilters) => Promise<TransformationResult<Transformation[]>>
  get: (id: number) => Promise<TransformationResult<TransformationDetail>>
  getByReference: (reference: string) => Promise<TransformationResult<TransformationDetail>>
  create: (
    input: TransformationCreateInput,
  ) => Promise<TransformationResult<TransformationDetail>>
}

export interface Client {
  id: number
  name: string
  phone: string
  address: string | null
  isActive: boolean
  isSystem: boolean
  createdAt: Date
  updatedAt: Date
}

export interface ClientInput {
  name: string
  phone: string
  address?: string | null
}

export type ClientUpdateInput = ClientInput

export interface ClientFilters {
  /** Case-insensitive partial match on the client name. */
  search?: string
  /** Case-insensitive partial match on the phone number. */
  phoneSearch?: string
  isActive?: boolean | null
}

export type ClientResult<T> =
  | { success: true; data: T }
  | { success: false; error: string }

export interface ClientAPI {
  list: (filters?: ClientFilters) => Promise<ClientResult<Client[]>>
  get: (id: number) => Promise<ClientResult<Client | null>>
  create: (input: ClientInput) => Promise<ClientResult<Client>>
  update: (id: number, input: ClientUpdateInput) => Promise<ClientResult<Client>>
  setActive: (id: number, isActive: boolean) => Promise<ClientResult<Client>>
  isNameAvailable: (name: string, excludeClientId?: number) => Promise<ClientResult<boolean>>
  isPhoneAvailable: (phone: string, excludeClientId?: number) => Promise<ClientResult<boolean>>
  ensureSystem: () => Promise<ClientResult<Client>>
}

/**
 * A sale (a facture) is the commercial document of a sale. Its header carries
 * the automatic reference (VTE-000001), the sale date, the client (always
 * present: the system client "CLIENT COMPTANT" is used when none is selected),
 * the status (VALIDEE at creation, ANNULEE after a cancellation) and the total
 * recomputed from its lines. A sale is never physically deleted: it is cancelled
 * (ANNULEE) and then optionally physically removed, and only when it carries no
 * payment at all.
 */
export interface Sale {
  id: number
  reference: string
  clientId: number
  clientName: string
  saleDate: Date
  status: SaleStatus
  totalAmount: number
  /** Sum of the payments, recomputed on every read, never stored. */
  paidAmount: number
  /** totalAmount - paidAmount, never negative. */
  remainingAmount: number
  /** Derived from totalAmount and paidAmount, never stored. */
  paymentStatus: PaymentStatus
  createdAt: Date
  updatedAt: Date
}

/** VALIDEE at creation, ANNULEE after a cancellation. */
export type SaleStatus = 'VALIDEE' | 'ANNULEE'

/**
 * The payment status is always recomputed from the sum of the payments against
 * the total of the sale, never stored: it is a derived value, not a column.
 */
export type PaymentStatus = 'NON_PAYEE' | 'PARTIELLEMENT_PAYEE' | 'PAYEE'

/** One line typed by the shopkeeper: the amounts are recomputed by the service. */
export interface SaleItemInput {
  productId: number
  /** Must be one of the forms of the product (SAC, CARTON, SEAU…). */
  form: string
  /** Strictly positive whole number of sold units of that form. */
  quantity: number
  /**
   * Real sale price of one unit on this document, in whole FCFA. Omitted: the
   * price configured on the product for that form is copied into the line.
   */
  unitPrice?: number | null
}

export interface SaleCreateInput {
  /** Sale date as `YYYY-MM-DD`, defaults to today. */
  date?: string | null
  /** Optional client id. When omitted, the system client is used. */
  clientId?: number | null
  /** The lines of the sale. */
  items: SaleItemInput[]
}

export interface SaleUpdateInput {
  /** Optional new client id. */
  clientId?: number | null
  /** Optional new sale date as `YYYY-MM-DD`. */
  date?: string | null
  /** The new lines of the sale (replace the previous ones). */
  items: SaleItemInput[]
}

/** One line of a sale, joined with the product name for display. */
export interface SaleItem {
  id: number
  saleId: number
  productId: number
  productName: string
  form: string
  quantity: number
  unitPrice: number
  /** quantity * unitPrice, recomputed by the service. */
  lineTotal: number
}

/** A facture and its lines, with its payments always recomputed. */
export interface SaleDetail extends Sale {
  items: SaleItem[]
  paymentSummary: SalePaymentSummary
}

/** One payment of a sale. */
export interface Payment {
  id: number
  saleId: number
  amount: number
  paymentDate: Date
  createdAt: Date
  updatedAt: Date
}

/** Recomputed payment summary of a sale, always derived from the payments. */
export interface SalePaymentSummary {
  paidAmount: number
  remainingAmount: number
  status: PaymentStatus
}

export interface SaleFilters {
  /** Case-insensitive partial match on the reference (VTE-000001…). */
  search?: string
  /** Case-insensitive partial match on the client name. */
  clientSearch?: string
  /** Filter on the client id. */
  clientId?: number | null
  /** Filter on the status. */
  status?: SaleStatus | null
}

/**
 * One payment typed by the shopkeeper, sent to the IPC layer. There is no payment
 * method in this version: only the amount and the date.
 */
export interface SalePaymentInput {
  /** Strictly positive whole number of FCFA received. */
  amount: number
  /** Payment date as `YYYY-MM-DD`, defaults to today. */
  date?: string | null
}

export type SaleResult<T> =
  | { success: true; data: T }
  | { success: false; error: string }

/**
 * Facturation API exposed to the renderer by the preload bridge. Every method is
 * a thin pass-through to `electron/services/invoiceService`: the business rules
 * (stock, totals, payment status, cancellation, deletion) never live here.
 */
export interface SaleAPI {
  list: (filters?: SaleFilters) => Promise<SaleResult<Sale[]>>
  getById: (id: number) => Promise<SaleResult<SaleDetail>>
  getByReference: (reference: string) => Promise<SaleResult<SaleDetail>>
  create: (input: SaleCreateInput) => Promise<SaleResult<SaleDetail>>
  update: (id: number, input: SaleUpdateInput) => Promise<SaleResult<SaleDetail>>
  cancel: (id: number) => Promise<SaleResult<Sale>>
  delete: (id: number) => Promise<SaleResult<null>>
  addPayment: (saleId: number, input: SalePaymentInput) => Promise<SaleResult<Payment>>
  updatePayment: (
    paymentId: number,
    input: SalePaymentInput,
  ) => Promise<SaleResult<Payment>>
  deletePayment: (paymentId: number) => Promise<SaleResult<null>>
  getPaymentSummary: (saleId: number) => Promise<SaleResult<SalePaymentSummary>>
  listPayments: (saleId: number) => Promise<SaleResult<Payment[]>>
}

/**
 * A printable document: a self contained HTML page, produced by the renderer and
 * printed by the main process in an offline hidden window. Only the shopkeeper
 * actions (imprimer, télécharger PDF) ever need it, no business rule lives here.
 */
export interface PrintRequest {
  /** Complete HTML page: `<head>` with its styles, `<body>` and its content. */
  html: string
  /** Window title, and default file name for the PDF. */
  title?: string
}

export type PrintResult<T> =
  | { success: true; data: T }
  | { success: false; error: string }

/** `path` is null when the shopkeeper cancelled the save dialog. */
export type PrintPdfResult = PrintResult<{ path: string | null }>

/**
 * Native printing bridge. `print` opens the system print dialog on the HTML
 * document, `savePdf` generates the PDF offline and asks where to store it,
 * `preview` opens a visible window so the document can be inspected first.
 */
export interface PrintAPI {
  print: (request: PrintRequest) => Promise<PrintResult<null>>
  savePdf: (request: PrintRequest) => Promise<PrintPdfResult>
  preview: (request: PrintRequest) => Promise<PrintResult<null>>
}

export interface ElectronAPI {
  database: DatabaseAPI
  settings: SettingsAPI
  auth: AuthAPI
  categories: CategoryAPI
  products: ProductAPI
  stock: StockAPI
  supplies: SupplyAPI
  transformations: TransformationAPI
  clients: ClientAPI
  invoices: SaleAPI
  print: PrintAPI
}