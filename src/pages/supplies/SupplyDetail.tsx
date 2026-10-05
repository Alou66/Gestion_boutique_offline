import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { SupplyDetail } from '@/types'
import { supplyService } from '@/services'
import {
  formatAmount,
  formatReceivedQuantity,
  formatSupplyDate,
  SUPPLY_MESSAGES,
} from './schemas/supply.schema'

/**
 * Read only view of a validated supply: the reference, the date, the lines with
 * the price really paid on that day and the total. There is deliberately no
 * edit and no delete action: an approvisionnement validé is immutable.
 */
function SupplyDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [supply, setSupply] = useState<SupplyDetail | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadSupply = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      setSupply(await supplyService.get(Number(id)))
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : SUPPLY_MESSAGES.unexpected,
      )
    } finally {
      setIsLoading(false)
    }
  }, [id])

  useEffect(() => {
    loadSupply()
  }, [loadSupply])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">
            {supply ? supply.reference : 'Approvisionnement'}
          </h1>
          {supply && (
            <p className="text-sm text-gray-600">
              Date : {formatSupplyDate(supply.date)}
            </p>
          )}
        </div>

        <div className="flex items-center gap-4">
          {supply && (
            <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700">
              Validé
            </span>
          )}
          <Link
            to="/approvisionnements"
            className="text-sm font-medium text-blue-600 hover:text-blue-800"
          >
            Retour à la liste
          </Link>
        </div>
      </div>

      {isLoading && <p className="text-sm text-gray-500">Chargement…</p>}

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

      {supply && (
        <div className="space-y-4 rounded-lg border bg-white p-6 shadow">
          <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-3">
            <div>
              <dt className="text-sm text-gray-500">Référence</dt>
              <dd className="text-sm font-medium text-gray-900">{supply.reference}</dd>
            </div>
            <div>
              <dt className="text-sm text-gray-500">Fournisseur</dt>
              <dd className="text-sm font-medium text-gray-900">
                {supply.supplierName ?? '—'}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-gray-500">Date</dt>
              <dd className="text-sm font-medium text-gray-900">
                {formatSupplyDate(supply.date)}
              </dd>
            </div>
          </dl>

          <div>
            <h2 className="text-sm font-semibold text-gray-700">Produits</h2>

            <ul className="mt-2 space-y-2">
              {supply.items.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-baseline justify-between gap-2 border-b border-gray-100 pb-2"
                >
                  <div>
                    <p className="text-sm font-medium text-gray-900">{item.productName}</p>
                    <p className="text-sm text-gray-600">
                      {formatReceivedQuantity(item.form, item.quantity)} ×{' '}
                      {formatAmount(item.purchaseUnitPrice)}
                    </p>
                  </div>
                  <p className="text-sm font-semibold text-gray-900">
                    {formatAmount(item.lineTotal)}
                  </p>
                </li>
              ))}
            </ul>

            <div className="mt-4 flex items-baseline justify-between border-t border-gray-200 pt-3">
              <span className="text-sm font-semibold text-gray-700">
                Total ({supply.items.length}{' '}
                {supply.items.length > 1 ? 'lignes' : 'ligne'})
              </span>
              <span className="text-lg font-bold text-gray-900">
                {formatAmount(supply.totalAmount)}
              </span>
            </div>
          </div>

          <p className="text-xs text-gray-500">
            Un approvisionnement validé ne peut plus être modifié. En cas d&apos;erreur,
            corrigez le stock avec un ajustement.
          </p>
        </div>
      )}
    </div>
  )
}

export default SupplyDetailPage
