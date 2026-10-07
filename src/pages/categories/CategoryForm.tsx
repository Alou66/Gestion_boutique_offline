import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { categoryService } from '@/services'
import type { Category } from '@/types'
import {
  CATEGORY_MESSAGES,
  CATEGORY_NAME_MAX_LENGTH,
  CATEGORY_NAME_MIN_LENGTH,
  categorySchema,
} from './schemas/category.schema'
import type { CategoryFormData } from './schemas/category.schema'

interface CategoryFormProps {
  title: string
  submitLabel: string
  initialCategory?: Category | null
  isSubmitting: boolean
  error: string | null
  onSubmit: (values: CategoryFormData) => void
  onCancel: () => void
}

const DEBOUNCE_MS = 400

// Server-side duplicate error message (from CATEGORY_ERRORS in electron/services/categoryService.ts)
const SERVER_DUPLICATE_NAME = 'Cette catégorie existe déjà.'

function CategoryForm({
  title,
  submitLabel,
  initialCategory = null,
  isSubmitting,
  error,
  onSubmit,
  onCancel,
}: CategoryFormProps) {
  const [name, setName] = useState(initialCategory?.name ?? '')
  const [validationError, setValidationError] = useState<string | null>(null)
  const [nameAvailability, setNameAvailability] = useState<'idle' | 'checking' | 'available' | 'taken' | 'error'>('idle')

  const nameDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const checkNameAvailability = useCallback(async (value: string, excludeId?: number) => {
    if (!value || value.trim().length < CATEGORY_NAME_MIN_LENGTH) {
      setNameAvailability('idle')
      return
    }

    setNameAvailability('checking')

    try {
      const available = await categoryService.isNameAvailable(value.trim(), excludeId)
      setNameAvailability(available ? 'available' : 'taken')
    } catch {
      setNameAvailability('error')
    }
  }, [])

  const handleNameChange = (value: string) => {
    setName(value)
    setValidationError(null)

    if (nameDebounceRef.current) {
      clearTimeout(nameDebounceRef.current)
    }

    nameDebounceRef.current = setTimeout(() => {
      checkNameAvailability(value, initialCategory?.id)
    }, DEBOUNCE_MS)
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const parsed = categorySchema.safeParse({ name })

    if (!parsed.success) {
      setValidationError(parsed.error.issues[0]?.message ?? CATEGORY_MESSAGES.nameRequired)
      return
    }

    // The check above is only a warning for the shopkeeper: the main process
    // still refuses the duplicate on its own.
    if (nameAvailability === 'taken') {
      setValidationError(CATEGORY_MESSAGES.nameTaken)
      return
    }

    setValidationError(null)
    onSubmit(parsed.data)
  }

  const displayedError = error !== SERVER_DUPLICATE_NAME ? error : null

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
        return <span className="text-blue-600">{CATEGORY_MESSAGES.checking}</span>
      case 'available':
        return <span className="text-green-600">{CATEGORY_MESSAGES.nameAvailable}</span>
      case 'taken':
        return <span className="text-amber-600">{CATEGORY_MESSAGES.nameTaken}</span>
      case 'error':
        return <span className="text-gray-500">{CATEGORY_MESSAGES.checkFailed}</span>
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
    setValidationError(CATEGORY_MESSAGES.nameTaken)
  }, [error])

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-lg border bg-white p-6 shadow"
    >
      <h2 className="text-lg font-semibold">{title}</h2>

      <div>
        <label htmlFor="category-name" className="block text-sm font-medium text-gray-700">
          Nom
        </label>
        <div className="mt-1 flex items-center gap-2">
          <input
            id="category-name"
            name="name"
            type="text"
            maxLength={CATEGORY_NAME_MAX_LENGTH}
            value={name}
            onChange={(event) => handleNameChange(event.target.value)}
            style={{ textTransform: 'uppercase' }}
            disabled={isSubmitting}
            className="flex-1 block w-full rounded-md border border-gray-500 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-60"
          />
          {nameStatusIcon()}
        </div>
        {nameStatusText() && (
          <p className="mt-1 text-sm">{nameStatusText()}</p>
        )}
        {validationError && <p className="mt-1 text-sm text-red-600">{validationError}</p>}
      </div>

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

export default CategoryForm
