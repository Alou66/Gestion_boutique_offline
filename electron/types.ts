export interface DatabaseStatus {
  connected: boolean
  initialized: boolean
  version: string
}

export interface Settings {
  id: number
  shopName: string
  phone: string | null
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
  phone?: string | null
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
 * `stock_movements`. Only the movement types already implemented are declared
 * here (STOCK_INITIAL, AJUSTEMENT); APPROVISIONNEMENT, TRANSFORMATION and VENTE
 * will be added by their own modules.
 */
export type StockMovementType = 'STOCK_INITIAL' | 'AJUSTEMENT'

/**
 * Sense of a movement. `quantity` is always a positive integer: the direction
 * carries the sign, so a STOCK_INITIAL is always IN and an AJUSTEMENT is
 * explicitly IN (entrée) or OUT (sortie).
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
  /** NULL for STOCK_INITIAL, mandatory for AJUSTEMENT. */
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
  /** True once a STOCK_INITIAL exists for the product. */
  isInitialized: boolean
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
}

export interface ElectronAPI {
  database: DatabaseAPI
  settings: SettingsAPI
  auth: AuthAPI
  categories: CategoryAPI
  products: ProductAPI
  stock: StockAPI
}