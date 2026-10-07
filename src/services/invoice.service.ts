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

function unwrap<T>(result: SaleResult<T>): T {
  if (result.success) {
    return result.data
  }

  throw new Error(result.error)
}

/**
 * Renderer access layer of the facturation module. It only forwards the call to
 * the preload bridge and unwraps the `{ success, data | error }` envelope: no
 * business rule (stock, total, payment status, reference) is computed here.
 */
export const invoiceService = {
  list: async (filters?: SaleFilters): Promise<Sale[]> => {
    return unwrap(await window.api.invoices.list(filters))
  },
  getById: async (id: number): Promise<SaleDetail> => {
    return unwrap(await window.api.invoices.getById(id))
  },
  getByReference: async (reference: string): Promise<SaleDetail> => {
    return unwrap(await window.api.invoices.getByReference(reference))
  },
  create: async (input: SaleCreateInput): Promise<SaleDetail> => {
    return unwrap(await window.api.invoices.create(input))
  },
  update: async (id: number, input: SaleUpdateInput): Promise<SaleDetail> => {
    return unwrap(await window.api.invoices.update(id, input))
  },
  cancel: async (id: number): Promise<Sale> => {
    return unwrap(await window.api.invoices.cancel(id))
  },
  delete: async (id: number): Promise<void> => {
    unwrap(await window.api.invoices.delete(id))
  },
  addPayment: async (saleId: number, input: SalePaymentInput): Promise<Payment> => {
    return unwrap(await window.api.invoices.addPayment(saleId, input))
  },
  updatePayment: async (paymentId: number, input: SalePaymentInput): Promise<Payment> => {
    return unwrap(await window.api.invoices.updatePayment(paymentId, input))
  },
  deletePayment: async (paymentId: number): Promise<void> => {
    unwrap(await window.api.invoices.deletePayment(paymentId))
  },
  getPaymentSummary: async (saleId: number): Promise<SalePaymentSummary> => {
    return unwrap(await window.api.invoices.getPaymentSummary(saleId))
  },
  listPayments: async (saleId: number): Promise<Payment[]> => {
    return unwrap(await window.api.invoices.listPayments(saleId))
  },
}