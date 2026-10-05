import { useCallback, useEffect, useState } from 'react'
import type { Client, ClientInput, ClientUpdateInput } from '@/types'
import { clientService } from '@/services'
import ConfirmDialog from '../categories/ConfirmDialog'
import ClientForm from './ClientForm'
import { CLIENT_MESSAGES } from './schemas/client.schema'

const CLIENTS_PER_PAGE = 20

type StatusFilter = 'all' | 'active' | 'inactive'

function formatPhone(phone: string): string {
  if (phone.startsWith('+221')) {
    const num = phone.slice(4)
    return `${num.slice(0, 2)} ${num.slice(2, 5)} ${num.slice(5, 7)} ${num.slice(7, 9)}`
  }
  return phone
}

function Clients() {
  const [clients, setClients] = useState<Client[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [phoneSearch, setPhoneSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalClients, setTotalClients] = useState(0)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editing, setEditing] = useState<Client | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [pendingStatusChange, setPendingStatusChange] = useState<{
    client: Client
    isActive: boolean
  } | null>(null)
  const [isChangingStatus, setIsChangingStatus] = useState(false)

  const loadClients = useCallback(async () => {
    setIsLoading(true)
    setLoadError(null)

    try {
      const allClients = await clientService.list({
        search: search.trim() || undefined,
        phoneSearch: phoneSearch.trim() || undefined,
        isActive: statusFilter === 'all' ? undefined : statusFilter === 'active',
      })

      setTotalClients(allClients.length)
      setTotalPages(Math.ceil(allClients.length / CLIENTS_PER_PAGE) || 1)

      // Simple client-side pagination
      const start = (currentPage - 1) * CLIENTS_PER_PAGE
      const end = start + CLIENTS_PER_PAGE
      setClients(allClients.slice(start, end))
    } catch {
      setLoadError(CLIENT_MESSAGES.unexpected)
    } finally {
      setIsLoading(false)
    }
  }, [search, phoneSearch, statusFilter, currentPage])

  useEffect(() => {
    const timer = setTimeout(loadClients, 200)

    return () => clearTimeout(timer)
  }, [loadClients])

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

  const openEditForm = (client: Client) => {
    // Don't allow editing the system client
    if (client.isSystem) {
      return
    }
    setEditing(client)
    setFormError(null)
    setActionError(null)
    setIsFormOpen(true)
  }

  const handleSubmit = async (input: ClientInput | ClientUpdateInput) => {
    setIsSubmitting(true)
    setFormError(null)

    try {
      if (editing) {
        await clientService.update(editing.id, input)
      } else {
        await clientService.create(input)
      }

      closeForm()
      await loadClients()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : CLIENT_MESSAGES.unexpected)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleStatusChange = async () => {
    if (!pendingStatusChange) {
      return
    }

    const { client, isActive } = pendingStatusChange

    setIsChangingStatus(true)
    setActionError(null)

    try {
      await clientService.setActive(client.id, isActive)
      setPendingStatusChange(null)
      await loadClients()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : CLIENT_MESSAGES.unexpected)
    } finally {
      setIsChangingStatus(false)
    }
  }

  const canEdit = (client: Client) => !client.isSystem
  const canToggleStatus = (client: Client) => !client.isSystem || client.isActive

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Clients</h1>
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
          <label htmlFor="client-search" className="block text-sm font-medium text-gray-700">
            Rechercher par nom
          </label>
          <input
            id="client-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Nom du client"
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
          />
        </div>

        <div>
          <label htmlFor="client-phone-search" className="block text-sm font-medium text-gray-700">
            Rechercher par téléphone
          </label>
          <input
            id="client-phone-search"
            type="search"
            value={phoneSearch}
            onChange={(event) => setPhoneSearch(event.target.value)}
            placeholder="77 123 45 67"
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
          />
        </div>

        <div>
          <label htmlFor="client-filter-status" className="block text-sm font-medium text-gray-700">
            Statut
          </label>
          <select
            id="client-filter-status"
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
        <ClientForm
          key={editing ? editing.id : 'new'}
          title={editing ? 'Modifier le client' : 'Nouveau client'}
          submitLabel="Enregistrer"
          initialClient={editing}
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

            {!isLoading && !loadError && clients.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-6 text-center text-sm text-gray-500">
                  Aucun client pour le moment.
                </td>
              </tr>
            )}

            {!isLoading &&
              !loadError &&
              clients.map((client) => {
                const isSystem = client.isSystem

                return (
                  <tr key={client.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 text-sm font-medium text-gray-900">
                      {client.name}
                      {isSystem && (
                        <span className="ml-2 inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                          Système
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">{formatPhone(client.phone)}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">{client.address ?? '—'}</td>
                    <td className="px-6 py-4 text-sm">
                      <span
                        className={
                          client.isActive
                            ? 'rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-700'
                            : 'rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600'
                        }
                      >
                        {client.isActive ? 'Actif' : 'Inactif'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right text-sm">
                      <div className="flex justify-end gap-3">
                        {canEdit(client) && (
                          <button
                            type="button"
                            onClick={() => openEditForm(client)}
                            className="font-medium text-blue-600 hover:text-blue-800"
                          >
                            Modifier
                          </button>
                        )}
                        {canToggleStatus(client) && (
                          <button
                            type="button"
                            onClick={() => {
                              setActionError(null)
                              setPendingStatusChange({ client, isActive: !client.isActive })
                            }}
                            className="font-medium text-red-600 hover:text-red-800"
                          >
                            {client.isActive ? 'Désactiver' : 'Activer'}
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
            Page {currentPage} / {totalPages} — {totalClients} client{totalClients > 1 ? 's' : ''}
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
          title={pendingStatusChange.isActive ? 'Activer le client ?' : 'Désactiver le client ?'}
          message={
            pendingStatusChange.isActive
              ? `Le client « ${pendingStatusChange.client.name} » sera de nouveau proposé dans les futurs modules.`
              : `Le client « ${pendingStatusChange.client.name} » ne sera plus proposé dans les futurs modules.`
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

export default Clients