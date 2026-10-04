import type { StockMovement } from '@/types'
import {
  formatMovementDate,
  STOCK_MOVEMENT_LABELS,
  VISIBLE_MOVEMENT_TYPES,
} from './schemas/stock.schema'

interface StockHistoryProps {
  productName: string
  movements: StockMovement[]
  isLoading: boolean
  error: string | null
  onClose: () => void
}

/**
 * Read only history of a product: the movements are the source of truth and are
 * never modified. Only the movement types already implemented can appear.
 */
function StockHistory({ productName, movements, isLoading, error, onClose }: StockHistoryProps) {
  const visibleMovements = movements.filter((movement) =>
    (VISIBLE_MOVEMENT_TYPES as readonly string[]).includes(movement.movementType),
  )

  return (
    <div className="rounded-lg border bg-white p-6 shadow">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Historique du stock</h2>
          <p className="text-sm text-gray-600">{productName}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-sm font-medium text-gray-500 hover:text-gray-700"
        >
          Fermer
        </button>
      </div>

      {isLoading && <p className="mt-2 text-sm text-gray-500">Chargement…</p>}

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      {!isLoading && !error && visibleMovements.length === 0 && (
        <p className="mt-2 text-sm text-gray-500">Aucun mouvement enregistré.</p>
      )}

      {!isLoading && !error && visibleMovements.length > 0 && (
        <div className="mt-4 overflow-hidden rounded-lg border">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th
                  scope="col"
                  className="px-4 py-2 text-left text-xs font-semibold text-gray-700"
                >
                  Date
                </th>
                <th
                  scope="col"
                  className="px-4 py-2 text-left text-xs font-semibold text-gray-700"
                >
                  Type
                </th>
                <th
                  scope="col"
                  className="px-4 py-2 text-left text-xs font-semibold text-gray-700"
                >
                  Forme
                </th>
                <th
                  scope="col"
                  className="px-4 py-2 text-right text-xs font-semibold text-gray-700"
                >
                  Quantité
                </th>
                <th
                  scope="col"
                  className="px-4 py-2 text-left text-xs font-semibold text-gray-700"
                >
                  Motif
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visibleMovements.map((movement) => (
                <tr key={movement.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2 text-sm text-gray-600">
                    {formatMovementDate(movement.createdAt)}
                  </td>
                  <td className="px-4 py-2 text-sm text-gray-900">
                    {STOCK_MOVEMENT_LABELS[movement.movementType]}
                  </td>
                  <td className="px-4 py-2 text-sm text-gray-600">{movement.form}</td>
                  <td
                    className={
                      movement.signedQuantity < 0
                        ? 'px-4 py-2 text-right text-sm font-medium text-red-600'
                        : 'px-4 py-2 text-right text-sm font-medium text-green-700'
                    }
                  >
                    {movement.signedQuantity > 0 ? '+' : ''}
                    {movement.signedQuantity}
                  </td>
                  <td className="px-4 py-2 text-sm text-gray-600">{movement.reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default StockHistory