import { useState } from 'react'
import type { FormEvent } from 'react'
import type { StockAdjustInput, StockDirection, StockFormLevel } from '@/types'
import {
  parseNumberField,
  STOCK_DIRECTION_LABELS,
  STOCK_QUANTITY_MAX,
  STOCK_REASON_MAX_LENGTH,
  stockAdjustFormSchema,
} from './schemas/stock.schema'
import type { StockAdjustFormErrors } from './schemas/stock.schema'

/** The product is chosen by the page, the form only sends the movement itself. */
type StockAdjustValues = Omit<StockAdjustInput, 'productId'>

interface StockAdjustFormProps {
  productName: string
  /** Authorized forms of the product, in display order. */
  forms: string[]
  initialForm: string
  /** Current quantity of each form, shown to help the shopkeeper. */
  quantities: StockFormLevel[]
  isSubmitting: boolean
  error: string | null
  onSubmit: (input: StockAdjustValues) => void
  onCancel: () => void
}

/**
 * Manual correction of an existing stock: an entrée (IN) or a sortie (OUT) on a
 * single form, with a mandatory reason. The stock can never become negative,
 * that rule is enforced by the main process.
 */
function StockAdjustForm({
  productName,
  forms,
  initialForm,
  quantities,
  isSubmitting,
  error,
  onSubmit,
  onCancel,
}: StockAdjustFormProps) {
  const [form, setForm] = useState(initialForm)
  const [direction, setDirection] = useState<StockDirection>('IN')
  const [quantity, setQuantity] = useState('')
  const [reason, setReason] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<StockAdjustFormErrors>({})

  const currentQuantity =
    quantities.find((level) => level.form === form)?.quantity ?? 0

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFormError(null)
    setFieldErrors({})

    const parsed = stockAdjustFormSchema.safeParse({
      form,
      direction,
      quantity: parseNumberField(quantity),
      reason,
    })

    if (!parsed.success) {
      const nextErrors: StockAdjustFormErrors = {}

      for (const issue of parsed.error.issues) {
        const field = issue.path[0]

        if (typeof field === 'string' && !nextErrors[field as keyof StockAdjustFormErrors]) {
          nextErrors[field as keyof StockAdjustFormErrors] = issue.message
        }
      }

      setFieldErrors(nextErrors)
      return
    }

    onSubmit(parsed.data)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border bg-white p-6 shadow">
      <div>
        <h2 className="text-lg font-semibold">Ajuster le stock</h2>
        <p className="text-sm text-gray-600">Produit : {productName}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="stock-adjust-form" className="block text-sm font-medium text-gray-700">
            Forme
          </label>
          <select
            id="stock-adjust-form"
            name="form"
            value={form}
            onChange={(event) => setForm(event.target.value)}
            disabled={isSubmitting}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-60"
          >
            {forms.map((availableForm) => (
              <option key={availableForm} value={availableForm}>
                {availableForm}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-gray-500">
            Stock actuel : {currentQuantity} {form}
          </p>
          {fieldErrors.form && <p className="mt-1 text-sm text-red-600">{fieldErrors.form}</p>}
        </div>

        <div>
          <label
            htmlFor="stock-adjust-direction"
            className="block text-sm font-medium text-gray-700"
          >
            Type
          </label>
          <select
            id="stock-adjust-direction"
            name="direction"
            value={direction}
            onChange={(event) => setDirection(event.target.value as StockDirection)}
            disabled={isSubmitting}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-60"
          >
            <option value="IN">{STOCK_DIRECTION_LABELS.IN}</option>
            <option value="OUT">{STOCK_DIRECTION_LABELS.OUT}</option>
          </select>
          {fieldErrors.direction && (
            <p className="mt-1 text-sm text-red-600">{fieldErrors.direction}</p>
          )}
        </div>

        <div>
          <label
            htmlFor="stock-adjust-quantity"
            className="block text-sm font-medium text-gray-700"
          >
            Quantité
          </label>
          <input
            id="stock-adjust-quantity"
            name="quantity"
            type="number"
            inputMode="numeric"
            min={1}
            max={STOCK_QUANTITY_MAX}
            step={1}
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            disabled={isSubmitting}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-60"
          />
          {fieldErrors.quantity && (
            <p className="mt-1 text-sm text-red-600">{fieldErrors.quantity}</p>
          )}
        </div>
      </div>

      <div>
        <label htmlFor="stock-adjust-reason" className="block text-sm font-medium text-gray-700">
          Motif
        </label>
        <input
          id="stock-adjust-reason"
          name="reason"
          type="text"
          maxLength={STOCK_REASON_MAX_LENGTH}
          placeholder="Produit endommagé, écart d'inventaire…"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          disabled={isSubmitting}
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-60"
        />
        {fieldErrors.reason && <p className="mt-1 text-sm text-red-600">{fieldErrors.reason}</p>}
      </div>

      {formError && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{formError}</p>
      )}

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
      )}

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
          disabled={isSubmitting}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </form>
  )
}

export default StockAdjustForm