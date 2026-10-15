import { useState } from 'react'
import type { FormEvent } from 'react'
import type { StockFormInput, StockFormLevel } from '@/types'
import {
  parseNumberField,
  STOCK_MESSAGES,
  STOCK_QUANTITY_MAX,
  stockInitializeFormSchema,
} from './schemas/stock.schema'
import type { StockInitializeFormErrors } from './schemas/stock.schema'

interface StockInitializeBatchFormProps {
  /** Products that are not yet initialized, grouped by product. */
  targets: {
    productId: number
    productName: string
    forms: string[]
    levels: StockFormLevel[]
  }[]
  isSubmitting: boolean
  error: string | null
  onSubmit: (batches: { productId: number; quantities: StockFormInput[] }[]) => void
  onCancel: () => void
}

/**
 * Batch initialization form: allows initializing multiple products at once.
 */
function StockInitializeBatchForm({
  targets,
  isSubmitting,
  error,
  onSubmit,
  onCancel,
}: StockInitializeBatchFormProps) {
  // We'll store input values per product and form: values[productId][form] = string
  const [values, setValues] = useState<Record<number, Record<string, string>>>(
    () => {
      const init: Record<number, Record<string, string>> = {}
      for (const target of targets) {
        init[target.productId] = {}
        for (const form of target.forms) {
          init[target.productId][form] = ''
        }
      }
      return init
    }
  )
  
  // Track which products are selected for initialization
  const [selectedProductIds, setSelectedProductIds] = useState<number[]>([])
  
  const [formError, setFormError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<StockInitializeFormErrors>({})

  const handleChange = (productId: number, form: string, rawValue: string) => {
    setValues((current) => ({
      ...current,
      [productId]: {
        ...(current[productId] ?? {}),
        [form]: rawValue,
      },
    }))
  }

  const handleToggleSelection = (productId: number) => {
    setSelectedProductIds(prev => 
      prev.includes(productId)
        ? prev.filter(id => id !== productId)
        : [...prev, productId]
    )
  }

  const isProductSelected = (productId: number) => 
    selectedProductIds.includes(productId)

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFormError(null)
    setFieldErrors({})

    // Validate each selected product's quantities
    const batchInputs: { productId: number; quantities: StockFormInput[] }[] = []
    let hasError = false

    for (const target of targets) {
      // Skip validation for non-selected products
      if (!isProductSelected(target.productId)) {
        continue
      }

      const productId = target.productId
      const formQuantities: StockFormInput[] = []
      for (const form of target.forms) {
        const rawValue = values[productId]?.[form] ?? ''
        const quantity = parseNumberField(rawValue)
        formQuantities.push({ form, quantity: quantity ?? 0 }) // treat undefined as 0
      }

      // Validate using the schema for this product
      const parsed = stockInitializeFormSchema.safeParse({
        quantities: formQuantities,
      })
      if (!parsed.success) {
        const firstIssue = parsed.error.issues[0]
        if (firstIssue && firstIssue.path[0] === 'quantities') {
          const index = firstIssue.path[1]
          if (typeof index === 'number' && target.forms[index]) {
            setFieldErrors({
              quantities: `${target.productName} — ${target.forms[index]} : ${firstIssue.message}`,
            })
          } else {
            setFieldErrors({ quantities: `${target.productName} : ${firstIssue.message}` })
          }
        } else {
          setFieldErrors({ quantities: `${target.productName} : ${firstIssue.message ?? STOCK_MESSAGES.unexpected}` })
        }
        hasError = true
        break
      }

      batchInputs.push({
        productId,
        quantities: parsed.data.quantities,
      })
    }

    // Check if at least one product is selected
    if (selectedProductIds.length === 0) {
      setFieldErrors({ quantities: 'Veuillez sélectionner au moins un produit à initialiser.' })
      hasError = true
    }

    if (hasError) {
      return
    }

    onSubmit(batchInputs)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border bg-white p-6 shadow">
      <div>
        <h2 className="text-lg font-semibold">Initialisation groupée du stock</h2>
        <p className="text-sm text-gray-600">
          Sélectionnez les produits à initialiser et indiquez les quantités pour chaque forme.
        </p>
      </div>

      {/* Table of products */}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
           <thead className="bg-gray-50">
             <tr>
               <th scope="col" className="px-6 py-3 text-left text-sm font-semibold text-gray-700 w-20">
                 Sélectionner
               </th>
               <th scope="col" className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                 Produit
               </th>
               <th scope="col" className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                 Catégorie
               </th>
               <th scope="col" className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                 Forme(s)
               </th>
               <th scope="col" className="px-6 py-3 text-right text-sm font-semibold text-gray-700">
                 Quantité
               </th>
               <th scope="col" className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                 Actions
               </th>
             </tr>
           </thead>
           <tbody className="divide-y divide-gray-100">
              {targets.map((target) => (
                <tr key={target.productId} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-left text-sm font-medium text-gray-900">
                    <input
                      type="checkbox"
                      checked={isProductSelected(target.productId)}
                      onChange={() => handleToggleSelection(target.productId)}
                      className="rounded border-gray-300 text-indigo-600 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 focus:ring-2 focus:ring-offset-2"
                    />
                  </td>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">
                    {target.productName}
                  </td>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">
                    {target.levels[0]?.categoryName ?? ''}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    {target.forms.join(' / ')}
                    {target.levels
                      .filter((level) => level.isLegacyForm)
                      .map((level) => level.form)
                      .length > 0 && (
                      <span className="block text-xs text-gray-500">
                        dont {target.levels
                          .filter((level) => level.isLegacyForm)
                          .map((level) => level.form)
                          .join(', ')} : forme historique
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right text-sm font-medium text-gray-900 space-y-2">
                    {target.forms.map((form) => (
                      <div key={form} className="text-right">
                        <label
                          className="block text-xs text-gray-600 mb-1"
                        >
                          {form}
                        </label>
                        <input
                          id={`stock-batch-${target.productId}-${form}`}
                          type="text"
                          inputMode="decimal"
                          min={0}
                          max={STOCK_QUANTITY_MAX}
                          step={0.5}
                          placeholder="0"
                          value={values[target.productId]?.[form] ?? ''}
                          onChange={(event) =>
                            handleChange(target.productId, form, event.target.value)
                          }
                          disabled={isSubmitting}
                          className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-60"
                        />
                      </div>
                    ))}
                  </td>
                  <td className="px-6 py-4 text-left text-sm">
                    <button
                      type="button"
                      onClick={() => {
                        // Open individual initialization form for this product?
                        // Not required for batch, but we could.
                      }}
                      className="font-medium text-blue-600 hover:text-blue-800"
                    >
                      Détails
                    </button>
                  </td>
                </tr>
              ))}
           </tbody>
        </table>
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
          {isSubmitting ? 'Initialisation en cours…' : 'Initialiser la sélection'}
        </button>
      </div>
    </form>
  )
}

export default StockInitializeBatchForm