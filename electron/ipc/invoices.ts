import { ipcMain } from 'electron'
import {
  addPayment,
  cancelInvoice,
  createInvoice,
  deleteInvoice,
  deletePayment,
  getInvoiceById,
  getInvoiceByReference,
  getInvoicePaymentSummary,
  INVOICE_ERRORS,
  InvoiceError,
  listInvoicePayments,
  listInvoices,
  updateInvoice,
  updatePayment,
} from '../services/invoiceService'
import type {
  Payment,
  Sale,
  SaleCreateInput,
  SaleDetail,
  SaleFilters,
  SalePaymentInput,
  SalePaymentSummary,
  SaleResult,
  SaleUpdateInput,
} from '../types'

function toSuccess<T>(data: T): SaleResult<T> {
  return { success: true, data }
}

function toFailure<T>(error: unknown, fallback: string): SaleResult<T> {
  if (error instanceof InvoiceError) {
    return { success: false, error: error.message }
  }

  console.error('[invoices] Unexpected error:', error)
  return { success: false, error: fallback }
}

/**
 * Facturation channels. Every handler is a thin pass-through: it extracts the
 * arguments, calls `invoiceService` and wraps the result in the
 * `{ success, data | error }` envelope used by every other module, so the
 * renderer never receives a SQLite or Node error.
 */
export function registerInvoiceIpcHandlers(): void {
  ipcMain.handle('invoices:create', (_event, input: SaleCreateInput): SaleResult<SaleDetail> => {
    try {
      return toSuccess(createInvoice(input))
    } catch (error) {
      return toFailure(error, INVOICE_ERRORS.unexpected)
    }
  })

  ipcMain.handle(
    'invoices:get-by-id',
    (_event, id: number): SaleResult<SaleDetail> => {
      try {
        return toSuccess(getInvoiceById(id))
      } catch (error) {
        return toFailure(error, INVOICE_ERRORS.unexpected)
      }
    },
  )

  ipcMain.handle(
    'invoices:get-by-reference',
    (_event, reference: string): SaleResult<SaleDetail> => {
      try {
        return toSuccess(getInvoiceByReference(reference))
      } catch (error) {
        return toFailure(error, INVOICE_ERRORS.unexpected)
      }
    },
  )

  ipcMain.handle(
    'invoices:list',
    (_event, filters?: SaleFilters): SaleResult<Sale[]> => {
      try {
        return toSuccess(listInvoices(filters ?? {}))
      } catch (error) {
        return toFailure(error, INVOICE_ERRORS.unexpected)
      }
    },
  )

  ipcMain.handle(
    'invoices:update',
    (_event, id: number, input: SaleUpdateInput): SaleResult<SaleDetail> => {
      try {
        return toSuccess(updateInvoice(id, input))
      } catch (error) {
        return toFailure(error, INVOICE_ERRORS.unexpected)
      }
    },
  )

  ipcMain.handle('invoices:cancel', (_event, id: number): SaleResult<Sale> => {
    try {
      return toSuccess(cancelInvoice(id))
    } catch (error) {
      return toFailure(error, INVOICE_ERRORS.unexpected)
    }
  })

  ipcMain.handle('invoices:delete', (_event, id: number): SaleResult<null> => {
    try {
      return toSuccess(deleteInvoice(id))
    } catch (error) {
      return toFailure(error, INVOICE_ERRORS.unexpected)
    }
  })

  ipcMain.handle(
    'invoices:add-payment',
    (_event, saleId: number, input: SalePaymentInput): SaleResult<Payment> => {
      try {
        return toSuccess(addPayment(saleId, input.amount, input.date))
      } catch (error) {
        return toFailure(error, INVOICE_ERRORS.unexpected)
      }
    },
  )

  ipcMain.handle(
    'invoices:update-payment',
    (_event, paymentId: number, input: SalePaymentInput): SaleResult<Payment> => {
      try {
        return toSuccess(updatePayment(paymentId, input.amount, input.date))
      } catch (error) {
        return toFailure(error, INVOICE_ERRORS.unexpected)
      }
    },
  )

  ipcMain.handle(
    'invoices:delete-payment',
    (_event, paymentId: number): SaleResult<null> => {
      try {
        return toSuccess(deletePayment(paymentId))
      } catch (error) {
        return toFailure(error, INVOICE_ERRORS.unexpected)
      }
    },
  )

  ipcMain.handle(
    'invoices:get-payment-summary',
    (_event, saleId: number): SaleResult<SalePaymentSummary> => {
      try {
        return toSuccess(getInvoicePaymentSummary(saleId))
      } catch (error) {
        return toFailure(error, INVOICE_ERRORS.unexpected)
      }
    },
  )

  ipcMain.handle(
    'invoices:list-payments',
    (_event, saleId: number): SaleResult<Payment[]> => {
      try {
        return toSuccess(listInvoicePayments(saleId))
      } catch (error) {
        return toFailure(error, INVOICE_ERRORS.unexpected)
      }
    },
  )
}