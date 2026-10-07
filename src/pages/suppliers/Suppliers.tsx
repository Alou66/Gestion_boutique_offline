import { useCallback, useEffect, useState } from 'react'
import type { Supplier, SupplierInput, SupplierUpdateInput } from '@/types'
import { supplierService } from '@/services'
import ConfirmDialog from '../categories/ConfirmDialog'
import SupplierForm from './SupplierForm'
import { SUPPLIER_MESSAGES } from './schemas/supplier.schema'

const SUPPLIERS_PER_PAGE = 20

type StatusFilter = 'all' | 'active' | 'inactive'

function formatPhone(phone: string): string {
  if (phone.startsWith('+221')) {
    const num = phone.slice(4)
    return `${num.slice(0, 2)} ${num.slice(2, 5)} ${num.slice(5, 7)} ${num.slice(7, 9)}`
  }
  return phone
}

function Suppliers() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [phoneSearch, setPhoneSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalSuppliers, setTotalSuppliers] = useState(0)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editing, setEditing] = useState<Supplier | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [pendingStatusChange, setPendingStatusChange] = useState<{
    supplier: Supplier
    isActive: boolean
  } | null>(null)
  const [isChangingStatus, setIsChangingStatus] = useState(false)

  const loadSuppliers = useCallback(async () => {
    setIsLoading(true)
    setLoadError(null)

    try {
      const allSuppliers = await supplierService.list({
        search: search.trim() || undefined,
        phoneSearch: phoneSearch.trim() || undefined,
        isActive: statusFilter === 'all' ? undefined : statusFilter === 'active',
      })

      setTotalSuppliers(allSuppliers.length)
      setTotalPages(Math.ceil(allSuppliers.length / SUPPLIERS_PER_PAGE) || 1)

      // Simple client-side pagination
      const start = (currentPage - 1) * SUPPLIERS_PER_PAGE
      const end = start + SUPPLIERS_PER_PAGE
      setSuppliers(allSuppliers.slice(start, end))
    } catch {
      setLoadError(SUPPLIER_MESSAGES.unexpected)
    } finally {
      setIsLoading(false)
    }
  }, [search, phoneSearch, statusFilter, currentPage])

  useEffect(() => {
    const timer = setTimeout(loadSuppliers, 200)

    return () => clearTimeout(timer)
  }, [loadSuppliers])

  // Reset to page 1 when search or filter changes
  useEffect(() => {
    setCurrentPage(1)
  }, [search, phoneSearch, statusFilter])

  const closeForm = () => {
    setIsFormOpen(false)
    setEditing(null)
    setFormError(null)
  }

  const openCreateForm = () => {
    setEditing(null)
    setFormError(null)
    setActionError(null)
    setIsFormOpen(true)
  }

  const openEditForm = (supplier: Supplier) => {
    // Don't allow editing the system supplier
    if (supplier.isSystem) {
      return
    }
    setEditing(supplier)
    setFormError(null)
    setActionError(null)
    setIsFormOpen(true)
  }

  const handleSubmit = async (input: SupplierInput | SupplierUpdateInput) => {
    setIsSubmitting(true)
    setFormError(null)

    try {
      if (editing) {
        await supplierService.update(editing.id, input)
      } else {
        await supplierService.create(input)
      }

      closeForm()
      await loadSuppliers()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : SUPPLIER_MESSAGES.unexpected)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleStatusChange = async () => {
    if (!pendingStatusChange) {
      return
    }

    const { supplier, isActive } = pendingStatusChange

    setIsChangingStatus(true)
    setActionError(null)

    try {
      await supplierService.setActive(supplier.id, isActive)
      setPendingStatusChange(null)
      await loadSuppliers()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : SUPPLIER_MESSAGES.unexpected)
    } finally {
      setIsChangingStatus(false)
    }
  }

  const canEdit = (supplier: Supplier) => !supplier.isSystem
  const canToggleStatus = (supplier: Supplier) => !supplier.isSystem || supplier.isActive

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Fournisseurs</h1>
        <button
          type="button"
          onClick={openCreateForm}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          + Ajouter
        </button>
      </div>

      {actionError && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{actionError}</p>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="supplier-search" className="block text-sm font-medium text-gray-700">
            Rechercher par nom
          </label>
          <input
            id="supplier-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Nom du fournisseur"
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
          />
        </div>

        <div>
          <label htmlFor="supplier-phone-search" className="block text-sm font-medium text-gray-700">
            Rechercher par téléphone
          </label>
          <input
            id="supplier-phone-search"
            type="search"
            value={phoneSearch}
            onChange={(event) => setPhoneSearch(event.target.value)}
            placeholder="77 123 45 67"
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
          />
        </div>

        <div>
          <label htmlFor="supplier-filter-status" className="block text-sm font-medium text-gray-700">
            Statut
          </label>
          <select
            id="supplier-filter-status"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
          >
            <option value="all">Tous</option>
            <option value="active">Actifs</option>
            <option value="inactive">Inactifs</option>
          </select>
        </div>
      </div>

      {isFormOpen && (
        <SupplierForm
          key={editing ? editing.id : 'new'}
          title={editing ? 'Modifier le fournisseur' : 'Nouveau fournisseur'}
          submitLabel="Enregistrer"
          initialSupplier={editing}
          isSubmitting={isSubmitting}
          error={formError}
          onSubmit={handleSubmit}
          onCancel={closeForm}
        />
      )}

      <div className="overflow-hidden rounded-lg border bg-white shadow">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                Nom
              </th>
              <th scope="col" className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                Téléphone
              </th>
              <th scope="col" className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                Adresse
              </th>
              <th scope="col" className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                Statut
              </th>
              <th scope="col" className="px-6 py-3 text-right text-sm font-semibold text-gray-700">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading && (
              <tr>
                <td colSpan={5} className="px-6 py-6 text-center text-sm text-gray-500">
                  Chargement…
                </td>
              </tr>
            )}

            {!isLoading && loadError && (
              <tr>
                <td colSpan={5} className="px-6 py-6 text-center text-sm text-red-600">
                  {loadError}
                </td>
              </tr>
            )}

            {!isLoading && !loadError && suppliers.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-6 text-center text-sm text-gray-500">
                  Aucun fournisseur pour le moment.
                </td>
              </tr>
            )}

            {!isLoading &&
              !loadError &&
              suppliers.map((supplier) => {
                const isSystem = supplier.isSystem

                return (
                  <tr key={supplier.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 text-sm font-medium text-gray-900">
                      {supplier.name}
                      {isSystem && (
                        <span className="ml-2 inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                          Système
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">{formatPhone(supplier.phone)}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">{supplier.address ?? '—'}</td>
                    <td className="px-6 py-4 text-sm">
                      <span
                        className={
                          supplier.isActive
                            ? 'rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-700'
                            : 'rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600'
                        }
                      >
                        {supplier.isActive ? 'Actif' : 'Inactif'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right text-sm">
                      <div className="flex justify-end gap-3">
                        {canEdit(supplier) && (
                          <button
                            type="button"
                            onClick={() => openEditForm(supplier)}
                            className="font-medium text-blue-600 hover:text-blue-800"
                          >
                            Modifier
                          </button>
                        )}
                        {canToggleStatus(supplier) && (
                          <button
                            type="button"
                            onClick={() => {
                              setActionError(null)
                              setPendingStatusChange({ supplier, isActive: !supplier.isActive })
                            }}
                            className="font-medium text-red-600 hover:text-red-800"
                          >
                            {supplier.isActive ? 'Désactiver' : 'Activer'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-600">
            Page {currentPage} / {totalPages} — {totalSuppliers} fournisseur{totalSuppliers > 1 ? 's' : ''}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Précédente
            </button>
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Suivante
            </button>
          </div>
        </div>
      )}

      {pendingStatusChange && (
        <ConfirmDialog
          title={pendingStatusChange.isActive ? 'Activer le fournisseur ?' : 'Désactiver le fournisseur ?'}
          message={
            pendingStatusChange.isActive
              ? `Le fournisseur « ${pendingStatusChange.supplier.name} » sera de nouveau disponible lors des approvisionnements.`
              : `Le fournisseur « ${pendingStatusChange.supplier.name} » ne sera plus disponible lors des approvisionnements.`
          }
          confirmLabel={pendingStatusChange.isActive ? 'Activer' : 'Désactiver'}
          confirmingLabel={pendingStatusChange.isActive ? 'Activation…' : 'Désactivation…'}
          confirmTone="primary"
          isConfirming={isChangingStatus}
          onConfirm={handleStatusChange}
          onCancel={() => setPendingStatusChange(null)}
        />
      )}
    </div>
  )
}

export default Suppliers
