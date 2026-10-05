import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type {
  Product,
  StockFormLevel,
  Transformation,
  TransformationCreateInput,
} from '@/types'
import { stockService, transformationService } from '@/services'
import ConfirmDialog from '../categories/ConfirmDialog'
import TransformationForm from './TransformationForm'
import {
  computeDestinationQuantity,
  formatTransformationDate,
  formatTransformationSentence,
  getDestinationForm,
  TRANSFORMATION_MESSAGES,
} from './schemas/transformation.schema'

interface PendingTransformation {
  input: TransformationCreateInput
  product: Product
  destinationForm: string
  destinationQuantity: number
  sourceStock: number
  destinationStock: number
}

/** The confirmation sentence, shown before anything is written to SQLite. */
function buildConfirmationMessage(pending: PendingTransformation): string {
  const { input, product, destinationForm, destinationQuantity } = pending
  const sentence = formatTransformationSentence(
    input.sourceForm,
    input.sourceQuantity,
    destinationForm,
    destinationQuantity,
  )

  return [
    `Produit : ${product.name}`,
    '',
    sentence,
    '',
    `Stock actuel : ${input.sourceForm} : ${pending.sourceStock} — ${destinationForm} : ${pending.destinationStock}`,
    `Stock après : ${input.sourceForm} : ${pending.sourceStock - input.sourceQuantity} — ${destinationForm} : ${
      pending.destinationStock + destinationQuantity
    }`,
  ].join('\n')
}

function Transformations() {
  const [transformations, setTransformations] = useState<Transformation[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [levels, setLevels] = useState<StockFormLevel[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [productSearch, setProductSearch] = useState('')
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  /** Validated transformation waiting for the confirmation, never written before it. */
  const [pending, setPending] = useState<PendingTransformation | null>(null)

  const loadTransformations = useCallback(async () => {
    setIsLoading(true)
    setLoadError(null)

    try {
      setTransformations(
        await transformationService.list({
          search: search.trim() || undefined,
          productSearch: productSearch.trim() || undefined,
        }),
      )
    } catch {
      setLoadError(TRANSFORMATION_MESSAGES.unexpected)
    } finally {
      setIsLoading(false)
    }
  }, [search, productSearch])

  useEffect(() => {
    const timer = setTimeout(loadTransformations, 200)

    return () => clearTimeout(timer)
  }, [loadTransformations])

  /**
   * Only active transformable products can be transformed: the main process is
   * the one that filters them, the renderer never offers a simple or an inactive
   * product. The stock levels feed the "stock disponible" and the preview.
   */
  const loadFormData = useCallback(async () => {
    setActionError(null)

    try {
      const [availableProducts, stockLevels] = await Promise.all([
        transformationService.listProducts(),
        stockService.list(),
      ])

      setProducts(availableProducts)
      setLevels(
        stockLevels.filter((level) =>
          availableProducts.some((product) => product.id === level.productId),
        ),
      )
    } catch {
      setActionError(TRANSFORMATION_MESSAGES.unexpected)
    }
  }, [])

  useEffect(() => {
    loadFormData()
  }, [loadFormData])

  const openForm = () => {
    setActionError(null)
    setFormError(null)
    setSuccessMessage(null)
    setIsFormOpen(true)
  }

  const closeForm = () => {
    setIsFormOpen(false)
    setFormError(null)
    setPending(null)
  }

  /** The form hands over its validated payload: nothing is written yet. */
  const handleValidate = (input: TransformationCreateInput) => {
    const product = products.find((candidate) => candidate.id === input.productId)

    if (!product) {
      setFormError(TRANSFORMATION_MESSAGES.productNotFound)

      return
    }

    // Same helper as the form and the main process: the confirmation sentence can
    // never disagree with what is going to be written.
    const destinationForm = getDestinationForm(product, input.sourceForm)
    const destinationQuantity = computeDestinationQuantity(
      product,
      input.sourceForm,
      input.sourceQuantity,
    )

    if (!destinationForm || destinationQuantity === null) {
      setFormError(TRANSFORMATION_MESSAGES.conversionInvalid)

      return
    }

    const quantityByForm = new Map(
      levels
        .filter((level) => level.productId === input.productId)
        .map((level) => [level.form, level.quantity]),
    )

    setFormError(null)
    setPending({
      input,
      product,
      destinationForm,
      destinationQuantity,
      sourceStock: quantityByForm.get(input.sourceForm) ?? 0,
      destinationStock: quantityByForm.get(destinationForm) ?? 0,
    })
  }

  const handleConfirm = async () => {
    if (!pending) {
      return
    }

    setIsSubmitting(true)
    setFormError(null)

    try {
      const created = await transformationService.create(pending.input)

      closeForm()
      setSuccessMessage(`Transformation ${created.reference} enregistrée.`)
      await Promise.all([loadTransformations(), loadFormData()])

      // A filtered list would hide the document that was just created.
      if (search.trim() || productSearch.trim()) {
        setSearch('')
        setProductSearch('')
      }
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : TRANSFORMATION_MESSAGES.unexpected,
      )
      setPending(null)
    } finally {
      setIsSubmitting(false)
    }
  }

  const canOpenForm = products.length > 0

  const rows = useMemo(
    () =>
      transformations.map((transformation) => ({
        transformation,
        sentence: formatTransformationSentence(
          transformation.sourceForm,
          transformation.sourceQuantity,
          transformation.destinationForm,
          transformation.destinationQuantity,
        ),
      })),
    [transformations],
  )

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Transformations</h1>
        <button
          type="button"
          onClick={openForm}
          disabled={!canOpenForm}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          + Nouvelle transformation
        </button>
      </div>

      {actionError && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{actionError}</p>
      )}

      {successMessage && (
        <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
          {successMessage}
        </p>
      )}

      {!canOpenForm && (
        <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <p className="font-medium">Aucun produit transformable actif disponible.</p>
          <p>
            Seuls les produits actifs possédant deux formes peuvent être transformés.
          </p>
          <Link to="/products" className="font-medium text-amber-900 underline">
            Gérer les produits
          </Link>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="transformation-search" className="block text-sm font-medium text-gray-700">
            Référence
          </label>
          <input
            id="transformation-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="TRF-000001"
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
          />
        </div>

        <div>
          <label
            htmlFor="transformation-product-search"
            className="block text-sm font-medium text-gray-700"
          >
            Produit
          </label>
          <input
            id="transformation-product-search"
            type="search"
            value={productSearch}
            onChange={(event) => setProductSearch(event.target.value)}
            placeholder="Nom du produit"
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
          />
        </div>
      </div>

      {isFormOpen && (
        <TransformationForm
          products={products}
          stockLevels={levels}
          isSubmitting={isSubmitting}
          error={formError}
          onValidate={handleValidate}
          onCancel={closeForm}
        />
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
                Produit
              </th>
              <th scope="col" className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                Transformation
              </th>
              <th scope="col" className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
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

            {!isLoading && !loadError && rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-6 text-center text-sm text-gray-500">
                  Aucune transformation pour le moment.
                </td>
              </tr>
            )}

            {!isLoading &&
              !loadError &&
              rows.map(({ transformation, sentence }) => (
                <tr key={transformation.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">
                    {transformation.reference}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    {formatTransformationDate(transformation.date)}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    {transformation.productName}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-900">{sentence}</td>
                  <td className="px-6 py-4 text-right text-sm">
                    <Link
                      to={`/transformations/${transformation.id}`}
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

      {pending && (
        <ConfirmDialog
          title="Confirmer la transformation ?"
          message={buildConfirmationMessage(pending)}
          confirmLabel="Transformer"
          confirmingLabel="Validation…"
          confirmTone="primary"
          isConfirming={isSubmitting}
          onConfirm={handleConfirm}
          onCancel={() => {
            setPending(null)
            setFormError(null)
          }}
        />
      )}
    </div>
  )
}

export default Transformations