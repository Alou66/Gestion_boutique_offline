import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { productService } from '@/services'
import type { Category, Product, ProductInput } from '@/types'
import {
  hasIdenticalForms,
  normalizeFormLabel,
  parseNumberField,
  PRODUCT_FORM_MAX_LENGTH,
  PRODUCT_MESSAGES,
  PRODUCT_NAME_MAX_LENGTH,
  PRODUCT_NAME_MIN_LENGTH,
  PRODUCT_PRICE_MAX,
  pluralizeFormLabel,
  productFormSchema,
  toProductInput,
} from './schemas/product.schema'
import type { ProductFormErrors } from './schemas/product.schema'

interface ProductFormProps {
  title: string
  submitLabel: string
  categories: Category[]
  initialProduct?: Product | null
  isSubmitting: boolean
  error: string | null
  onSubmit: (input: ProductInput) => void
  onCancel: () => void
}

const DEBOUNCE_MS = 400

// Server-side duplicate error message (from PRODUCT_ERRORS in electron/services/productService.ts)
const SERVER_DUPLICATE_NAME = 'Ce produit existe déjà.'

function ProductForm({
  title,
  submitLabel,
  categories,
  initialProduct = null,
  isSubmitting,
  error,
  onSubmit,
  onCancel,
}: ProductFormProps) {
  const [name, setName] = useState(initialProduct?.name ?? '')
  const [categoryId, setCategoryId] = useState(
    initialProduct ? String(initialProduct.categoryId) : '',
  )
  const [purchasePrice, setPurchasePrice] = useState(
    initialProduct ? String(initialProduct.purchasePrice) : '',
  )
  const [salePrice, setSalePrice] = useState(
    initialProduct ? String(initialProduct.salePrice) : '',
  )
  const [isTransformable, setIsTransformable] = useState(
    initialProduct?.isTransformable ?? false,
  )
  const [primaryForm, setPrimaryForm] = useState(initialProduct?.primaryForm ?? '')
  const [secondaryForm, setSecondaryForm] = useState(
    initialProduct?.secondaryForm ?? '',
  )
  const [conversionQuantity, setConversionQuantity] = useState(
    initialProduct?.conversionQuantity != null
      ? String(initialProduct.conversionQuantity)
      : '',
  )
  const [secondarySalePrice, setSecondarySalePrice] = useState(
    initialProduct?.secondarySalePrice != null
      ? String(initialProduct.secondarySalePrice)
      : '',
  )
  const [fieldErrors, setFieldErrors] = useState<ProductFormErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [nameAvailability, setNameAvailability] = useState<'idle' | 'checking' | 'available' | 'taken' | 'error'>('idle')

  const nameDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const checkNameAvailability = useCallback(async (value: string, excludeId?: number) => {
    if (!value || value.trim().length < PRODUCT_NAME_MIN_LENGTH) {
      setNameAvailability('idle')
      return
    }

    setNameAvailability('checking')

    try {
      const available = await productService.isNameAvailable(value.trim(), excludeId)
      setNameAvailability(available ? 'available' : 'taken')
    } catch {
      setNameAvailability('error')
    }
  }, [])

  const handleNameChange = (value: string) => {
    setName(value)
    setFieldErrors((prev) => ({ ...prev, name: undefined }))

    if (nameDebounceRef.current) {
      clearTimeout(nameDebounceRef.current)
    }

    nameDebounceRef.current = setTimeout(() => {
      checkNameAvailability(value, initialProduct?.id)
    }, DEBOUNCE_MS)
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFormError(null)

    const parsed = productFormSchema.safeParse({
      name,
      categoryId: parseNumberField(categoryId),
      purchasePrice: parseNumberField(purchasePrice),
      salePrice: parseNumberField(salePrice),
      isTransformable,
      primaryForm,
      secondaryForm,
      conversionQuantity: parseNumberField(conversionQuantity),
      secondarySalePrice: parseNumberField(secondarySalePrice),
    })

    if (!parsed.success) {
      const nextErrors: ProductFormErrors = {}

      for (const issue of parsed.error.issues) {
        const field = issue.path[0]

        if (typeof field === 'string' && !nextErrors[field as keyof ProductFormErrors]) {
          nextErrors[field as keyof ProductFormErrors] = issue.message
        }
      }

      setFieldErrors(nextErrors)
      return
    }

    if (
      parsed.data.isTransformable &&
      hasIdenticalForms(parsed.data.primaryForm, parsed.data.secondaryForm)
    ) {
      setFieldErrors({ secondaryForm: PRODUCT_MESSAGES.formsMustDiffer })
      return
    }

    // The check above is only a warning for the shopkeeper: the main process
    // still refuses the duplicate on its own.
    if (nameAvailability === 'taken') {
      setFieldErrors({ name: PRODUCT_MESSAGES.nameTaken })
      return
    }

    setFieldErrors({})
    onSubmit(toProductInput(parsed.data))
  }

  const handleToggleTransformable = () => {
    const nextValue = !isTransformable
    setIsTransformable(nextValue)

    // Switching to a simple product drops the transformation configuration, but
    // keeps the form: a simple product is counted in that single form.
    if (!nextValue) {
      setSecondaryForm('')
      setConversionQuantity('')
      setSecondarySalePrice('')
      setFieldErrors({})
    }
  }

  const displayedError = formError ?? (error !== SERVER_DUPLICATE_NAME ? error : null)
  const primaryFormLabel = primaryForm.trim() ? normalizeFormLabel(primaryForm) : ''
  const secondaryFormLabel = secondaryForm.trim() ? normalizeFormLabel(secondaryForm) : ''

  const nameStatusIcon = () => {
    switch (nameAvailability) {
      case 'checking':
        return <span className="text-blue-600">⟳</span>
      case 'available':
        return <span className="text-green-600">✓</span>
      case 'taken':
        return <span className="text-amber-600">⚠</span>
      case 'error':
        return <span className="text-gray-500">?</span>
      default:
        return null
    }
  }

  const nameStatusText = () => {
    switch (nameAvailability) {
      case 'checking':
        return <span className="text-blue-600">{PRODUCT_MESSAGES.checking}</span>
      case 'available':
        return <span className="text-green-600">{PRODUCT_MESSAGES.nameAvailable}</span>
      case 'taken':
        return <span className="text-amber-600">{PRODUCT_MESSAGES.nameTaken}</span>
      case 'error':
        return <span className="text-gray-500">{PRODUCT_MESSAGES.checkFailed}</span>
      default:
        return null
    }
  }

  const isSubmitDisabled =
    isSubmitting || nameAvailability === 'taken' || nameAvailability === 'checking'

  useEffect(() => {
    return () => {
      if (nameDebounceRef.current) clearTimeout(nameDebounceRef.current)
    }
  }, [])

  // Convert server-side duplicate errors to field errors
  useEffect(() => {
    if (error !== SERVER_DUPLICATE_NAME) return

    setNameAvailability('taken')
    setFieldErrors((prev) => ({ ...prev, name: PRODUCT_MESSAGES.nameTaken }))
  }, [error])

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-lg border bg-white p-6 shadow"
    >
      <h2 className="text-lg font-semibold">{title}</h2>

      <div>
        <label htmlFor="product-name" className="block text-sm font-medium text-gray-700">
          Nom
        </label>
        <div className="mt-1 flex items-center gap-2">
          <input
            id="product-name"
            name="name"
            type="text"
            maxLength={PRODUCT_NAME_MAX_LENGTH}
            value={name}
            onChange={(event) => handleNameChange(event.target.value)}
            style={{ textTransform: 'uppercase' }}
            disabled={isSubmitting}
            className="flex-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-60"
          />
          {nameStatusIcon()}
        </div>
        {nameStatusText() && <p className="mt-1 text-sm">{nameStatusText()}</p>}
        {fieldErrors.name && <p className="mt-1 text-sm text-red-600">{fieldErrors.name}</p>}
      </div>

      <div>
        <label
          htmlFor="product-category"
          className="block text-sm font-medium text-gray-700"
        >
          Catégorie
        </label>
        <select
          id="product-category"
          name="categoryId"
          value={categoryId}
          onChange={(event) => setCategoryId(event.target.value)}
          disabled={isSubmitting}
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-60"
        >
          <option value="">Choisir une catégorie</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
        {fieldErrors.categoryId && (
          <p className="mt-1 text-sm text-red-600">{fieldErrors.categoryId}</p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label
            htmlFor="product-purchase-price"
            className="block text-sm font-medium text-gray-700"
          >
            Prix d&apos;achat (FCFA)
          </label>
          <input
            id="product-purchase-price"
            name="purchasePrice"
            type="number"
            inputMode="numeric"
            min={0}
            max={PRODUCT_PRICE_MAX}
            step={1}
            value={purchasePrice}
            onChange={(event) => setPurchasePrice(event.target.value)}
            disabled={isSubmitting}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-60"
          />
          {fieldErrors.purchasePrice && (
            <p className="mt-1 text-sm text-red-600">{fieldErrors.purchasePrice}</p>
          )}
        </div>

        <div>
          <label
            htmlFor="product-sale-price"
            className="block text-sm font-medium text-gray-700"
          >
            Prix de vente (FCFA)
          </label>
          <input
            id="product-sale-price"
            name="salePrice"
            type="number"
            inputMode="numeric"
            min={0}
            max={PRODUCT_PRICE_MAX}
            step={1}
            value={salePrice}
            onChange={(event) => setSalePrice(event.target.value)}
            disabled={isSubmitting}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-60"
          />
          {fieldErrors.salePrice && (
            <p className="mt-1 text-sm text-red-600">{fieldErrors.salePrice}</p>
          )}
        </div>
      </div>

      <div>
        <label
          htmlFor="product-primary-form"
          className="block text-sm font-medium text-gray-700"
        >
          {isTransformable ? 'Forme principale' : 'Forme (unité de stock)'}
        </label>
        <input
          id="product-primary-form"
          name="primaryForm"
          type="text"
          maxLength={PRODUCT_FORM_MAX_LENGTH}
          placeholder={isTransformable ? 'CARTON' : 'SAC'}
          value={primaryForm}
          onChange={(event) => setPrimaryForm(event.target.value)}
          disabled={isSubmitting}
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-60"
        />
        {fieldErrors.primaryForm && (
          <p className="mt-1 text-sm text-red-600">{fieldErrors.primaryForm}</p>
        )}
      </div>

      <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
        <input
          type="checkbox"
          name="isTransformable"
          checked={isTransformable}
          onChange={handleToggleTransformable}
          disabled={isSubmitting}
          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
        Produit transformable ?
      </label>

      {isTransformable && (
        <div className="space-y-4 rounded-md border border-blue-100 bg-blue-50/50 p-4">
          <div>
            <label
              htmlFor="product-secondary-form"
              className="block text-sm font-medium text-gray-700"
            >
              Forme secondaire
            </label>
            <input
              id="product-secondary-form"
              name="secondaryForm"
              type="text"
              maxLength={PRODUCT_FORM_MAX_LENGTH}
              placeholder="SEAU"
              value={secondaryForm}
              onChange={(event) => setSecondaryForm(event.target.value)}
              disabled={isSubmitting}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-60"
            />
            {fieldErrors.secondaryForm && (
              <p className="mt-1 text-sm text-red-600">{fieldErrors.secondaryForm}</p>
            )}
          </div>

          <div>
            <label
              htmlFor="product-conversion-quantity"
              className="block text-sm font-medium text-gray-700"
            >
              {primaryFormLabel && secondaryFormLabel
                ? `1 ${primaryFormLabel} donne combien de ${pluralizeFormLabel(secondaryFormLabel)} ?`
                : '1 forme principale donne combien de formes secondaires ?'}
            </label>
            <input
              id="product-conversion-quantity"
              name="conversionQuantity"
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={conversionQuantity}
              onChange={(event) => setConversionQuantity(event.target.value)}
              disabled={isSubmitting}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-60"
            />
            {fieldErrors.conversionQuantity && (
              <p className="mt-1 text-sm text-red-600">{fieldErrors.conversionQuantity}</p>
            )}
          </div>

          <div>
            <label
              htmlFor="product-secondary-sale-price"
              className="block text-sm font-medium text-gray-700"
            >
              {secondaryFormLabel
                ? `Prix de vente d'un ${secondaryFormLabel} (FCFA)`
                : 'Prix de vente secondaire (FCFA)'}
            </label>
            <input
              id="product-secondary-sale-price"
              name="secondarySalePrice"
              type="number"
              inputMode="numeric"
              min={0}
              max={PRODUCT_PRICE_MAX}
              step={1}
              value={secondarySalePrice}
              onChange={(event) => setSecondarySalePrice(event.target.value)}
              disabled={isSubmitting}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-60"
            />
            {fieldErrors.secondarySalePrice && (
              <p className="mt-1 text-sm text-red-600">{fieldErrors.secondarySalePrice}</p>
            )}
          </div>
        </div>
      )}

      {displayedError && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{displayedError}</p>
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
          disabled={isSubmitDisabled}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? 'Enregistrement…' : submitLabel}
        </button>
      </div>
    </form>
  )
}

export default ProductForm
