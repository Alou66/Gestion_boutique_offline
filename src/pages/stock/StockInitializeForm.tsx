import { useState } from 'react'
import type { FormEvent } from 'react'
import type { StockFormInput } from '@/types'
import {
  parseNumberField,
  STOCK_MESSAGES,
  STOCK_QUANTITY_MAX,
  stockInitializeFormSchema,
} from './schemas/stock.schema'
import type { StockInitializeFormErrors } from './schemas/stock.schema'

interface StockInitializeFormProps {
  productName: string
  /** Authorized forms of the product, in display order (1 or 2). */
  forms: string[]
  isSubmitting: boolean
  error: string | null
  onSubmit: (quantities: StockFormInput[]) => void
  onCancel: () => void
}

/**
 * One shot initialization form: the shopkeeper types the quantities physically
 * available for each authorized form. A form can stay at 0, but the whole form
 * cannot be empty (at least one strictly positive quantity).
 */
function StockInitializeForm({
  productName,
  forms,
  isSubmitting,
  error,
  onSubmit,
  onCancel,
}: StockInitializeFormProps) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    forms.reduce<Record<string, string>>((acc, form) => ({ ...acc, [form]: '' }), {}),
  )
  const [formError, setFormError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<StockInitializeFormErrors>({})

  const handleChange = (form: string, rawValue: string) => {
    setValues((current) => ({ ...current, [form]: rawValue }))
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFormError(null)
    setFieldErrors({})

    const parsed = stockInitializeFormSchema.safeParse({
      quantities: forms.map((form) => ({
        form,
        quantity: parseNumberField(values[form] ?? ''),
      })),
    })

    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0]

      if (firstIssue && firstIssue.path[0] === 'quantities') {
        const index = firstIssue.path[1]

        if (typeof index === 'number' && forms[index]) {
          setFieldErrors({ quantities: `${forms[index]} : ${firstIssue.message}` })
          return
        }
      }

      setFormError(firstIssue?.message ?? STOCK_MESSAGES.unexpected)
      return
    }

    onSubmit(parsed.data.quantities)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border bg-white p-6 shadow">
      <div>
        <h2 className="text-lg font-semibold">Initialiser le stock</h2>
        <p className="text-sm text-gray-600">Produit : {productName}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {forms.map((form) => (
          <div key={form}>
            <label
              htmlFor={`stock-initial-${form}`}
              className="block text-sm font-medium text-gray-700"
            >
              {form}
            </label>
            <input
              id={`stock-initial-${form}`}
              name={form}
              type="number"
              inputMode="numeric"
              min={0}
              max={STOCK_QUANTITY_MAX}
              step={1}
              placeholder="0"
              value={values[form] ?? ''}
              onChange={(event) => handleChange(form, event.target.value)}
              disabled={isSubmitting}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-60"
            />
          </div>
        ))}
      </div>

      {fieldErrors.quantities && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
          {fieldErrors.quantities}
        </p>
      )}

      {formError && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{formError}</p>
      )}

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
      )}

      <p className="text-xs text-gray-500">
        L&apos;initialisation est définitive : pour corriger une quantité, il faudra
        enregistrer un ajustement.
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
          disabled={isSubmitting}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? 'Initialisation…' : 'Initialiser'}
        </button>
      </div>
    </form>
  )
}

export default StockInitializeForm