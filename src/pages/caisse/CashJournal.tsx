import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Payment, Sale, SaleFilters } from '@/types'
import { invoiceService } from '@/services'
import {
  formatAmount,
  formatInvoiceDate,
  todayInputValue,
} from '@/pages/invoices/schemas/invoice.schema'

interface CashJournalFilters {
  dateFrom: string
  dateTo: string
}

interface CashJournalSummary {
  validInvoiceCount: number
  totalInvoiced: number
  totalCollected: number
  totalRemaining: number
}

interface PaymentRow {
  date: string
  invoiceRef: string
  clientName: string
  amount: number
}

/** Default period of the journal: the current day. */
function defaultFilters(): CashJournalFilters {
  const today = todayInputValue()
  return { dateFrom: today, dateTo: today }
}

function CashJournal() {
  const [invoices, setInvoices] = useState<Sale[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [filters, setFilters] = useState<CashJournalFilters>(() => defaultFilters())

  const loadData = useCallback(async () => {
    setIsLoading(true)
    setLoadError(null)

    try {
      const saleFilters: SaleFilters = {
        status: 'VALIDEE',
        dateFrom: filters.dateFrom || undefined,
        dateTo: filters.dateTo || undefined,
      }

      const loadedInvoices = await invoiceService.list(saleFilters)
      setInvoices(loadedInvoices)

      const paidInvoices = loadedInvoices.filter((inv) => inv.paidAmount > 0)
      const allPayments: Payment[] = []

      for (const invoice of paidInvoices) {
        const invoicePayments = await invoiceService.listPayments(invoice.id)
        allPayments.push(...invoicePayments)
      }

      setPayments(allPayments)
    } catch {
      setLoadError('Une erreur est survenue lors du chargement du journal de caisse.')
    } finally {
      setIsLoading(false)
    }
  }, [filters.dateFrom, filters.dateTo])

  useEffect(() => {
    const timer = setTimeout(loadData, 200)
    return () => clearTimeout(timer)
  }, [loadData])

  const summary = useMemo((): CashJournalSummary => {
    const totalInvoiced = invoices.reduce((sum, inv) => sum + inv.totalAmount, 0)
    const totalCollected = invoices.reduce((sum, inv) => sum + inv.paidAmount, 0)
    const totalRemaining = invoices.reduce((sum, inv) => sum + inv.remainingAmount, 0)

    return {
      validInvoiceCount: invoices.length,
      totalInvoiced,
      totalCollected,
      totalRemaining,
    }
  }, [invoices])

  const allPayments = useMemo((): PaymentRow[] => {
    return payments
      .sort((a, b) => new Date(b.paymentDate).getTime() - new Date(a.paymentDate).getTime())
      .map((payment) => {
        const invoice = invoices.find((inv) => inv.id === payment.saleId)
        return {
          date: formatInvoiceDate(payment.paymentDate),
          invoiceRef: invoice?.reference ?? '—',
          clientName: invoice?.clientName ?? '—',
          amount: payment.amount,
        }
      })
  }, [payments, invoices])

  const handleDateChange = (field: keyof CashJournalFilters, value: string) => {
    setFilters((prev) => ({ ...prev, [field]: value }))
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Journal de caisse</h1>
      </div>

      <div className="bg-white rounded-lg border shadow p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:max-w-xl">
          <div>
            <label htmlFor="date-from" className="block text-sm font-medium text-gray-700">
              Date de début
            </label>
            <input
              id="date-from"
              type="date"
              value={filters.dateFrom}
              onChange={(e) => handleDateChange('dateFrom', e.target.value)}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            />
          </div>
          <div>
            <label htmlFor="date-to" className="block text-sm font-medium text-gray-700">
              Date de fin
            </label>
            <input
              id="date-to"
              type="date"
              value={filters.dateTo}
              onChange={(e) => handleDateChange('dateTo', e.target.value)}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            />
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="bg-white rounded-lg border shadow p-6">
          <p className="text-sm font-medium text-gray-500">Factures validées</p>
          <p className="mt-2 text-3xl font-bold text-gray-900">{summary.validInvoiceCount}</p>
        </div>
        <div className="bg-white rounded-lg border shadow p-6">
          <p className="text-sm font-medium text-gray-500">Total facturé</p>
          <p className="mt-2 text-3xl font-bold text-gray-900">{formatAmount(summary.totalInvoiced)} FCFA</p>
        </div>
        <div className="bg-white rounded-lg border shadow p-6">
          <p className="text-sm font-medium text-gray-500">Total encaissé</p>
          <p className="mt-2 text-3xl font-bold text-green-600">{formatAmount(summary.totalCollected)} FCFA</p>
        </div>
        <div className="bg-white rounded-lg border shadow p-6">
          <p className="text-sm font-medium text-gray-500">Reste à encaisser</p>
          <p className="mt-2 text-3xl font-bold text-red-600">{formatAmount(summary.totalRemaining)} FCFA</p>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border bg-white shadow">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className="px-4 py-3 text-left text-sm font-semibold text-gray-700">
                Date
              </th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-semibold text-gray-700">
                Facture
              </th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-semibold text-gray-700">
                Client
              </th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-semibold text-gray-700">
                Montant encaissé
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading && (
              <tr>
                <td colSpan={4} className="px-6 py-6 text-center text-sm text-gray-500">
                  Chargement…
                </td>
              </tr>
            )}

            {!isLoading && loadError && (
              <tr>
                <td colSpan={4} className="px-6 py-6 text-center text-sm text-red-600">
                  {loadError}
                </td>
              </tr>
            )}

            {!isLoading && !loadError && allPayments.length === 0 && (
              <tr>
                <td colSpan={4} className="px-6 py-6 text-center text-sm text-gray-500">
                  Aucun encaissement pour cette période
                </td>
              </tr>
            )}

            {!isLoading &&
              !loadError &&
              allPayments.map((payment, index) => (
                <tr key={index} className="hover:bg-gray-50">
                  <td className="px-4 py-4 text-sm text-gray-600">{payment.date}</td>
                  <td className="px-4 py-4 text-sm font-medium text-gray-900">{payment.invoiceRef}</td>
                  <td className="px-4 py-4 text-sm text-gray-600">{payment.clientName}</td>
                  <td className="px-4 py-4 text-right text-sm font-medium text-green-600">
                    {formatAmount(payment.amount)} FCFA
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default CashJournal