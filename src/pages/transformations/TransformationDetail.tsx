import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { TransformationDetail } from '@/types'
import { transformationService } from '@/services'
import {
  formatFormQuantity,
  formatTransformationDate,
  formatTransformationSentence,
  TRANSFORMATION_MESSAGES,
} from './schemas/transformation.schema'

/**
 * Read only view of a validated transformation: the reference, the date, the
 * product, the exact conversion applied and the resulting stock. There is
 * deliberately no edit, no delete and no cancel action: a validated
 * transformation is immutable and is corrected by an inverse transformation or
 * by a stock adjustment.
 */
function TransformationDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [transformation, setTransformation] = useState<TransformationDetail | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadTransformation = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      setTransformation(await transformationService.get(Number(id)))
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : TRANSFORMATION_MESSAGES.unexpected,
      )
    } finally {
      setIsLoading(false)
    }
  }, [id])

  useEffect(() => {
    loadTransformation()
  }, [loadTransformation])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">
            {transformation ? transformation.reference : 'Transformation'}
          </h1>
          {transformation && (
            <p className="text-sm text-gray-600">
              Date : {formatTransformationDate(transformation.date)}
            </p>
          )}
        </div>

        <div className="flex items-center gap-4">
          {transformation && (
            <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700">
              Validé
            </span>
          )}
          <Link
            to="/transformations"
            className="text-sm font-medium text-blue-600 hover:text-blue-800"
          >
            Retour à la liste
          </Link>
        </div>
      </div>

      {isLoading && <p className="text-sm text-gray-500">Chargement…</p>}

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

      {transformation && (
        <div className="space-y-4 rounded-lg border bg-white p-6 shadow">
          <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-3">
            <div>
              <dt className="text-sm text-gray-500">Référence</dt>
              <dd className="text-sm font-medium text-gray-900">
                {transformation.reference}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-gray-500">Produit</dt>
              <dd className="text-sm font-medium text-gray-900">
                {transformation.productName}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-gray-500">Date</dt>
              <dd className="text-sm font-medium text-gray-900">
                {formatTransformationDate(transformation.date)}
              </dd>
            </div>
          </dl>

          <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-3">
            <p className="text-sm font-medium text-gray-700">Transformation appliquée</p>
            <p className="mt-1 text-lg font-semibold text-gray-900">
              {formatTransformationSentence(
                transformation.sourceForm,
                transformation.sourceQuantity,
                transformation.destinationForm,
                transformation.destinationQuantity,
              )}
            </p>
          </div>

          <div>
            <h2 className="text-sm font-semibold text-gray-700">Stock après transformation</h2>
            <ul className="mt-2 space-y-1 text-sm text-gray-900">
              {transformation.stockAfter.map((level) => (
                <li key={level.form} className="flex justify-between gap-4 border-b border-gray-100 pb-1">
                  <span>{level.form}</span>
                  <span className="font-semibold">
                    {formatFormQuantity(level.form, level.quantity)}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <p className="text-xs text-gray-500">
            Une transformation validée ne peut plus être modifiée, supprimée ni annulée.
            Pour corriger une erreur, effectuez une transformation inverse ou un
            ajustement de stock.
          </p>
        </div>
      )}
    </div>
  )
}

export default TransformationDetailPage