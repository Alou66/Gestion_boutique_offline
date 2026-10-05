import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import type { Product, StockFormLevel, TransformationCreateInput } from '@/types'
import {
  computeDestinationQuantity,
  formatConversionRule,
  formatFormQuantity,
  getConversionRatio,
  getDestinationForm,
  getProductForms,
  parseNumberField,
  todayInputValue,
  TRANSFORMATION_MESSAGES,
  TRANSFORMATION_QUANTITY_MAX,
  transformationFormSchema,
  toTransformationInput,
  validateTransformationDraft,
} from './schemas/transformation.schema'
import type { TransformationFormErrors } from './schemas/transformation.schema'

interface TransformationFormProps {
  /** Active transformable products only, already loaded by the page. */
  products: Product[]
  /** Current balance of every form, one entry per form of the product. */
  stockLevels: StockFormLevel[]
  isSubmitting: boolean
  error: string | null
  /** The validated transformation is handed over for the confirmation step. */
  onValidate: (input: TransformationCreateInput) => void
  onCancel: () => void
}

/**
 * One shot transformation form: pick a transformable product, pick the form the
 * quantity is taken from and type how many units to transform. The destination
 * form and the destination quantity are never typed: they are derived from the
 * conversion of the product, so a fractional result is impossible to send.
 *
 * Nothing is written before the confirmation step of the page.
 */
function TransformationForm({
  products,
  stockLevels,
  isSubmitting,
  error,
  onValidate,
  onCancel,
}: TransformationFormProps) {
  const [date, setDate] = useState(todayInputValue())
  const [productId, setProductId] = useState('')
  const [sourceForm, setSourceForm] = useState('')
  const [sourceQuantity, setSourceQuantity] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<TransformationFormErrors>({})

  const productsById = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products],
  )

  const selectedProduct = productsById.get(Number(productId)) ?? null
  const forms = getProductForms(selectedProduct)
  const conversionRule = formatConversionRule(selectedProduct)
  const destinationForm = getDestinationForm(selectedProduct, sourceForm)
  const conversionRatio = getConversionRatio(selectedProduct)

  const quantityByForm = useMemo(
    () =>
      new Map(stockLevels.filter((level) => level.productId === Number(productId))
        .map((level) => [level.form, level.quantity])),
    [stockLevels, productId],
  )

  // Display only: an input still being typed never produces a partial quantity.
  const parsedQuantity = parseNumberField(sourceQuantity)
  const destinationQuantity =
    typeof parsedQuantity === 'number'
      ? computeDestinationQuantity(selectedProduct, sourceForm, parsedQuantity)
      : null

  const sourceQuantityValue = typeof parsedQuantity === 'number' ? parsedQuantity : 0
  const sourceStock = quantityByForm.get(sourceForm)

  const handleProductChange = (rawProductId: string) => {
    const product = productsById.get(Number(rawProductId)) ?? null
    const productForms = getProductForms(product)

    setFieldErrors({})
    setFormError(null)
    setProductId(rawProductId)
    // The source form and the quantity belong to the previous product: they are
    // reset instead of being carried over by mistake.
    setSourceForm(productForms[0] ?? '')
    setSourceQuantity('')
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFormError(null)
    setFieldErrors({})

    const parsed = transformationFormSchema.safeParse({
      date,
      productId: parseNumberField(productId),
      sourceForm,
      sourceQuantity: parseNumberField(sourceQuantity),
    })

    if (!parsed.success) {
      const nextErrors: TransformationFormErrors = {}

      for (const issue of parsed.error.issues) {
        const field = issue.path[0]

        if (
          typeof field === 'string' &&
          !nextErrors[field as keyof TransformationFormErrors]
        ) {
          nextErrors[field as keyof TransformationFormErrors] = issue.message
        }
      }

      setFieldErrors(nextErrors)

      return
    }

    const draftIssue = validateTransformationDraft(
      parsed.data.productId,
      parsed.data.sourceForm,
      products,
    )

    if (draftIssue) {
      setFieldErrors({ productId: draftIssue })

      return
    }

    // The conversion is checked before the round trip so the shopkeeper sees the
    // refusal immediately; the main process checks it again before writing.
    if (
      computeDestinationQuantity(
        selectedProduct,
        parsed.data.sourceForm,
        parsed.data.sourceQuantity,
      ) === null
    ) {
      setFieldErrors({ sourceQuantity: TRANSFORMATION_MESSAGES.conversionInvalid })

      return
    }

    onValidate(toTransformationInput(parsed.data))
  }

  const hasProduct = selectedProduct !== null

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border bg-white p-6 shadow">
      <h2 className="text-lg font-semibold">Nouvelle transformation</h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="transformation-product" className="block text-sm font-medium text-gray-700">
            Produit
          </label>
          <select
            id="transformation-product"
            name="productId"
            value={productId}
            onChange={(event) => handleProductChange(event.target.value)}
            disabled={isSubmitting}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-60"
          >
            <option value="">Sélectionner un produit</option>
            {products.map((availableProduct) => (
              <option key={availableProduct.id} value={availableProduct.id}>
                {availableProduct.name}
              </option>
            ))}
          </select>
          {fieldErrors.productId && (
            <p className="mt-1 text-sm text-red-600">{fieldErrors.productId}</p>
          )}
        </div>

        <div>
          <label htmlFor="transformation-date" className="block text-sm font-medium text-gray-700">
            Date
          </label>
          <input
            id="transformation-date"
            name="date"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            disabled={isSubmitting}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-60"
          />
          {fieldErrors.date && <p className="mt-1 text-sm text-red-600">{fieldErrors.date}</p>}
        </div>
      </div>

      {conversionRule && (
        <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 px-3 py-2">
          <span className="text-sm font-medium text-gray-700">Conversion</span>
          <p className="text-sm font-semibold text-gray-900">{conversionRule}</p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-4">
        <div>
          <label htmlFor="transformation-source" className="block text-sm font-medium text-gray-700">
            Transformer depuis
          </label>
          <select
            id="transformation-source"
            name="sourceForm"
            value={sourceForm}
            onChange={(event) => {
              setFieldErrors({})
              setSourceForm(event.target.value)
            }}
            disabled={isSubmitting || !hasProduct}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-60"
          >
            {forms.length === 0 && <option value="">—</option>}
            {forms.map((availableForm) => (
              <option key={availableForm} value={availableForm}>
                {availableForm}
              </option>
            ))}
          </select>
          {fieldErrors.sourceForm && (
            <p className="mt-1 text-sm text-red-600">{fieldErrors.sourceForm}</p>
          )}
        </div>

        <div>
          <span className="block text-sm font-medium text-gray-700">Vers</span>
          <input
            id="transformation-destination"
            name="destinationForm"
            type="text"
            readOnly
            value={destinationForm ?? ''}
            placeholder="—"
            disabled={isSubmitting}
            className="mt-1 block w-full rounded-md border-gray-200 bg-gray-100 text-gray-600 shadow-sm"
          />
        </div>

        <div>
          <label
            htmlFor="transformation-quantity"
            className="block text-sm font-medium text-gray-700"
          >
            Quantité
          </label>
          <input
            id="transformation-quantity"
            name="sourceQuantity"
            type="number"
            inputMode="numeric"
            min={1}
            max={TRANSFORMATION_QUANTITY_MAX}
            step={1}
            placeholder="0"
            value={sourceQuantity}
            onChange={(event) => {
              setFieldErrors({})
              setSourceQuantity(event.target.value)
            }}
            disabled={isSubmitting || !hasProduct}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-60"
          />
          {fieldErrors.sourceQuantity && (
            <p className="mt-1 text-sm text-red-600">{fieldErrors.sourceQuantity}</p>
          )}
        </div>

        <div>
          <span className="block text-sm font-medium text-gray-700">Résultat</span>
          <p className="mt-1 text-sm font-semibold text-gray-900">
            {destinationQuantity !== null && destinationForm
              ? formatFormQuantity(destinationForm, destinationQuantity)
              : '—'}
          </p>
        </div>
      </div>

      {hasProduct && sourceForm && (
        <p className="text-sm text-gray-700">
          Stock disponible : {formatFormQuantity(sourceForm, sourceStock ?? 0)}
        </p>
      )}

      {hasProduct && destinationForm && destinationQuantity !== null && (
        <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
          <p className="text-sm font-medium text-gray-700">Stock après transformation</p>
          <ul className="mt-1 space-y-1 text-sm text-gray-900">
            {forms.map((availableForm) => (
              <li key={availableForm} className="flex justify-between gap-4">
                <span>{availableForm}</span>
                <span className="font-semibold">
                  {(quantityByForm.get(availableForm) ?? 0) +
                    (availableForm === sourceForm ? -sourceQuantityValue : destinationQuantity ?? 0)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {formError && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{formError}</p>
      )}

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
      )}

      <p className="text-xs text-gray-500">
        La conversion est exacte : aucune quantité fractionnaire n&apos;est acceptée et
        aucune perte n&apos;est autorisée. Une fois validée, la transformation est
        définitive ; pour corriger une erreur, utilisez une transformation inverse ou un
        ajustement de stock.
        {conversionRatio !== null && ` (conversion : ${conversionRatio})`}
      </p>

      <div className="flex justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
        >
          Annuler
        </button>
        <button
          type="submit"
          disabled={isSubmitting || !hasProduct || sourceForm === ''}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? 'Validation…' : 'Transformer'}
        </button>
      </div>
    </form>
  )
}

export default TransformationForm