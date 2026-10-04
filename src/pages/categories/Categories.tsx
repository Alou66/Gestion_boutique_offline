import { useCallback, useEffect, useState } from 'react'
import { categoryService } from '@/services'
import type { Category } from '@/types'
import CategoryForm from './CategoryForm'
import ConfirmDialog from './ConfirmDialog'
import { CATEGORY_MESSAGES } from './schemas/category.schema'
import type { CategoryFormData } from './schemas/category.schema'

function Categories() {
  const [categories, setCategories] = useState<Category[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editing, setEditing] = useState<Category | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<Category | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const loadCategories = useCallback(async () => {
    setIsLoading(true)
    setLoadError(null)

    try {
      setCategories(await categoryService.list())
    } catch {
      setLoadError(CATEGORY_MESSAGES.unexpected)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadCategories()
  }, [loadCategories])

  const closeForm = () => {
    setIsFormOpen(false)
    setEditing(null)
    setFormError(null)
  }

  const openCreateForm = () => {
    setEditing(null)
    setFormError(null)
    setActionError(null)
    setIsFormOpen(true)
  }

  const openEditForm = (category: Category) => {
    setEditing(category)
    setFormError(null)
    setActionError(null)
    setIsFormOpen(true)
  }

  const handleSubmit = async ({ name }: CategoryFormData) => {
    setIsSubmitting(true)
    setFormError(null)

    try {
      if (editing) {
        await categoryService.update(editing.id, { name })
      } else {
        await categoryService.create({ name })
      }

      closeForm()
      await loadCategories()
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : CATEGORY_MESSAGES.unexpected,
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (!pendingDelete) {
      return
    }

    setIsDeleting(true)
    setActionError(null)

    try {
      await categoryService.delete(pendingDelete.id)
      setCategories((current) => current.filter((item) => item.id !== pendingDelete.id))
      setPendingDelete(null)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : CATEGORY_MESSAGES.unexpected)
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Catégories</h1>
        <button
          type="button"
          onClick={openCreateForm}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          + Ajouter
        </button>
      </div>

      {actionError && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{actionError}</p>
      )}

      {isFormOpen && (
        <CategoryForm
          key={editing ? editing.id : 'new'}
          title={editing ? 'Modifier la catégorie' : 'Nouvelle catégorie'}
          submitLabel="Enregistrer"
          initialName={editing?.name ?? ''}
          isSubmitting={isSubmitting}
          error={formError}
          onSubmit={handleSubmit}
          onCancel={closeForm}
        />
      )}

      <div className="overflow-hidden rounded-lg border bg-white shadow">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                Nom
              </th>
              <th scope="col" className="px-6 py-3 text-right text-sm font-semibold text-gray-700">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading && (
              <tr>
                <td colSpan={2} className="px-6 py-6 text-center text-sm text-gray-500">
                  Chargement…
                </td>
              </tr>
            )}

            {!isLoading && loadError && (
              <tr>
                <td colSpan={2} className="px-6 py-6 text-center text-sm text-red-600">
                  {loadError}
                </td>
              </tr>
            )}

            {!isLoading && !loadError && categories.length === 0 && (
              <tr>
                <td colSpan={2} className="px-6 py-6 text-center text-sm text-gray-500">
                  Aucune catégorie pour le moment.
                </td>
              </tr>
            )}

            {!isLoading &&
              !loadError &&
              categories.map((category) => (
                <tr key={category.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">
                    {category.name}
                  </td>
                  <td className="px-6 py-4 text-right text-sm">
                    <div className="flex justify-end gap-3">
                      <button
                        type="button"
                        onClick={() => openEditForm(category)}
                        className="font-medium text-blue-600 hover:text-blue-800"
                      >
                        Modifier
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setActionError(null)
                          setPendingDelete(category)
                        }}
                        className="font-medium text-red-600 hover:text-red-800"
                      >
                        Supprimer
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {pendingDelete && (
        <ConfirmDialog
          title="Supprimer la catégorie ?"
          message={`Êtes-vous sûr de vouloir supprimer la catégorie « ${pendingDelete.name} » ?`}
          confirmLabel="Supprimer"
          isConfirming={isDeleting}
          onConfirm={handleDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  )
}

export default Categories
