import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Category, Product, ProductInput } from '@/types'
import { categoryService, productService } from '@/services'
import ConfirmDialog from '../categories/ConfirmDialog'
import ProductForm from './ProductForm'
import { PRODUCT_MESSAGES } from './schemas/product.schema'

type StatusFilter = 'all' | 'active' | 'inactive'

const priceFormatter = new Intl.NumberFormat('fr-FR')

function formatPrice(value: number): string {
  return priceFormatter.format(value)
}

function formatConversion(product: Product): string | null {
  if (!product.isTransformable || !product.primaryForm || !product.secondaryForm) {
    return null
  }

  return `${product.primaryForm} → ${product.conversionQuantity} ${product.secondaryForm}`
}

function Products() {
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [categoriesError, setCategoriesError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [categorySearch, setCategorySearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editing, setEditing] = useState<Product | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [detail, setDetail] = useState<Product | null>(null)
  const [isDetailLoading, setIsDetailLoading] = useState(false)
  const [pendingStatusChange, setPendingStatusChange] = useState<{
    product: Product
    isActive: boolean
  } | null>(null)
  const [isChangingStatus, setIsChangingStatus] = useState(false)

  const loadCategories = useCallback(async () => {
    setCategoriesError(null)

    try {
      setCategories(await categoryService.list())
    } catch {
      setCategoriesError(PRODUCT_MESSAGES.unexpected)
    }
  }, [])

  useEffect(() => {
    loadCategories()
  }, [loadCategories])

  const loadProducts = useCallback(async () => {
    setIsLoading(true)
    setLoadError(null)

    try {
      setProducts(
        await productService.list({
          search: search.trim() || undefined,
          categorySearch: categorySearch.trim() || undefined,
          isActive: statusFilter === 'all' ? undefined : statusFilter === 'active',
        }),
      )
    } catch {
      setLoadError(PRODUCT_MESSAGES.unexpected)
    } finally {
      setIsLoading(false)
    }
  }, [search, categorySearch, statusFilter])

  useEffect(() => {
    const timer = setTimeout(loadProducts, 200)

    return () => clearTimeout(timer)
  }, [loadProducts])

  const hasCategories = categories.length > 0

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

  const openEditForm = (product: Product) => {
    setEditing(product)
    setFormError(null)
    setActionError(null)
    setIsFormOpen(true)
  }

  const handleSubmit = async (input: ProductInput) => {
    setIsSubmitting(true)
    setFormError(null)

    try {
      if (editing) {
        await productService.update(editing.id, input)
      } else {
        await productService.create(input)
      }

      closeForm()
      await loadProducts()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : PRODUCT_MESSAGES.unexpected)
    } finally {
      setIsSubmitting(false)
    }
  }

  const openDetail = async (product: Product) => {
    setActionError(null)
    setDetail(product)
    setIsDetailLoading(true)

    try {
      setDetail(await productService.get(product.id))
    } catch (error) {
      setActionError(error instanceof Error ? error.message : PRODUCT_MESSAGES.unexpected)
    } finally {
      setIsDetailLoading(false)
    }
  }

  const handleStatusChange = async () => {
    if (!pendingStatusChange) {
      return
    }

    const { product, isActive } = pendingStatusChange

    setIsChangingStatus(true)
    setActionError(null)

    try {
      await productService.setActive(product.id, isActive)
      setPendingStatusChange(null)
      setDetail((current) => (current && current.id === product.id ? null : current))
      await loadProducts()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : PRODUCT_MESSAGES.unexpected)
    } finally {
      setIsChangingStatus(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Produits</h1>
        <button
          type="button"
          onClick={openCreateForm}
          disabled={!hasCategories}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          + Nouveau
        </button>
      </div>

      {actionError && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{actionError}</p>
      )}

      {!hasCategories && !categoriesError && (
        <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <p className="font-medium">Aucune catégorie disponible.</p>
          <p>Créez d&apos;abord une catégorie avant de créer un produit.</p>
          <Link to="/categories" className="font-medium text-amber-900 underline">
            Gérer les catégories
          </Link>
        </div>
      )}

      {categoriesError && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
          {categoriesError}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="product-search" className="block text-sm font-medium text-gray-700">
            Rechercher
          </label>
          <input
            id="product-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Nom du produit"
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
          />
        </div>

        <div>
          <label htmlFor="product-category-search" className="block text-sm font-medium text-gray-700">
            Catégorie
          </label>
          <input
            id="product-category-search"
            type="search"
            value={categorySearch}
            onChange={(event) => setCategorySearch(event.target.value)}
            placeholder="Nom de la catégorie"
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
          />
        </div>

        <div>
          <label htmlFor="product-filter-status" className="block text-sm font-medium text-gray-700">
            Statut
          </label>
          <select
            id="product-filter-status"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
          >
            <option value="all">Tous</option>
            <option value="active">Actifs</option>
            <option value="inactive">Inactifs</option>
          </select>
        </div>
      </div>

      {isFormOpen && (
        <ProductForm
          key={editing ? editing.id : 'new'}
          title={editing ? 'Modifier le produit' : 'Nouveau produit'}
          submitLabel="Enregistrer"
          categories={categories}
          initialProduct={editing}
          isSubmitting={isSubmitting}
          error={formError}
          onSubmit={handleSubmit}
          onCancel={closeForm}
        />
      )}

      {detail && (
        <div className="rounded-lg border bg-white p-6 shadow">
          <div className="flex items-start justify-between gap-4">
            <h2 className="text-lg font-semibold">{detail.name}</h2>
            <button
              type="button"
              onClick={() => setDetail(null)}
              className="text-sm font-medium text-gray-500 hover:text-gray-700"
            >
              Fermer
            </button>
          </div>

          {isDetailLoading && (
            <p className="mt-2 text-sm text-gray-500">Chargement…</p>
          )}

          <dl className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-2">
            <div>
              <dt className="text-sm text-gray-500">Catégorie</dt>
              <dd className="text-sm font-medium text-gray-900">{detail.categoryName}</dd>
            </div>
            <div>
              <dt className="text-sm text-gray-500">Type</dt>
              <dd className="text-sm font-medium text-gray-900">
                {detail.isTransformable ? 'Transformable' : 'Simple'}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-gray-500">Prix d&apos;achat</dt>
              <dd className="text-sm font-medium text-gray-900">
                {formatPrice(detail.purchasePrice)} FCFA
              </dd>
            </div>
            <div>
              <dt className="text-sm text-gray-500">Prix de vente</dt>
              <dd className="text-sm font-medium text-gray-900">
                {formatPrice(detail.salePrice)} FCFA
              </dd>
            </div>
            {detail.isTransformable && (
              <>
                <div>
                  <dt className="text-sm text-gray-500">Conversion</dt>
                  <dd className="text-sm font-medium text-gray-900">
                    {formatConversion(detail) ?? '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-gray-500">
                    Prix de vente d&apos;un {detail.secondaryForm}
                  </dt>
                  <dd className="text-sm font-medium text-gray-900">
                    {detail.secondarySalePrice != null
                      ? `${formatPrice(detail.secondarySalePrice)} FCFA`
                      : '—'}
                  </dd>
                </div>
              </>
            )}
            <div>
              <dt className="text-sm text-gray-500">
                {detail.isTransformable ? 'Forme principale' : 'Forme'}
              </dt>
              <dd className="text-sm font-medium text-gray-900">
                {detail.primaryForm ?? '—'}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-gray-500">Statut</dt>
              <dd className="text-sm font-medium text-gray-900">
                {detail.isActive ? 'Actif' : 'Inactif'}
              </dd>
            </div>
          </dl>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border bg-white shadow">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                Nom
              </th>
              <th scope="col" className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                Catégorie
              </th>
              <th scope="col" className="px-6 py-3 text-right text-sm font-semibold text-gray-700">
                Achat
              </th>
              <th scope="col" className="px-6 py-3 text-right text-sm font-semibold text-gray-700">
                Vente
              </th>
              <th scope="col" className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                Type
              </th>
              <th scope="col" className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                Statut
              </th>
              <th scope="col" className="px-6 py-3 text-right text-sm font-semibold text-gray-700">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading && (
              <tr>
                <td colSpan={7} className="px-6 py-6 text-center text-sm text-gray-500">
                  Chargement…
                </td>
              </tr>
            )}

            {!isLoading && loadError && (
              <tr>
                <td colSpan={7} className="px-6 py-6 text-center text-sm text-red-600">
                  {loadError}
                </td>
              </tr>
            )}

            {!isLoading && !loadError && products.length === 0 && (
              <tr>
                <td colSpan={7} className="px-6 py-6 text-center text-sm text-gray-500">
                  Aucun produit pour le moment.
                </td>
              </tr>
            )}

            {!isLoading &&
              !loadError &&
              products.map((product) => {
                const conversion = formatConversion(product)

                return (
                  <tr key={product.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 text-sm font-medium text-gray-900">
                      {product.name}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">{product.categoryName}</td>
                    <td className="px-6 py-4 text-right text-sm text-gray-900">
                      {formatPrice(product.purchasePrice)}
                    </td>
                    <td className="px-6 py-4 text-right text-sm text-gray-900">
                      <span>{formatPrice(product.salePrice)}</span>
                      {product.isTransformable && product.secondarySalePrice != null && (
                        <span className="block text-xs text-gray-500">
                          {formatPrice(product.secondarySalePrice)} / {product.secondaryForm}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      <span className="block">
                        {product.isTransformable ? 'Transformable' : 'Simple'}
                      </span>
                      {conversion ? (
                        <span className="block text-xs font-medium text-blue-700">
                          {conversion}
                        </span>
                      ) : (
                        product.primaryForm && (
                          <span className="block text-xs text-gray-500">
                            {product.primaryForm}
                          </span>
                        )
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <span
                        className={
                          product.isActive
                            ? 'rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-700'
                            : 'rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600'
                        }
                      >
                        {product.isActive ? 'Actif' : 'Inactif'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right text-sm">
                      <div className="flex justify-end gap-3">
                        <button
                          type="button"
                          onClick={() => openDetail(product)}
                          className="font-medium text-gray-600 hover:text-gray-800"
                        >
                          Consulter
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditForm(product)}
                          className="font-medium text-blue-600 hover:text-blue-800"
                        >
                          Modifier
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setActionError(null)
                            setPendingStatusChange({ product, isActive: !product.isActive })
                          }}
                          className="font-medium text-red-600 hover:text-red-800"
                        >
                          {product.isActive ? 'Désactiver' : 'Réactiver'}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
          </tbody>
        </table>
      </div>

      {pendingStatusChange && (
        <ConfirmDialog
          title={pendingStatusChange.isActive ? 'Activer le produit ?' : 'Désactiver le produit ?'}
          message={
            pendingStatusChange.isActive
              ? `Le produit « ${pendingStatusChange.product.name} » sera de nouveau proposé dans les futurs modules.`
              : `Le produit « ${pendingStatusChange.product.name} » ne sera plus proposé dans les futurs modules.`
          }
          confirmLabel={pendingStatusChange.isActive ? 'Activer' : 'Désactiver'}
          confirmingLabel={pendingStatusChange.isActive ? 'Activation…' : 'Désactivation…'}
          isConfirming={isChangingStatus}
          onConfirm={handleStatusChange}
          onCancel={() => setPendingStatusChange(null)}
        />
      )}
    </div>
  )
}

export default Products
