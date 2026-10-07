import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import type {
  Client,
  Product,
  SaleCreateInput,
  SaleDetail,
  StockFormLevel,
} from '@/types'
import { SearchableSelect } from '@/components'
import type { SearchableSelectOption } from '@/components'
import type { InvoiceDraft } from './invoice-draft'
import {
  buildAvailableStock,
  CASH_CLIENT_VALUE,
  computeLineTotal,
  createEmptyDraft,
  formatAmount,
  getConfiguredSalePrice,
  getProductForms,
  getLineKey,
  INVOICE_ITEMS_MAX,
  INVOICE_MESSAGES,
  INVOICE_QUANTITY_MAX,
  INVOICE_UNIT_PRICE_MAX,
  invoiceFormSchema,
  invoiceItemFormSchema,
  isSameLine,
  parseNumberField,
  resolveClientSelection,
  readAvailableStock,
  readDraftLineTotal,
  sumLineTotals,
  todayInputValue,
  toDraft,
  toInvoiceInput,
  toLineDrafts,
  validateDraftLine,
} from './schemas/invoice.schema'
import type {
  InvoiceFormErrors,
  InvoiceItemDraft,
  InvoiceItemDraftErrors,
  InvoiceLineDraft,
} from './schemas/invoice.schema'

interface InvoiceFormProps {
  mode: 'create' | 'edit'
  /** Facture modifiée : elle fournit le client, la date et les lignes. */
  invoice?: SaleDetail | null
  /**
   * Brouillon d'une facture en création : la saisie reprend là où le
   * commerçant l'a quittée, même après un détour par les produits.
   * La modification n'en a pas : elle part toujours de la facture.
   */
  draft?: InvoiceDraft | null
  clients: Client[]
  products: Product[]
  stockLevels: StockFormLevel[]
  isSubmitting: boolean
  error: string | null
  /** Le contenu validé est transmis : rien n'est écrit avant la confirmation. */
  onSubmit: (input: SaleCreateInput) => void
  /** Le contenu saisi est mémorisé pour retrouver la facture en cours. */
  onDraftChange?: (draft: InvoiceDraft) => void
  onCancel: () => void
}

interface LinesTableProps {
  lines: InvoiceLineDraft[]
  productNames: Map<number, string>
  editingKey: string | null
  isDisabled: boolean
  onEdit: (line: InvoiceLineDraft) => void
  onRemove: (key: string) => void
}

/** Les lignes déjà ajoutées : un clic recharge la ligne dans les champs. */
function LinesTable({
  lines,
  productNames,
  editingKey,
  isDisabled,
  onEdit,
  onRemove,
}: LinesTableProps) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th scope="col" className="px-4 py-2 text-left text-xs font-semibold text-gray-700">
              Produit
            </th>
            <th scope="col" className="px-4 py-2 text-left text-xs font-semibold text-gray-700">
              Forme
            </th>
            <th
              scope="col"
              className="px-4 py-2 text-right text-xs font-semibold text-gray-700"
            >
              Quantité
            </th>
            <th
              scope="col"
              className="px-4 py-2 text-right text-xs font-semibold text-gray-700"
            >
              Prix unitaire
            </th>
            <th
              scope="col"
              className="px-4 py-2 text-right text-xs font-semibold text-gray-700"
            >
              Total
            </th>
            <th
              scope="col"
              className="px-4 py-2 text-right text-xs font-semibold text-gray-700"
            >
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {lines.map((line) => (
            <tr
              key={line.key}
              onClick={() => onEdit(line)}
              title="Cliquer pour modifier cette ligne"
              className={`cursor-pointer hover:bg-gray-50 ${
                editingKey === line.key ? 'bg-blue-50' : ''
              }`}
            >
              <td className="px-4 py-2 text-sm font-medium text-gray-900">
                {productNames.get(line.productId) ?? `#${line.productId}`}
              </td>
              <td className="px-4 py-2 text-sm text-gray-600">{line.form}</td>
              <td className="px-4 py-2 text-right text-sm text-gray-600">{line.quantity}</td>
              <td className="px-4 py-2 text-right text-sm text-gray-600">
                {formatAmount(line.unitPrice)}
              </td>
              <td className="px-4 py-2 text-right text-sm font-medium text-gray-900">
                {formatAmount(line.lineTotal)}
              </td>
              <td className="px-4 py-2 text-right text-sm">
                <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      onEdit(line)
                    }}
                    disabled={isDisabled}
                    className="font-medium text-blue-600 hover:text-blue-800 disabled:opacity-60"
                  >
                    Modifier
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      onRemove(line.key)
                    }}
                    disabled={isDisabled}
                    title="Supprimer cette ligne"
                    className="font-medium text-red-600 hover:text-red-800 disabled:opacity-60"
                  >
                    × suppr
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Formulaire d'une facture, partagé par la création et la modification.
 *
 * Le commerçant choisit un client actif, ajoute autant de lignes qu'il veut
 * (produit, forme, quantité, prix unitaire), puis enregistre. Le prix configuré
 * du produit est proposé pour la forme choisie et reste modifiable : c'est le
 * prix facturé qui part vers le service, qui le conserve comme instantané
 * historique et recalcule seul le total et le stock.
 */
function InvoiceForm({
  mode,
  invoice = null,
  draft = null,
  clients,
  products,
  stockLevels,
  isSubmitting,
  error,
  onSubmit,
  onDraftChange,
  onCancel,
}: InvoiceFormProps) {
  const systemClient = clients.find((client) => client.isSystem) ?? null
  const [date, setDate] = useState(
    draft
      ? draft.date
      : invoice
        ? todayInputValue(invoice.saleDate)
        : todayInputValue(),
  )
  const [clientId, setClientId] = useState(
    draft
      ? draft.clientId
      : invoice
        ? String(invoice.clientId)
        : systemClient
          ? String(systemClient.id)
          : CASH_CLIENT_VALUE,
  )
  const [lines, setLines] = useState<InvoiceLineDraft[]>(
    draft ? draft.lines : invoice ? toLineDrafts(invoice.items) : [],
  )
  const [editor, setEditor] = useState<InvoiceItemDraft>(
    draft ? draft.editor : createEmptyDraft(),
  )
  const [editingKey, setEditingKey] = useState<string | null>(
    draft ? draft.editingKey : null,
  )
  const [formError, setFormError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<InvoiceFormErrors>({})
  const [draftErrors, setDraftErrors] = useState<InvoiceItemDraftErrors>({})

  /**
   * Le contenu saisi est mémorisé à chaque changement : quitter la
   * page pour voir les produits ou les clients ne perd plus la
   * facture en cours. En modification il n'y a pas de brouillon.
   */
  useEffect(() => {
    onDraftChange?.({ date, clientId, lines, editor, editingKey })
  }, [date, clientId, lines, editor, editingKey, onDraftChange])

  const productsById = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products],
  )

  const productNames = useMemo(
    () => new Map(products.map((product) => [product.id, product.name])),
    [products],
  )

  /**
   * Options du champ client : le client comptant n'apparaît que
   * quand le client système du service n'existe pas encore, et
   * le téléphone ou l'inactivité servent d'indice de recherche.
   */
  const clientOptions = useMemo<SearchableSelectOption[]>(() => {
    const options: SearchableSelectOption[] = []

    if (!systemClient) {
      options.push({ value: CASH_CLIENT_VALUE, label: 'CLIENT COMPTANT' })
    }

    for (const client of clients) {
      const hints = [
        client.isSystem || !client.phone ? '' : client.phone,
        client.isActive ? '' : 'inactif',
      ].filter((hint) => hint !== '')

      options.push({
        value: String(client.id),
        label: client.name,
        hint: hints.length > 0 ? hints.join(' — ') : undefined,
      })
    }

    return options
  }, [clients, systemClient])

  /** Options du champ produit : la catégorie sert d'indice de recherche. */
  const productOptions = useMemo<SearchableSelectOption[]>(
    () =>
      products.map((product) => ({
        value: String(product.id),
        label: product.name,
        hint: product.categoryName || undefined,
      })),
    [products],
  )

  /**
   * Le stock disponible inclut la quantité déjà portée par la facture modifiée :
   * c'est exactement ce que le service considère à la validation.
   */
  const availableStock = useMemo(
    () => buildAvailableStock(stockLevels, invoice),
    [stockLevels, invoice],
  )

  const editorProduct = productsById.get(Number(editor.productId)) ?? null
  const editorForms = getProductForms(editorProduct)
  const isEditing = editingKey !== null
  const isListFull = !isEditing && lines.length >= INVOICE_ITEMS_MAX
  const editorAvailableStock = editorProduct
    ? readAvailableStock(availableStock, editorProduct.id, editor.form)
    : 0
  const configuredPrice = getConfiguredSalePrice(editorProduct, editor.form)
  const totalAmount = sumLineTotals(lines)

  const resetEditor = () => {
    setEditor(createEmptyDraft())
    setEditingKey(null)
    setDraftErrors({})
  }

  const updateEditor = (patch: Partial<InvoiceItemDraft>) => {
    setDraftErrors({})
    setEditor((current) => ({ ...current, ...patch }))
  }

  /**
   * Les formes viennent toujours du produit choisi et le prix proposé est celui
   * configuré pour la forme retenue. Un produit simple n'affiche qu'une seule
   * forme : aucune conversion automatique n'est proposée.
   */
  const handleProductChange = (rawProductId: string) => {
    const product = productsById.get(Number(rawProductId)) ?? null
    const forms = getProductForms(product)
    const form = forms[0] ?? ''
    const price = getConfiguredSalePrice(product, form)

    setDraftErrors({})
    setEditor((current) => ({
      ...current,
      productId: rawProductId,
      form,
      quantity: '',
      unitPrice: price === null ? '' : String(price),
    }))
  }

  const handleFormChange = (form: string) => {
    const price = getConfiguredSalePrice(editorProduct, form)

    updateEditor({ form, unitPrice: price === null ? editor.unitPrice : String(price) })
  }

  const handleEditLine = (line: InvoiceLineDraft) => {
    setFormError(null)
    setDraftErrors({})
    setEditor(toDraft(line))
    setEditingKey(line.key)
  }

  const handleRemoveLine = (key: string) => {
    setFieldErrors((current) => ({ ...current, items: undefined }))

    if (editingKey === key) {
      resetEditor()
    }

    setLines((current) => current.filter((line) => line.key !== key))
  }

  /** Validation de l'éditeur, alignée sur les règles du service métier. */
  const parseEditor = () => {
    const parsed = invoiceItemFormSchema.safeParse({
      productId: parseNumberField(editor.productId),
      form: editor.form,
      quantity: parseNumberField(editor.quantity),
      unitPrice: parseNumberField(editor.unitPrice),
    })

    if (!parsed.success) {
      const nextErrors: InvoiceItemDraftErrors = {}

      for (const issue of parsed.error.issues) {
        const field = issue.path[0]

        if (typeof field === 'string' && !nextErrors[field as keyof InvoiceItemDraftErrors]) {
          nextErrors[field as keyof InvoiceItemDraftErrors] = issue.message
        }
      }

      setDraftErrors(nextErrors)

      return null
    }

    const issue = validateDraftLine(
      parsed.data.productId,
      parsed.data.form,
      parsed.data.quantity,
      products,
      availableStock,
    )

    if (issue) {
      setDraftErrors({ productId: issue })

      return null
    }

    return parsed.data
  }

  /** « + Ajouter » (ou « Mettre à jour ») : l'éditeur devient une ligne. */
  const handleCommitLine = () => {
    setFormError(null)

    const parsed = parseEditor()

    if (!parsed) {
      return
    }

    const identity = getLineKey(parsed.productId, parsed.form)
    const conflict = lines.find(
      (line) => line.key !== editor.key && getLineKey(line.productId, line.form) === identity,
    )

    if (conflict) {
      setDraftErrors({ productId: INVOICE_MESSAGES.duplicateLine })

      return
    }

    const line: InvoiceLineDraft = {
      key: editor.key,
      productId: parsed.productId,
      form: parsed.form,
      quantity: parsed.quantity,
      unitPrice: parsed.unitPrice,
      lineTotal: computeLineTotal(parsed.quantity, parsed.unitPrice),
    }

    setLines((current) =>
      editingKey === null
        ? [...current, line]
        : current.map((candidate) => (candidate.key === editingKey ? line : candidate)),
    )

    resetEditor()
  }

  /** Vrai quand l'éditeur tient une ligne qui n'est pas encore dans la facture. */
  const hasUncommittedLine = isEditing
    ? !lines.some((line) => isSameLine(editor, line))
    : editor.productId.trim() !== ''

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFormError(null)
    setFieldErrors({})

    // Une ligne encore saisie dans l'éditeur serait perdue silencieusement.
    if (hasUncommittedLine) {
      setFormError(INVOICE_MESSAGES.lineNotCommitted)

      return
    }

    const selection = resolveClientSelection(clientId, clients)

    if (!selection.ok) {
      setFieldErrors({ clientId: selection.error })

      return
    }

    const parsed = invoiceFormSchema.safeParse({
      date,
      clientId: selection.clientId,
      items: lines.map((line) => ({
        productId: line.productId,
        form: line.form,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
      })),
    })

    if (!parsed.success) {
      const nextErrors: InvoiceFormErrors = {}

      for (const issue of parsed.error.issues) {
        const field = issue.path[0]

        if (typeof field === 'string' && !nextErrors[field as keyof InvoiceFormErrors]) {
          nextErrors[field as keyof InvoiceFormErrors] = issue.message
        }
      }

      setFieldErrors(nextErrors)

      return
    }

    onSubmit(toInvoiceInput(parsed.data))
  }

  const submitLabel = isSubmitting
    ? mode === 'edit'
      ? 'Modification…'
      : 'Création…'
    : mode === 'edit'
      ? 'Enregistrer les modifications'
      : 'Créer la facture'

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border bg-white p-6 shadow">
      <h2 className="text-lg font-semibold">
        {mode === 'edit' ? 'Modifier la facture' : 'Nouvelle facture'}
      </h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="invoice-date" className="block text-sm font-medium text-gray-700">
            Date de la facture
          </label>
          <input
            id="invoice-date"
            name="date"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            disabled={isSubmitting}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-60"
          />
          {fieldErrors.date && <p className="mt-1 text-sm text-red-600">{fieldErrors.date}</p>}
        </div>

        <div>
          <label htmlFor="invoice-client" className="block text-sm font-medium text-gray-700">
            Client
          </label>
          <SearchableSelect
            id="invoice-client"
            name="clientId"
            value={clientId}
            options={clientOptions}
            placeholder="Choisir un client"
            disabled={isSubmitting}
            onChange={(value) => {
              setFieldErrors((current) => ({ ...current, clientId: undefined }))
              setClientId(value)
            }}
          />
          {fieldErrors.clientId && (
            <p className="mt-1 text-sm text-red-600">{fieldErrors.clientId}</p>
          )}
          <p className="mt-1 text-xs text-gray-500">
            Seul un client actif peut être choisi. Sans client, la facture est enregistrée
            pour CLIENT COMPTANT.
          </p>
        </div>
      </div>

      <div className="space-y-3 rounded-md border border-dashed border-gray-300 p-3">
        {isEditing && (
          <p className="text-xs font-medium text-blue-700">
            Modification d&apos;une ligne : « Mettre à jour » remplace la ligne sélectionnée.
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-6 sm:items-end">
          <div className="sm:col-span-2">
            <label htmlFor="invoice-product" className="block text-sm font-medium text-gray-700">
              Produit
            </label>
            <SearchableSelect
              id="invoice-product"
              name="productId"
              value={editor.productId}
              options={productOptions}
              placeholder="Choisir un produit"
              disabled={isSubmitting}
              onChange={handleProductChange}
            />
            {draftErrors.productId && (
              <p className="mt-1 text-sm text-red-600">{draftErrors.productId}</p>
            )}
          </div>

          <div>
            <label htmlFor="invoice-form" className="block text-sm font-medium text-gray-700">
              Forme
            </label>
            {editorForms.length > 1 ? (
              <select
                id="invoice-form"
                name="form"
                value={editor.form}
                onChange={(event) => handleFormChange(event.target.value)}
                disabled={isSubmitting}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-60"
              >
                {editorForms.map((availableForm) => (
                  <option key={availableForm} value={availableForm}>
                    {availableForm}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id="invoice-form"
                name="form"
                type="text"
                readOnly
                value={editorForms[0] ?? ''}
                placeholder="—"
                disabled={isSubmitting}
                className="mt-1 block w-full rounded-md border-gray-200 bg-gray-100 text-gray-600 shadow-sm"
              />
            )}
            {draftErrors.form && (
              <p className="mt-1 text-sm text-red-600">{draftErrors.form}</p>
            )}
            {editorProduct && (
              <p className="mt-1 text-xs text-gray-500">
                Stock disponible : {editorAvailableStock}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="invoice-quantity" className="block text-sm font-medium text-gray-700">
              Quantité
            </label>
            <input
              id="invoice-quantity"
              name="quantity"
              type="number"
              inputMode="numeric"
              min={1}
              max={INVOICE_QUANTITY_MAX}
              step={1}
              placeholder="0"
              value={editor.quantity}
              onChange={(event) => updateEditor({ quantity: event.target.value })}
              disabled={isSubmitting}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-60"
            />
            {draftErrors.quantity && (
              <p className="mt-1 text-sm text-red-600">{draftErrors.quantity}</p>
            )}
          </div>

          <div>
            <label htmlFor="invoice-price" className="block text-sm font-medium text-gray-700">
              Prix unitaire (FCFA)
            </label>
            <input
              id="invoice-price"
              name="unitPrice"
              type="number"
              inputMode="numeric"
              min={0}
              max={INVOICE_UNIT_PRICE_MAX}
              step={1}
              placeholder="0"
              value={editor.unitPrice}
              onChange={(event) => updateEditor({ unitPrice: event.target.value })}
              disabled={isSubmitting}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-60"
            />
            {draftErrors.unitPrice && (
              <p className="mt-1 text-sm text-red-600">{draftErrors.unitPrice}</p>
            )}
            {configuredPrice !== null && (
              <p className="mt-1 text-xs text-gray-500">
                Prix configuré : {formatAmount(configuredPrice)}
              </p>
            )}
            {configuredPrice === null && editorProduct && (
              <p className="mt-1 text-xs text-amber-700">
                {INVOICE_MESSAGES.unitPriceNotConfigured}
              </p>
            )}
          </div>

          <div>
            <span className="block text-sm font-medium text-gray-700">Total ligne</span>
            <p className="mt-1 text-sm font-semibold text-gray-900">
              {formatAmount(readDraftLineTotal(editor))}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap justify-end gap-3">
          {isEditing && (
            <button
              type="button"
              onClick={resetEditor}
              disabled={isSubmitting}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
            >
              Annuler la modification
            </button>
          )}

          <button
            type="button"
            onClick={handleCommitLine}
            disabled={isSubmitting || isListFull}
            className="rounded-md border border-blue-600 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isEditing ? 'Mettre à jour' : '+ Ajouter'}
          </button>
        </div>
      </div>

      {draftErrors.productId && editor.productId.trim() === '' && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
          {draftErrors.productId}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 pt-4">
        <h3 className="text-sm font-semibold text-gray-700">Produits facturés ({lines.length})</h3>
        <Link to="/products" className="text-sm font-medium text-blue-600 hover:text-blue-800">
          + Nouveau produit
        </Link>
      </div>

      {lines.length === 0 ? (
        <p className="rounded-md bg-gray-50 px-3 py-4 text-center text-sm text-gray-500">
          Aucun produit pour le moment : choisissez un produit et sa forme, renseignez la
          quantité et le prix facturé, puis cliquez sur « + Ajouter ».
        </p>
      ) : (
        <LinesTable
          lines={lines}
          productNames={productNames}
          editingKey={editingKey}
          isDisabled={isSubmitting}
          onEdit={handleEditLine}
          onRemove={handleRemoveLine}
        />
      )}

      {fieldErrors.items && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{fieldErrors.items}</p>
      )}

      <dl className="ml-auto w-full max-w-xs space-y-1 border-t border-gray-200 pt-3 text-sm">
        <div className="flex items-baseline justify-between">
          <dt className="text-gray-600">Sous-total</dt>
          <dd className="font-medium text-gray-900">{formatAmount(totalAmount)}</dd>
        </div>
        <div className="flex items-baseline justify-between">
          <dt className="font-semibold text-gray-700">Total facture</dt>
          <dd className="text-base font-bold text-gray-900">{formatAmount(totalAmount)}</dd>
        </div>
      </dl>

      <p className="text-xs text-gray-500">
        Le total affiché n&apos;est qu&apos;un aperçu : le montant officiel et les mouvements
        de stock sont toujours calculés par le service métier. Le prix facturé est conservé
        comme historique, même si le prix du produit change plus tard.
      </p>

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
          disabled={isSubmitting || lines.length === 0}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitLabel}
        </button>
      </div>
    </form>
  )
}

export default InvoiceForm