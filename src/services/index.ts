// Services for Electron IPC communication
// The React renderer will never access the filesystem or SQLite directly.
// All data access goes through secure IPC channels to Electron services.
export { authService } from './auth.service'
export { categoryService } from './category.service'
export { productService } from './product.service'
export { stockService } from './stock.service'