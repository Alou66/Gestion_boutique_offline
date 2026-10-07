import { contextBridge, ipcRenderer } from 'electron'
import type { ElectronAPI } from './types'

const api: ElectronAPI = {
  database: {
    getStatus: () => ipcRenderer.invoke('database:status'),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (input) => ipcRenderer.invoke('settings:save', input),
  },
  auth: {
    status: () => ipcRenderer.invoke('auth:status'),
    setup: (input) => ipcRenderer.invoke('auth:setup', input),
    login: (credentials) => ipcRenderer.invoke('auth:login', credentials),
    logout: () => ipcRenderer.invoke('auth:logout'),
  },
  categories: {
    list: () => ipcRenderer.invoke('categories:list'),
    get: (id) => ipcRenderer.invoke('categories:get', id),
    create: (input) => ipcRenderer.invoke('categories:create', input),
    update: (id, input) => ipcRenderer.invoke('categories:update', id, input),
    delete: (id) => ipcRenderer.invoke('categories:delete', id),
    isNameAvailable: (name, excludeId) =>
      ipcRenderer.invoke('categories:is-name-available', name, excludeId),
  },
  products: {
    list: (filters) => ipcRenderer.invoke('products:list', filters),
    get: (id) => ipcRenderer.invoke('products:get', id),
    create: (input) => ipcRenderer.invoke('products:create', input),
    update: (id, input) => ipcRenderer.invoke('products:update', id, input),
    setActive: (id, isActive) => ipcRenderer.invoke('products:set-active', id, isActive),
    isNameAvailable: (name, excludeId) =>
      ipcRenderer.invoke('products:is-name-available', name, excludeId),
  },
  stock: {
    list: (filters) => ipcRenderer.invoke('stock:list', filters),
    get: (productId) => ipcRenderer.invoke('stock:get', productId),
    getForm: (productId, form) => ipcRenderer.invoke('stock:get-form', productId, form),
    initialize: (productId, input) => ipcRenderer.invoke('stock:initialize', productId, input),
    adjust: (productId, input) => ipcRenderer.invoke('stock:adjust', productId, input),
    movements: (productId) => ipcRenderer.invoke('stock:movements', productId),
  },
  supplies: {
    list: (filters) => ipcRenderer.invoke('supplies:list', filters),
    get: (id) => ipcRenderer.invoke('supplies:get', id),
    getByReference: (reference) =>
      ipcRenderer.invoke('supplies:get-by-reference', reference),
    create: (input) => ipcRenderer.invoke('supplies:create', input),
  },
  transformations: {
    listProducts: () => ipcRenderer.invoke('transformations:list-products'),
    list: (filters) => ipcRenderer.invoke('transformations:list', filters),
    get: (id) => ipcRenderer.invoke('transformations:get', id),
    getByReference: (reference) =>
      ipcRenderer.invoke('transformations:get-by-reference', reference),
    create: (input) => ipcRenderer.invoke('transformations:create', input),
  },
  clients: {
    list: (filters) => ipcRenderer.invoke('clients:list', filters),
    get: (id) => ipcRenderer.invoke('clients:get', id),
    create: (input) => ipcRenderer.invoke('clients:create', input),
    update: (id, input) => ipcRenderer.invoke('clients:update', id, input),
    setActive: (id, isActive) => ipcRenderer.invoke('clients:set-active', id, isActive),
    isNameAvailable: (name, excludeClientId) =>
      ipcRenderer.invoke('clients:is-name-available', name, excludeClientId),
    isPhoneAvailable: (phone, excludeClientId) =>
      ipcRenderer.invoke('clients:is-phone-available', phone, excludeClientId),
    ensureSystem: () => ipcRenderer.invoke('clients:ensure-system'),
  },
  suppliers: {
    list: (filters) => ipcRenderer.invoke('suppliers:list', filters),
    get: (id) => ipcRenderer.invoke('suppliers:get', id),
    create: (input) => ipcRenderer.invoke('suppliers:create', input),
    update: (id, input) => ipcRenderer.invoke('suppliers:update', id, input),
    setActive: (id, isActive) => ipcRenderer.invoke('suppliers:set-active', id, isActive),
    isNameAvailable: (name, excludeSupplierId) =>
      ipcRenderer.invoke('suppliers:is-name-available', name, excludeSupplierId),
    isPhoneAvailable: (phone, excludeSupplierId) =>
      ipcRenderer.invoke('suppliers:is-phone-available', phone, excludeSupplierId),
    ensureSystem: () => ipcRenderer.invoke('suppliers:ensure-system'),
  },
  invoices: {
    create: (input) => ipcRenderer.invoke('invoices:create', input),
    getById: (id) => ipcRenderer.invoke('invoices:get-by-id', id),
    getByReference: (reference) => ipcRenderer.invoke('invoices:get-by-reference', reference),
    list: (filters) => ipcRenderer.invoke('invoices:list', filters),
    update: (id, input) => ipcRenderer.invoke('invoices:update', id, input),
    cancel: (id) => ipcRenderer.invoke('invoices:cancel', id),
    delete: (id) => ipcRenderer.invoke('invoices:delete', id),
    addPayment: (saleId, input) => ipcRenderer.invoke('invoices:add-payment', saleId, input),
    updatePayment: (paymentId, input) =>
      ipcRenderer.invoke('invoices:update-payment', paymentId, input),
    deletePayment: (paymentId) => ipcRenderer.invoke('invoices:delete-payment', paymentId),
    getPaymentSummary: (saleId) => ipcRenderer.invoke('invoices:get-payment-summary', saleId),
    listPayments: (saleId) => ipcRenderer.invoke('invoices:list-payments', saleId),
  },
  print: {
    print: (request) => ipcRenderer.invoke('print:html', request),
    savePdf: (request) => ipcRenderer.invoke('print:pdf', request),
    preview: (request) => ipcRenderer.invoke('print:preview', request),
  },
}

contextBridge.exposeInMainWorld('api', api)