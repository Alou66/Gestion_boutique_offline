import { useState } from 'react'
import type { FormEvent } from 'react'
import {
  CATEGORY_MESSAGES,
  categorySchema,
  CATEGORY_NAME_MAX_LENGTH,
} from './schemas/category.schema'
import type { CategoryFormData } from './schemas/category.schema'

interface CategoryFormProps {
  title: string
  submitLabel: string
  initialName?: string
  isSubmitting: boolean
  error: string | null
  onSubmit: (values: CategoryFormData) => void
  onCancel: () => void
}

function CategoryForm({
  title,
  submitLabel,
  initialName = '',
  isSubmitting,
  error,
  onSubmit,
  onCancel,
}: CategoryFormProps) {
  const [name, setName] = useState(initialName)
  const [validationError, setValidationError] = useState<string | null>(null)

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const parsed = categorySchema.safeParse({ name })

    if (!parsed.success) {
      setValidationError(parsed.error.issues[0]?.message ?? CATEGORY_MESSAGES.nameRequired)
      return
    }

    setValidationError(null)
    onSubmit(parsed.data)
  }

  const displayedError = validationError ?? error

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
        <input
          id="category-name"
          name="name"
          type="text"
          maxLength={CATEGORY_NAME_MAX_LENGTH}
          value={name}
          onChange={(event) => setName(event.target.value)}
          style={{ textTransform: 'uppercase' }}
          disabled={isSubmitting}
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-60"
        />
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
          disabled={isSubmitting}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? 'Enregistrement…' : submitLabel}
        </button>
      </div>
    </form>
  )
}

export default CategoryForm
