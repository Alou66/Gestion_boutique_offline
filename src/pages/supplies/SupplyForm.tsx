import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import type { Product, SupplyCreateInput } from '@/types'
import {
  computeLineTotal,
  createEmptyDraft,
  formatAmount,
  getLineKey,
  getProductForms,
  isSameLine,
  parseNumberField,
  readDraftLineTotal,
  sumLineTotals,
  SUPPLY_ITEMS_MAX,
  SUPPLY_MESSAGES,
  SUPPLY_QUANTITY_MAX,
  SUPPLY_SUPPLIER_MAX_LENGTH,
  SUPPLY_UNIT_PRICE_MAX,
  supplyFormSchema,
  supplyItemFormSchema,
  toDraft,
  toSupplyInput,
  todayInputValue,
  validateDraftLine,
} from './schemas/supply.schema'
import type {
  SupplyFormErrors,
  SupplyItemDraft,
  SupplyItemDraftErrors,
  SupplyLineDraft,
} from './schemas/supply.schema'

interface SupplyFormProps {
  /** Active products of the shop, already loaded by the page. */
  products: Product[]
  isSubmitting: boolean
  error: string | null
  /** The validated lines are handed over for the confirmation step. */
  onValidate: (input: SupplyCreateInput) => void
  onCancel: () => void
}

interface LinesTableProps {
  lines: SupplyLineDraft[]
  productNames: Map<number, string>
  editingKey: string | null
  isDisabled: boolean
  onEdit: (line: SupplyLineDraft) => void
  onRemove: (key: string) => void
}

/** The lines already added, below the inputs: click a row to modify it. */
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
              Prix d&apos;achat
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
              <td className="px-4 py-2 text-right text-sm text-gray-600">
                {line.quantity}
              </td>
              <td className="px-4 py-2 text-right text-sm text-gray-600">
                {formatAmount(line.purchaseUnitPrice)}
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
 * One shot reception form with a single line editor.
 *
 * The shopkeeper picks a product, types its quantity and its real purchase
 * price, then presses "Ajouter": the line moves to the list below and the same
 * inputs are reused for the next product. Clicking an added line loads it back
 * into the inputs so it can be modified. Nothing is written before the final
 * confirmation: the document is validated once and never modified afterwards.
 */
function SupplyForm({
  products,
  isSubmitting,
  error,
  onValidate,
  onCancel,
}: SupplyFormProps) {
  const [date, setDate] = useState(todayInputValue())
  const [supplierName, setSupplierName] = useState('')
  const [lines, setLines] = useState<SupplyLineDraft[]>([])
  const [editor, setEditor] = useState<SupplyItemDraft>(createEmptyDraft)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<SupplyFormErrors>({})
  const [draftErrors, setDraftErrors] = useState<SupplyItemDraftErrors>({})

  const productsById = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products],
  )

  const productNames = useMemo(
    () => new Map(products.map((product) => [product.id, product.name])),
    [products],
  )

  const editorProduct = productsById.get(Number(editor.productId)) ?? null
  const editorForms = getProductForms(editorProduct)
  const isEditing = editingKey !== null
  const isListFull = !isEditing && lines.length >= SUPPLY_ITEMS_MAX

  const resetEditor = () => {
    setEditor(createEmptyDraft())
    setEditingKey(null)
    setDraftErrors({})
  }

  const updateEditor = (patch: Partial<SupplyItemDraft>) => {
    setDraftErrors({})
    setEditor((current) => ({ ...current, ...patch }))
  }

  /**
   * The forms always come from the selected product: a simple product shows its
   * single form as read only text, a transformable product offers its two forms.
   * An arbitrary form can never be typed.
   */
  const handleProductChange = (rawProductId: string) => {
    const product = productsById.get(Number(rawProductId)) ?? null
    const forms = getProductForms(product)

    setDraftErrors({})
    setEditor((current) => ({
      ...current,
      productId: rawProductId,
      form: forms[0] ?? '',
      // The quantity and the price belong to the previous product: they are
      // cleared instead of being carried over by mistake.
      quantity: '',
      purchaseUnitPrice: '',
    }))
  }

  const handleEditLine = (line: SupplyLineDraft) => {
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

  /** Validation of the editor, identical to the rules of the main process. */
  const parseEditor = () => {
    const parsed = supplyItemFormSchema.safeParse({
      productId: parseNumberField(editor.productId),
      form: editor.form,
      quantity: parseNumberField(editor.quantity),
      purchaseUnitPrice: parseNumberField(editor.purchaseUnitPrice),
    })

    if (!parsed.success) {
      const nextErrors: SupplyItemDraftErrors = {}

      for (const issue of parsed.error.issues) {
        const field = issue.path[0]

        if (typeof field === 'string' && !nextErrors[field as keyof SupplyItemDraftErrors]) {
          nextErrors[field as keyof SupplyItemDraftErrors] = issue.message
        }
      }

      setDraftErrors(nextErrors)

      return null
    }

    const issue = validateDraftLine(parsed.data.productId, parsed.data.form, products)

    if (issue) {
      setDraftErrors({ productId: issue })

      return null
    }

    return parsed.data
  }

  /** "+ Ajouter" (or "Mettre à jour"): the editor becomes a line of the list. */
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
      setDraftErrors({ productId: SUPPLY_MESSAGES.duplicateLine })

      return
    }

    const line: SupplyLineDraft = {
      key: editor.key,
      productId: parsed.productId,
      form: parsed.form,
      quantity: parsed.quantity,
      purchaseUnitPrice: parsed.purchaseUnitPrice,
      lineTotal: computeLineTotal(parsed.quantity, parsed.purchaseUnitPrice),
    }

    setLines((current) =>
      editingKey === null
        ? [...current, line]
        : current.map((candidate) => (candidate.key === editingKey ? line : candidate)),
    )

    resetEditor()
  }

  /** True when the editor holds a line that is not part of the document yet. */
  const hasUncommittedLine = isEditing
    ? !lines.some((line) => isSameLine(editor, line))
    : editor.productId.trim() !== ''

  const totalAmount = sumLineTotals(lines)

  /** Nothing is written here: the page asks for a confirmation first. */
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFormError(null)
    setFieldErrors({})

    // A line still in the editor would be silently lost: the shopkeeper is asked
    // to add it first.
    if (hasUncommittedLine) {
      setFormError(SUPPLY_MESSAGES.lineNotCommitted)

      return
    }

    const parsed = supplyFormSchema.safeParse({
      date,
      supplierName,
      items: lines.map((line) => ({
        productId: line.productId,
        form: line.form,
        quantity: line.quantity,
        purchaseUnitPrice: line.purchaseUnitPrice,
      })),
    })

    if (!parsed.success) {
      const nextErrors: SupplyFormErrors = {}

      for (const issue of parsed.error.issues) {
        const field = issue.path[0]

        if (typeof field === 'string' && !nextErrors[field as keyof SupplyFormErrors]) {
          nextErrors[field as keyof SupplyFormErrors] = issue.message
        }
      }

      setFieldErrors(nextErrors)

      return
    }

    onValidate(toSupplyInput(parsed.data))
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-lg border bg-white p-6 shadow"
    >
      <h2 className="text-lg font-semibold">Nouvel approvisionnement</h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="supply-date" className="block text-sm font-medium text-gray-700">
            Date de réception
          </label>
          <input
            id="supply-date"
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
          <label
            htmlFor="supply-supplier"
            className="block text-sm font-medium text-gray-700"
          >
            Fournisseur
          </label>
          <input
            id="supply-supplier"
            name="supplierName"
            type="text"
            maxLength={SUPPLY_SUPPLIER_MAX_LENGTH}
            placeholder="Optionnel"
            value={supplierName}
            onChange={(event) => setSupplierName(event.target.value)}
            disabled={isSubmitting}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-60"
          />
          {fieldErrors.supplierName && (
            <p className="mt-1 text-sm text-red-600">{fieldErrors.supplierName}</p>
          )}
        </div>
      </div>

      <div className="space-y-3 rounded-md border border-dashed border-gray-300 p-3">
        {isEditing && (
          <p className="text-xs font-medium text-blue-700">
            Modification d&apos;une ligne : « Mettre à jour » remplace la ligne
            sélectionnée.
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-6 sm:items-end">
          <div className="sm:col-span-2">
            <label htmlFor="supply-product" className="block text-sm font-medium text-gray-700">
              Produit
            </label>
            <select
              id="supply-product"
              name="productId"
              value={editor.productId}
              onChange={(event) => handleProductChange(event.target.value)}
              disabled={isSubmitting}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-60"
            >
              <option value="">Choisir un produit</option>
              {products.map((availableProduct) => (
                <option key={availableProduct.id} value={availableProduct.id}>
                  {availableProduct.name}
                </option>
              ))}
            </select>
            {draftErrors.productId && (
              <p className="mt-1 text-sm text-red-600">{draftErrors.productId}</p>
            )}
          </div>

          <div>
            <label htmlFor="supply-form" className="block text-sm font-medium text-gray-700">
              Forme
            </label>
            {editorForms.length > 1 ? (
              <select
                id="supply-form"
                name="form"
                value={editor.form}
                onChange={(event) => updateEditor({ form: event.target.value })}
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
                id="supply-form"
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
          </div>

          <div>
            <label
              htmlFor="supply-quantity"
              className="block text-sm font-medium text-gray-700"
            >
              Quantité
            </label>
            <input
              id="supply-quantity"
              name="quantity"
              type="number"
              inputMode="numeric"
              min={1}
              max={SUPPLY_QUANTITY_MAX}
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
            <label
              htmlFor="supply-price"
              className="block text-sm font-medium text-gray-700"
            >
              Prix d&apos;achat (FCFA)
            </label>
            <input
              id="supply-price"
              name="purchaseUnitPrice"
              type="number"
              inputMode="numeric"
              min={0}
              max={SUPPLY_UNIT_PRICE_MAX}
              step={1}
              placeholder="0"
              value={editor.purchaseUnitPrice}
              onChange={(event) => updateEditor({ purchaseUnitPrice: event.target.value })}
              disabled={isSubmitting}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-60"
            />
            {draftErrors.purchaseUnitPrice && (
              <p className="mt-1 text-sm text-red-600">{draftErrors.purchaseUnitPrice}</p>
            )}
          </div>

          <div>
            <span className="block text-sm font-medium text-gray-700">Total</span>
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
        <h3 className="text-sm font-semibold text-gray-700">
          Articles reçus ({lines.length})
        </h3>
        <Link
          to="/products"
          className="text-sm font-medium text-blue-600 hover:text-blue-800"
        >
          + Nouveau produit
        </Link>
      </div>

      {lines.length === 0 ? (
        <p className="rounded-md bg-gray-50 px-3 py-4 text-center text-sm text-gray-500">
          Aucun produit pour le moment : choisissez un produit, renseignez la quantité et
          le prix d&apos;achat, puis cliquez sur « + Ajouter ».
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
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
          {fieldErrors.items}
        </p>
      )}

      <p className="text-right text-base font-semibold text-gray-900">
        Coût total : {formatAmount(totalAmount)}
      </p>

      {formError && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{formError}</p>
      )}

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
      )}

      <p className="text-xs text-gray-500">
        Une fois validé, l&apos;approvisionnement est définitif : le stock augmente et
        aucun montant ne peut plus être modifié. Pour corriger une erreur, utilisez un
        ajustement de stock.
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
          disabled={isSubmitting || lines.length === 0}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? 'Validation…' : "Valider l'approvisionnement"}
        </button>
      </div>
    </form>
  )
}

export default SupplyForm
