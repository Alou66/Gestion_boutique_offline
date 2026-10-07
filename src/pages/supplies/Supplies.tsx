import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Product, Supply, SupplyCreateInput, Supplier } from '@/types'
import { productService, supplyService, supplierService } from '@/services'
import ConfirmDialog from '../categories/ConfirmDialog'
import {
  clearSupplyDraft,
  readSupplyDraft,
  saveSupplyDraft,
} from './supply-draft'
import type { SupplyDraft } from './supply-draft'
import SupplyForm from './SupplyForm'
import {
  buildValidationMessage,
  formatAmount,
  formatSupplyDate,
  sumLineTotals,
  SUPPLY_MESSAGES,
} from './schemas/supply.schema'

function Supplies() {
  const [supplies, setSupplies] = useState<Supply[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [supplierSearch, setSupplierSearch] = useState('')
  /** Réception en cours retrouvée à l'ouverture : le formulaire se rouvre. */
  const [restoredDraft, setRestoredDraft] = useState<SupplyDraft | null>(() =>
    readSupplyDraft(),
  )
  const [isFormOpen, setIsFormOpen] = useState(restoredDraft !== null)
  /** Force le remount du formulaire après l'effacement du brouillon. */
  const [formEpoch, setFormEpoch] = useState(0)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  /** Validated lines waiting for the confirmation, never written before it. */
  const [pendingValidation, setPendingValidation] = useState<SupplyCreateInput | null>(null)

  const loadSupplies = useCallback(async () => {
    setIsLoading(true)
    setLoadError(null)

    try {
      setSupplies(
        await supplyService.list({
          search: search.trim() || undefined,
          supplierSearch: supplierSearch.trim() || undefined,
        }),
      )
    } catch {
      setLoadError(SUPPLY_MESSAGES.unexpected)
    } finally {
      setIsLoading(false)
    }
  }, [search, supplierSearch])

  useEffect(() => {
    const timer = setTimeout(loadSupplies, 200)

    return () => clearTimeout(timer)
  }, [loadSupplies])

  /**
   * Only active products can be received, the same rule as the stock module.
   * A product without any movement has a stock of 0 and can be received right
   * away: no initial stock is required beforehand.
   */
  const loadFormData = useCallback(async () => {
    setActionError(null)

    try {
      const [activeProducts, activeSuppliers] = await Promise.all([
        productService.list({ isActive: true }),
        supplierService.list({ isActive: true }),
      ])
      setProducts(activeProducts)
      setSuppliers(activeSuppliers)
    } catch {
      setActionError(SUPPLY_MESSAGES.unexpected)
    }
  }, [])

  useEffect(() => {
    loadFormData()
  }, [loadFormData])

  const openForm = () => {
    setActionError(null)
    setFormError(null)
    setIsFormOpen(true)
  }

  const closeForm = () => {
    setIsFormOpen(false)
    setFormError(null)
    setPendingValidation(null)
  }

  const handleDraftChange = useCallback((draft: SupplyDraft) => {
    saveSupplyDraft(draft)
  }, [])

  /** Oublie le brouillon et repart d'une réception vide. */
  const handleDiscardDraft = () => {
    clearSupplyDraft()
    setRestoredDraft(null)
    setFormEpoch((epoch) => epoch + 1)
  }

  /** The form hands over its validated lines: nothing is written yet. */
  const handleValidate = (input: SupplyCreateInput) => {
    setFormError(null)
    setPendingValidation(input)
  }

  const handleConfirmValidation = async () => {
    if (!pendingValidation) {
      return
    }

    setIsSubmitting(true)
    setFormError(null)

    try {
      await supplyService.create(pendingValidation)

      // Le document existe : le brouillon n'a plus de raison d'être.
      clearSupplyDraft()
      setRestoredDraft(null)
      closeForm()
      await loadSupplies()

      // A filtered list would hide the document that was just created.
      if (search.trim() || supplierSearch.trim()) {
        setSearch('')
        setSupplierSearch('')
      }
    } catch (error) {
      setFormError(error instanceof Error ? error.message : SUPPLY_MESSAGES.unexpected)
      setPendingValidation(null)
    } finally {
      setIsSubmitting(false)
    }
  }

  const canOpenForm = products.length > 0

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Approvisionnements</h1>
        <button
          type="button"
          onClick={openForm}
          disabled={!canOpenForm}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          + Nouvel approvisionnement
        </button>
      </div>

      {actionError && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{actionError}</p>
      )}

      {!canOpenForm && (
        <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <p className="font-medium">Aucun produit actif disponible.</p>
          <p>Créez d&apos;abord un produit actif avant de créer un approvisionnement.</p>
          <Link to="/products" className="font-medium text-amber-900 underline">
            Gérer les produits
          </Link>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="supply-search" className="block text-sm font-medium text-gray-700">
            Référence
          </label>
          <input
            id="supply-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="APP-000001"
            className="mt-1 block w-full rounded-md border border-gray-500 shadow-sm focus:border-blue-500 focus:ring-blue-500"
          />
        </div>

        <div>
          <label
            htmlFor="supply-supplier-search"
            className="block text-sm font-medium text-gray-700"
          >
            Fournisseur
          </label>
          <input
            id="supply-supplier-search"
            type="search"
            value={supplierSearch}
            onChange={(event) => setSupplierSearch(event.target.value)}
            placeholder="Nom du fournisseur"
            className="mt-1 block w-full rounded-md border border-gray-500 shadow-sm focus:border-blue-500 focus:ring-blue-500"
          />
        </div>
      </div>

      {isFormOpen && (
        <div className="space-y-4">
          {restoredDraft && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
              <p>
                <span className="font-medium">Brouillon restauré :</span> la
                réception en cours (
                {restoredDraft.lines.length}{' '}
                {restoredDraft.lines.length > 1 ? 'lignes' : 'ligne'}, total
                de {formatAmount(sumLineTotals(restoredDraft.lines))}) a été
                conservée. Vous pouvez continuer là où vous étiez.
              </p>
              <button
                type="button"
                onClick={handleDiscardDraft}
                className="font-medium text-blue-900 underline"
              >
                Effacer le brouillon
              </button>
            </div>
          )}

          <SupplyForm
            key={formEpoch}
            products={products}
            suppliers={suppliers}
            draft={restoredDraft}
            isSubmitting={isSubmitting}
            error={formError}
            onValidate={handleValidate}
            onDraftChange={handleDraftChange}
            onCancel={closeForm}
          />
        </div>
      )}

      <div className="overflow-hidden rounded-lg border bg-white shadow">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                Référence
              </th>
              <th scope="col" className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                Date
              </th>
              <th scope="col" className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                Fournisseur
              </th>
              <th scope="col" className="px-6 py-3 text-right text-sm font-semibold text-gray-700">
                Lignes
              </th>
              <th scope="col" className="px-6 py-3 text-right text-sm font-semibold text-gray-700">
                Total
              </th>
              <th scope="col" className="px-6 py-3 text-right text-sm font-semibold text-gray-700">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading && (
              <tr>
                <td colSpan={6} className="px-6 py-6 text-center text-sm text-gray-500">
                  Chargement…
                </td>
              </tr>
            )}

            {!isLoading && loadError && (
              <tr>
                <td colSpan={6} className="px-6 py-6 text-center text-sm text-red-600">
                  {loadError}
                </td>
              </tr>
            )}

            {!isLoading && !loadError && supplies.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-6 text-center text-sm text-gray-500">
                  Aucun approvisionnement pour le moment.
                </td>
              </tr>
            )}

            {!isLoading &&
              !loadError &&
              supplies.map((supply) => (
                <tr key={supply.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">
                    {supply.reference}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    {formatSupplyDate(supply.date)}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    {supply.supplierName ?? '—'}
                  </td>
                  <td className="px-6 py-4 text-right text-sm text-gray-600">
                    {supply.itemCount}
                  </td>
                  <td className="px-6 py-4 text-right text-sm font-medium text-gray-900">
                    {formatAmount(supply.totalAmount)}
                  </td>
                  <td className="px-6 py-4 text-right text-sm">
                    <Link
                      to={`/approvisionnements/${supply.id}`}
                      className="font-medium text-blue-600 hover:text-blue-800"
                    >
                      Consulter
                    </Link>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {pendingValidation && (
        <ConfirmDialog
          title="Valider l'approvisionnement ?"
          message={buildValidationMessage(
            pendingValidation,
            pendingValidation.supplierId
              ? suppliers.find((supplier) => supplier.id === pendingValidation.supplierId)?.name ?? null
              : null,
          )}
          confirmLabel="Valider"
          confirmingLabel="Validation…"
          confirmTone="primary"
          isConfirming={isSubmitting}
          onConfirm={handleConfirmValidation}
          onCancel={() => {
            setPendingValidation(null)
            setFormError(null)
          }}
        />
      )}
    </div>
  )
}

export default Supplies
