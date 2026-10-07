import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Sale } from '@/types'
import { invoiceService } from '@/services'
import {
  buildInvoiceFilters,
  formatAmount,
  formatInvoiceDate,
  formatStatusLabel,
  INVOICE_MESSAGES,
  paginateInvoices,
  paymentStatusTone,
  saleStatusTone,
} from './schemas/invoice.schema'
import type { InvoiceStatusFilter } from './schemas/invoice.schema'

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
  const [statusFilter, setStatusFilter] = useState<InvoiceStatusFilter>('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [currentPage, setCurrentPage] = useState(1)

  const loadInvoices = useCallback(async () => {
    setIsLoading(true)
    setLoadError(null)

    try {
      setInvoices(await invoiceService.list(buildInvoiceFilters(search, clientSearch, statusFilter, dateFrom, dateTo)))
    } catch {
      setLoadError(INVOICE_MESSAGES.unexpected)
    } finally {
      setIsLoading(false)
    }
  }, [search, clientSearch, statusFilter, dateFrom, dateTo])

  useEffect(() => {
    const timer = setTimeout(loadInvoices, 200)

    return () => clearTimeout(timer)
  }, [loadInvoices])

  // Un changement de filtre ou de recherche ramène à la première page.
  useEffect(() => {
    setCurrentPage(1)
  }, [search, clientSearch, statusFilter, dateFrom, dateTo])

  const page = useMemo(() => paginateInvoices(invoices, currentPage), [invoices, currentPage])

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
            htmlFor="invoice-status-filter"
            className="block text-sm font-medium text-gray-700"
          >
            Statut de la facture
          </label>
          <select
            id="invoice-status-filter"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as InvoiceStatusFilter)}
            className="mt-1 block w-full rounded-md border border-gray-500 shadow-sm focus:border-blue-500 focus:ring-blue-500"
          >
            <option value="all">Toutes</option>
            <option value="VALIDEE">Validées</option>
            <option value="ANNULEE">Annulées</option>
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
              <th scope="col" className="px-4 py-3 text-right text-sm font-semibold text-gray-700">
                Payé
              </th>
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
                  <td className="px-4 py-4 text-right text-sm text-gray-600">
                    {formatAmount(invoice.paidAmount)}
                  </td>
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

      {page.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-600">
            Page {page.page} / {page.totalPages} — {page.total} facture
            {page.total > 1 ? 's' : ''}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setCurrentPage((value) => Math.max(1, value - 1))}
              disabled={page.page === 1}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Précédente
            </button>
            <button
              type="button"
              onClick={() => setCurrentPage((value) => Math.min(page.totalPages, value + 1))}
              disabled={page.page === page.totalPages}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Suivante
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default Invoices