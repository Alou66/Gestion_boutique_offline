import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Sale } from '@/types'
import { invoiceService } from '@/services'
import { Pagination } from '@/components'
import { paginate, type Page } from '@/lib/pagination'
import {
  buildInvoiceFilters,
  formatAmount,
  formatInvoiceDate,
  formatStatusLabel,
  INVOICE_MESSAGES,
  paymentStatusTone,
  saleStatusTone,
} from './schemas/invoice.schema'
import type { PaymentStatusFilter } from './schemas/invoice.schema'

/**
 * Page « Liste des factures ».
 *
 * La recherche et les filtres sont transmis à `listInvoices()` : le tri et le
 * filtrage restent dans le service, React ne fait qu'afficher ce qu'il reçoit.
 * Le montant payé, le reste à payer et les statuts sont ceux renvoyés par le
 * service, jamais recalculés ici.
 */
function Invoices() {
  const [invoices, setInvoices] = useState<Sale[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [clientSearch, setClientSearch] = useState('')
  // const [statusFilter, setStatusFilter] = useState<InvoiceStatusFilter>('all')
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<PaymentStatusFilter>('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [currentPage, setCurrentPage] = useState(1)

  const loadInvoices = useCallback(async () => {
    setIsLoading(true)
    setLoadError(null)

    try {
      const allInvoices = await invoiceService.list(
        buildInvoiceFilters(search, clientSearch, dateFrom, dateTo, paymentStatusFilter),
      )
      setInvoices(allInvoices)
    } catch {
      setLoadError(INVOICE_MESSAGES.unexpected)
    } finally {
      setIsLoading(false)
    }
  }, [search, clientSearch, dateFrom, dateTo, paymentStatusFilter])

  useEffect(() => {
    const timer = setTimeout(loadInvoices, 200)

    return () => clearTimeout(timer)
  }, [loadInvoices])

  // Reset to page 1 when search or filter changes
  useEffect(() => {
    setCurrentPage(1)
  }, [search, clientSearch, paymentStatusFilter, dateFrom, dateTo])

  const page = useMemo<Page<Sale>>(() => paginate(invoices, currentPage), [invoices, currentPage])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Liste des factures</h1>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div>
          <label htmlFor="invoice-search" className="block text-sm font-medium text-gray-700">
            Référence
          </label>
          <input
            id="invoice-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="VTE-000001"
            className="mt-1 block w-full rounded-md border border-gray-500 shadow-sm focus:border-blue-500 focus:ring-blue-500"
          />
        </div>

        <div>
          <label
            htmlFor="invoice-client-search"
            className="block text-sm font-medium text-gray-700"
          >
            Nom du client
          </label>
          <input
            id="invoice-client-search"
            type="search"
            value={clientSearch}
            onChange={(event) => setClientSearch(event.target.value)}
            placeholder="Nom du client"
            className="mt-1 block w-full rounded-md border border-gray-500 shadow-sm focus:border-blue-500 focus:ring-blue-500"
          />
        </div>
        <div>
          <label
            htmlFor="invoice-payment-status-filter"
            className="block text-sm font-medium text-gray-700"
          >
            Statut de paiement
          </label>
          <select
            id="invoice-payment-status-filter"
            value={paymentStatusFilter}
            onChange={(event) => setPaymentStatusFilter(event.target.value as PaymentStatusFilter)}
            className="mt-1 block w-full rounded-md border border-gray-500 shadow-sm focus:border-blue-500 focus:ring-blue-500"
          >
            <option value="all">Toutes</option>
            <option value="PAYEE">Payées</option>
            <option value="PARTIELLEMENT_PAYEE">Partiellement payées</option>
            <option value="NON_PAYEE">Non payées</option>
          </select>
        </div>

        <div>
          <label htmlFor="invoice-date-from" className="block text-sm font-medium text-gray-700">
            Date début
          </label>
          <input
            id="invoice-date-from"
            type="date"
            value={dateFrom}
            onChange={(event) => setDateFrom(event.target.value)}
            className="mt-1 block w-full rounded-md border border-gray-500 shadow-sm focus:border-blue-500 focus:ring-blue-500"
          />
        </div>

        <div>
          <label htmlFor="invoice-date-to" className="block text-sm font-medium text-gray-700">
            Date fin
          </label>
          <input
            id="invoice-date-to"
            type="date"
            value={dateTo}
            onChange={(event) => setDateTo(event.target.value)}
            className="mt-1 block w-full rounded-md border border-gray-500 shadow-sm focus:border-blue-500 focus:ring-blue-500"
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border bg-white shadow">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className="px-4 py-3 text-left text-sm font-semibold text-gray-700">
                Référence
              </th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-semibold text-gray-700">
                Date
              </th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-semibold text-gray-700">
                Client
              </th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-semibold text-gray-700">
                Total
              </th>
              {/* <th scope="col" className="px-4 py-3 text-right text-sm font-semibold text-gray-700">
                Payé
              </th> */}
              <th scope="col" className="px-4 py-3 text-right text-sm font-semibold text-gray-700">
                Restant
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-left text-sm font-semibold text-gray-700"
              >
                Statut paiement
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-left text-sm font-semibold text-gray-700"
              >
                Statut facture
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-right text-sm font-semibold text-gray-700"
              >
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading && (
              <tr>
                <td colSpan={9} className="px-6 py-6 text-center text-sm text-gray-500">
                  Chargement…
                </td>
              </tr>
            )}

            {!isLoading && loadError && (
              <tr>
                <td colSpan={9} className="px-6 py-6 text-center text-sm text-red-600">
                  {loadError}
                </td>
              </tr>
            )}

            {!isLoading && !loadError && page.rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-6 py-6 text-center text-sm text-gray-500">
                  Aucune facture pour le moment.
                </td>
              </tr>
            )}

            {!isLoading &&
              !loadError &&
              page.rows.map((invoice) => (
                <tr key={invoice.id} className="hover:bg-gray-50">
                  <td className="px-4 py-4 text-sm font-medium text-gray-900">
                    {invoice.reference}
                  </td>
                  <td className="px-4 py-4 text-sm text-gray-600">
                    {formatInvoiceDate(invoice.saleDate)}
                  </td>
                  <td className="px-4 py-4 text-sm text-gray-600">{invoice.clientName}</td>
                  <td className="px-4 py-4 text-right text-sm font-medium text-gray-900">
                    {formatAmount(invoice.totalAmount)}
                  </td>
                  {/* <td className="px-4 py-4 text-right text-sm text-gray-600">
                    {formatAmount(invoice.paidAmount)}
                  </td> */}
                  <td className="px-4 py-4 text-right text-sm text-gray-600">
                    {formatAmount(invoice.remainingAmount)}
                  </td>
                  <td className="px-4 py-4 text-sm">
                    <span
                      className={`inline-block rounded-full px-2 py-1 text-xs font-medium ${paymentStatusTone(invoice.paymentStatus)}`}
                    >
                      {formatStatusLabel(invoice.paymentStatus)}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-sm">
                    <span
                      className={`inline-block rounded-full px-2 py-1 text-xs font-medium ${saleStatusTone(invoice.status)}`}
                    >
                      {formatStatusLabel(invoice.status)}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-right text-sm">
                    <Link
                      to={`/factures/${invoice.id}`}
                      className="font-medium text-blue-600 hover:text-blue-800"
                    >
                      Voir
                    </Link>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <Pagination
        page={page.page}
        totalPages={page.totalPages}
        total={page.total}
        itemLabel="facture"
        onPageChange={setCurrentPage}
      />
    </div>
  )
}

export default Invoices