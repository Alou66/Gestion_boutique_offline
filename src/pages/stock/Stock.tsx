import { useCallback, useEffect, useMemo, useState } from 'react'
import type { StockAdjustInput, StockFormInput, StockFormLevel, StockMovement } from '@/types'
import { stockService } from '@/services'
import ConfirmDialog from '../categories/ConfirmDialog'
import StockAdjustForm from './StockAdjustForm'
import StockHistory from './StockHistory'
import StockInitializeForm from './StockInitializeForm'
import {
  formatQuantityForForm,
  formatRowForms,
  formatRowQuantities,
  getEmptyForms,
  getStockLevelState,
  STOCK_MESSAGES,
} from './schemas/stock.schema'
import type { StockLevelState } from './schemas/stock.schema'

interface ProductTarget {
  productId: number
  productName: string
  /** Authorized forms of the product (a legacy form can never be adjusted). */
  forms: string[]
  levels: StockFormLevel[]
}

const LEVEL_STATE_LABELS: Record<StockLevelState, string> = {
  RUPTURE: 'Rupture',
  NORMAL: 'Normal',
}

const LEVEL_STATE_CLASSES: Record<StockLevelState, string> = {
  RUPTURE: 'bg-red-100 text-red-700',
  NORMAL: 'bg-green-100 text-green-700',
}

function Stock() {
  const [levels, setLevels] = useState<StockFormLevel[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [categorySearch, setCategorySearch] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [initializing, setInitializing] = useState<ProductTarget | null>(null)
  const [adjusting, setAdjusting] = useState<ProductTarget | null>(null)
  const [pendingInitialize, setPendingInitialize] = useState<{
    target: ProductTarget
    quantities: StockFormInput[]
  } | null>(null)
  const [history, setHistory] = useState<{
    productName: string
    movements: StockMovement[]
  } | null>(null)
  const [isHistoryLoading, setIsHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)

  const loadStocks = useCallback(async () => {
    setIsLoading(true)
    setLoadError(null)

    try {
      setLevels(
        await stockService.list({
          search: search.trim() || undefined,
          categorySearch: categorySearch.trim() || undefined,
        }),
      )
    } catch {
      setLoadError(STOCK_MESSAGES.unexpected)
    } finally {
      setIsLoading(false)
    }
  }, [search, categorySearch])

  useEffect(() => {
    const timer = setTimeout(loadStocks, 200)

    return () => clearTimeout(timer)
  }, [loadStocks])

  /** Groups the rows by product: the page works product by product. */
  const targets = useMemo<ProductTarget[]>(() => {
    const byProduct = new Map<number, ProductTarget>()

    for (const level of levels) {
      const target = byProduct.get(level.productId) ?? {
        productId: level.productId,
        productName: level.productName,
        forms: [],
        levels: [],
      }

      target.levels.push(level)

      if (!level.isLegacyForm) {
        target.forms.push(level.form)
      }

      byProduct.set(level.productId, target)
    }

    return [...byProduct.values()]
  }, [levels])

  const closeForms = () => {
    setInitializing(null)
    setAdjusting(null)
    setPendingInitialize(null)
    setFormError(null)
  }

  const openInitializeForm = (target: ProductTarget) => {
    setActionError(null)
    setAdjusting(null)
    setFormError(null)
    setInitializing(target)
  }

  const openAdjustForm = (target: ProductTarget) => {
    setActionError(null)
    setInitializing(null)
    setFormError(null)
    setAdjusting(target)
  }

  const loadHistory = async (target: { productId: number; productName: string }) => {
    setHistoryError(null)

    try {
      setHistory({
        productName: target.productName,
        movements: await stockService.movements(target.productId),
      })
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : STOCK_MESSAGES.unexpected)
    }
  }

  const handleInitializeSubmit = (quantities: StockFormInput[]) => {
    if (!initializing) {
      return
    }

    setPendingInitialize({ target: initializing, quantities })
  }

  const handleInitializeConfirm = async () => {
    if (!pendingInitialize) {
      return
    }

    const { target, quantities } = pendingInitialize

    setIsSubmitting(true)
    setFormError(null)

    try {
      await stockService.initialize(target.productId, {
        productId: target.productId,
        quantities,
      })
      closeForms()
      await loadStocks()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : STOCK_MESSAGES.unexpected)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleAdjustSubmit = async (input: Omit<StockAdjustInput, 'productId'>) => {
    if (!adjusting) {
      return
    }

    setIsSubmitting(true)
    setFormError(null)

    try {
      await stockService.adjust(adjusting.productId, {
        ...input,
        productId: adjusting.productId,
      })
      closeForms()
      await loadStocks()

      if (history?.productName === adjusting.productName) {
        await loadHistory(adjusting)
      }
    } catch (error) {
      setFormError(error instanceof Error ? error.message : STOCK_MESSAGES.unexpected)
    } finally {
      setIsSubmitting(false)
    }
  }

  const openHistory = async (target: ProductTarget) => {
    setActionError(null)
    setHistoryError(null)
    setHistory({ productName: target.productName, movements: [] })
    setIsHistoryLoading(true)

    await loadHistory(target)

    setIsHistoryLoading(false)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Stock</h1>
      </div>

      {actionError && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{actionError}</p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="stock-search" className="block text-sm font-medium text-gray-700">
            Recherche produit
          </label>
          <input
            id="stock-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Nom du produit"
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
          />
        </div>

        <div>
          <label
            htmlFor="stock-category-search"
            className="block text-sm font-medium text-gray-700"
          >
            Catégorie
          </label>
          <input
            id="stock-category-search"
            type="search"
            value={categorySearch}
            onChange={(event) => setCategorySearch(event.target.value)}
            placeholder="Nom de la catégorie"
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
          />
        </div>
      </div>

      {initializing && (
        <StockInitializeForm
          key={`init-${initializing.productId}`}
          productName={initializing.productName}
          forms={initializing.forms}
          isSubmitting={isSubmitting}
          error={formError}
          onSubmit={handleInitializeSubmit}
          onCancel={closeForms}
        />
      )}

      {adjusting && (
        <StockAdjustForm
          key={`adjust-${adjusting.productId}`}
          productName={adjusting.productName}
          forms={adjusting.forms}
          initialForm={adjusting.forms[0] ?? ''}
          quantities={adjusting.levels}
          isSubmitting={isSubmitting}
          error={formError}
          onSubmit={handleAdjustSubmit}
          onCancel={closeForms}
        />
      )}

      {history && (
        <StockHistory
          productName={history.productName}
          movements={history.movements}
          isLoading={isHistoryLoading}
          error={historyError}
          onClose={() => {
            setHistory(null)
            setHistoryError(null)
          }}
        />
      )}

      <div className="overflow-hidden rounded-lg border bg-white shadow">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                Produit
              </th>
              <th scope="col" className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                Forme
              </th>
              <th scope="col" className="px-6 py-3 text-right text-sm font-semibold text-gray-700">
                Quantité
              </th>
              <th scope="col" className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                État
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

            {!isLoading && !loadError && targets.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-6 text-center text-sm text-gray-500">
                  Aucun produit pour le moment.
                </td>
              </tr>
            )}

            {!isLoading &&
              !loadError &&
              targets.map((target) => {
                const state = getStockLevelState(target)
                // A product without any movement has a stock of 0: its initial
                // stock can still be declared, exactly once.
                const canInitialize = target.levels.every((level) => !level.hasMovements)
                const isActive = target.levels.every((level) => level.isProductActive)
                const legacyForms = target.levels
                  .filter((level) => level.isLegacyForm)
                  .map((level) => level.form)
                const emptyForms = getEmptyForms(target)

                return (
                  <tr key={target.productId} className="hover:bg-gray-50">
                    <td className="px-6 py-4 text-sm font-medium text-gray-900">
                      {target.productName}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {formatRowForms(target)}
                      {legacyForms.length > 0 && (
                        <span className="block text-xs text-gray-500">
                          dont {legacyForms.join(', ')} : forme historique
                        </span>
                      )}
                      {!isActive && (
                        <span className="block text-xs text-gray-500">
                          produit inactif
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right text-sm font-medium text-gray-900">
                      {formatRowQuantities(target)}
                      {state === 'NORMAL' && emptyForms.length > 0 && (
                        <span className="block text-xs font-normal text-amber-600">
                          sans stock : {emptyForms.join(', ')}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-medium ${LEVEL_STATE_CLASSES[state]}`}
                      >
                        {LEVEL_STATE_LABELS[state]}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right text-sm">
                      <div className="flex justify-end gap-3">
                        {canInitialize && (
                          <button
                            type="button"
                            onClick={() => openInitializeForm(target)}
                            disabled={!isActive}
                            title={
                              isActive
                                ? undefined
                                : 'Réactivez le produit pour initialiser son stock'
                            }
                            className="font-medium text-blue-600 hover:text-blue-800 disabled:cursor-not-allowed disabled:text-gray-400"
                          >
                            Initialiser
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => openAdjustForm(target)}
                          disabled={!isActive}
                          title={
                            isActive
                              ? undefined
                              : 'Réactivez le produit pour ajuster son stock'
                          }
                          className="font-medium text-indigo-600 hover:text-indigo-800 disabled:cursor-not-allowed disabled:text-gray-400"
                        >
                          Ajuster
                        </button>
                        <button
                          type="button"
                          onClick={() => openHistory(target)}
                          className="font-medium text-gray-600 hover:text-gray-800"
                        >
                          Historique
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
          </tbody>
        </table>
      </div>

      {pendingInitialize && (
        <ConfirmDialog
          title="Confirmer l'initialisation ?"
          message={`${
            pendingInitialize.target.productName
          } — ${pendingInitialize.quantities
            .map((entry) => formatQuantityForForm(entry.form, entry.quantity))
            .join(', ')}. Cette opération est définitive et ne pourra plus être modifiée.`}
          confirmLabel="Initialiser"
          confirmingLabel="Initialisation…"
          isConfirming={isSubmitting}
          onConfirm={handleInitializeConfirm}
          onCancel={() => {
            setPendingInitialize(null)
            setFormError(null)
          }}
        />
      )}
    </div>
  )
}

export default Stock