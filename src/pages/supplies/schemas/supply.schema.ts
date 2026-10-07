import { z } from 'zod'
import type { Product, SupplyCreateInput, Supplier } from '@/types'
import { normalizeFormLabel, parseNumberField, pluralizeFormLabel } from '../../products/schemas/product.schema'

export const SUPPLY_QUANTITY_MAX = 1_000_000
export const SUPPLY_UNIT_PRICE_MAX = 1_000_000_000
export const SUPPLY_SUPPLIER_MAX_LENGTH = 120
export const SUPPLY_ITEMS_MAX = 100

/**
 * Valeur du sélecteur fournisseur quand le fournisseur comptant
 * (« FOURNISSEUR COMPTANT ») n'a pas encore été créé : l'approvisionnement
 * sera alors enregistré sans fournisseur choisi, et c'est le service qui
 * utilisera le fournisseur système par défaut.
 */
export const CASH_SUPPLIER_VALUE = 'comptant'

/** Display messages, identical to electron/services/supplyService.ts. */
export const SUPPLY_MESSAGES = {
  dateRequired: "La date de l'approvisionnement est obligatoire.",
  dateInvalid: 'La date doit être au format AAAA-MM-JJ.',
  dateOutOfRange: 'La date doit être comprise entre le 01/01/2000 et le 31/12/2099.',
  supplierTooLong: `Le fournisseur ne peut pas dépasser ${SUPPLY_SUPPLIER_MAX_LENGTH} caractères.`,
  supplierRequired: 'Choisissez un fournisseur actif.',
  supplierNotFound: "Ce fournisseur n'existe plus.",
  supplierInactive: 'Fournisseur inactif : choisissez un fournisseur actif ou le fournisseur comptant.',
  itemsRequired: 'Un approvisionnement doit contenir au moins un produit.',
  tooManyItems: `Un approvisionnement ne peut pas dépasser ${SUPPLY_ITEMS_MAX} lignes.`,
  productRequired: 'Le produit est obligatoire.',
  productNotFound: 'Produit introuvable.',
  productInactive:
    "Produit inactif. Veuillez réactiver le produit avant de l'approvisionner.",
  formRequired: 'La forme est obligatoire.',
  formInvalid: 'Forme invalide pour ce produit.',
  quantityRequired: 'La quantité est obligatoire.',
  quantityInvalid: 'La quantité doit être un entier supérieur à 0.',
  quantityTooHigh: `La quantité ne peut pas dépasser ${SUPPLY_QUANTITY_MAX}.`,
  unitPriceRequired: "Le prix d'achat unitaire est obligatoire.",
  unitPriceInvalid: "Le prix d'achat unitaire doit être un entier supérieur ou égal à 0.",
  unitPriceTooHigh: `Le prix d'achat unitaire ne peut pas dépasser ${SUPPLY_UNIT_PRICE_MAX} FCFA.`,
  duplicateLine:
    'Un même produit ne peut pas apparaître deux fois avec la même forme. Regroupez les quantités sur une seule ligne.',
  lineNotCommitted:
    'Ajoutez ou mettez à jour la ligne affichée avant de valider l\'approvisionnement.',
  notFound: 'Approvisionnement introuvable.',
  unexpected: 'Une erreur inattendue est survenue.',
} as const

/**
 * Date de réception : `AAAA-MM-JJ`, un vrai jour du calendrier,
 * entre 2000 et 2099. Exportée pour la restauration du brouillon,
 * qui valide la date retrouvée avec les mêmes règles.
 */
export const supplyDateSchema = z
  .string({ error: SUPPLY_MESSAGES.dateRequired })
  .trim()
  .min(1, SUPPLY_MESSAGES.dateRequired)
  .refine((value) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)

    if (!match) {
      return false
    }

    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))

    // A real calendar day: 2026-02-31 does not exist.
    return (
      date.getFullYear() === Number(match[1]) &&
      date.getMonth() === Number(match[2]) - 1 &&
      date.getDate() === Number(match[3])
    )
  }, SUPPLY_MESSAGES.dateInvalid)
  .refine(
    (value) => Number(value.slice(0, 4)) >= 2000 && Number(value.slice(0, 4)) <= 2099,
    SUPPLY_MESSAGES.dateOutOfRange,
  )

const productIdSchema = z
  .number({ error: SUPPLY_MESSAGES.productRequired })
  .int(SUPPLY_MESSAGES.productRequired)
  .positive(SUPPLY_MESSAGES.productRequired)

const formSchema = z
  .string({ error: SUPPLY_MESSAGES.formRequired })
  .trim()
  .min(1, SUPPLY_MESSAGES.formRequired)
  .transform(normalizeFormLabel)

/** null : le fournisseur comptant du système (« FOURNISSEUR COMPTANT »), jamais un fournisseur inactif. */
const supplierIdSchema = z
  .number({ error: SUPPLY_MESSAGES.supplierRequired })
  .int(SUPPLY_MESSAGES.supplierRequired)
  .positive(SUPPLY_MESSAGES.supplierRequired)
  .nullable()

const quantitySchema = z
  .number({ error: SUPPLY_MESSAGES.quantityRequired })
  .int(SUPPLY_MESSAGES.quantityInvalid)
  .positive(SUPPLY_MESSAGES.quantityInvalid)
  .max(SUPPLY_QUANTITY_MAX, SUPPLY_MESSAGES.quantityTooHigh)

const unitPriceSchema = z
  .number({ error: SUPPLY_MESSAGES.unitPriceRequired })
  .int(SUPPLY_MESSAGES.unitPriceInvalid)
  .min(0, SUPPLY_MESSAGES.unitPriceInvalid)
  .max(SUPPLY_UNIT_PRICE_MAX, SUPPLY_MESSAGES.unitPriceTooHigh)

export const supplyItemFormSchema = z.object({
  productId: productIdSchema,
  form: formSchema,
  quantity: quantitySchema,
  purchaseUnitPrice: unitPriceSchema,
})

/**
 * One document can never receive the same product twice in the same form: the
 * two lines must be merged. Two different forms of the same product stay valid.
 */
export const supplyFormSchema = z
  .object({
    date: supplyDateSchema,
    supplierId: supplierIdSchema,
    items: z
      .array(supplyItemFormSchema)
      .min(1, SUPPLY_MESSAGES.itemsRequired)
      .max(SUPPLY_ITEMS_MAX, SUPPLY_MESSAGES.tooManyItems),
  })
  .superRefine((values, ctx) => {
    const seen = new Set<string>()

    for (const item of values.items) {
      const key = `${item.productId}|${item.form}`

      if (seen.has(key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['items'],
          message: SUPPLY_MESSAGES.duplicateLine,
        })
        return
      }

      seen.add(key)
    }
  })

export type SupplyFormData = z.infer<typeof supplyFormSchema>

export type SupplyFormErrors = Partial<
  Record<'date' | 'supplierId' | 'items', string>
>

export type SupplyItemDraftErrors = Partial<
  Record<'productId' | 'form' | 'quantity' | 'purchaseUnitPrice', string>
>

/**
 * The form works with a single line editor: this is its content, the strings the
 * inputs hold.
 */
export interface SupplyItemDraft {
  key: string
  productId: string
  form: string
  quantity: string
  purchaseUnitPrice: string
}

/** A line already added to the document, amounts recomputed by the service. */
export interface SupplyLineDraft {
  key: string
  productId: number
  form: string
  quantity: number
  purchaseUnitPrice: number
  lineTotal: number
}

export function createDraftKey(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function createEmptyDraft(): SupplyItemDraft {
  return {
    key: createDraftKey(),
    productId: '',
    form: '',
    quantity: '',
    purchaseUnitPrice: '',
  }
}

/** quantity * purchaseUnitPrice, 0 when the inputs do not hold whole numbers. */
export function computeLineTotal(quantity: number, purchaseUnitPrice: number): number {
  if (
    !Number.isInteger(quantity) ||
    !Number.isInteger(purchaseUnitPrice) ||
    quantity < 0 ||
    purchaseUnitPrice < 0
  ) {
    return 0
  }

  return quantity * purchaseUnitPrice
}

/** Display only: the line total of the editor, before it is added. */
export function readDraftLineTotal(draft: SupplyItemDraft): number {
  const quantity = parseNumberField(draft.quantity)
  const purchaseUnitPrice = parseNumberField(draft.purchaseUnitPrice)

  if (quantity === undefined || purchaseUnitPrice === undefined) {
    return 0
  }

  return computeLineTotal(quantity, purchaseUnitPrice)
}

/** Total of the document: the sum of the lines already added. */
export function sumLineTotals(lines: SupplyLineDraft[]): number {
  return lines.reduce((sum, line) => sum + line.lineTotal, 0)
}

/** Same identity for a line: product and form, whatever the price paid. */
export function getLineKey(productId: number, form: string): string {
  return `${productId}|${normalizeFormLabel(form)}`
}

/** Same identity between the editor and an added line. */
export function isSameLine(draft: SupplyItemDraft, line: SupplyLineDraft): boolean {
  const productId = parseNumberField(draft.productId)

  if (productId === undefined) {
    return false
  }

  return (
    productId === line.productId &&
    normalizeFormLabel(draft.form) === normalizeFormLabel(line.form) &&
    (parseNumberField(draft.quantity) ?? NaN) === line.quantity &&
    (parseNumberField(draft.purchaseUnitPrice) ?? NaN) === line.purchaseUnitPrice
  )
}

/** Loads an added line back into the editor to modify it. */
export function toDraft(line: SupplyLineDraft): SupplyItemDraft {
  return {
    key: line.key,
    productId: String(line.productId),
    form: line.form,
    quantity: String(line.quantity),
    purchaseUnitPrice: String(line.purchaseUnitPrice),
  }
}

/** Local today as `YYYY-MM-DD`, the default reception date of the document. */
export function todayInputValue(now = new Date()): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

/** 300000 -> "300 000 FCFA" (fr-FR uses a narrow no break space). */
const amountFormatter = new Intl.NumberFormat('fr-FR')

export function formatAmount(value: number): string {
  return `${amountFormatter.format(value)} FCFA`
}

/** "10 CARTONS" for the confirmation sentence. */
export function formatReceivedQuantity(form: string, quantity: number): string {
  return `${quantity} ${pluralizeFormLabel(form)}`
}

/** Display of the reception day: 04/10/2026. */
export function formatSupplyDate(date: Date): string {
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short' }).format(date)
}

/**
 * Confirmation sentence before validating: how many lines, which total, and
 * exactly what the validation changes. The amounts are recomputed from the lines
 * because the shopkeeper never types the total.
 */
export function buildValidationMessage(input: SupplyCreateInput, supplierName?: string | null): string {
  const total = input.items.reduce(
    (sum, item) => sum + item.quantity * item.purchaseUnitPrice,
    0,
  )
  const lines = `${input.items.length} ${input.items.length > 1 ? 'lignes' : 'ligne'}`
  const supplier = supplierName ? ` du fournisseur « ${supplierName} »` : ''

  return `${lines}${supplier} pour un total de ${formatAmount(total)}. Le stock sera augmenté immédiatement et l'approvisionnement ne pourra plus être modifié.`
}

/** The forms a product can be received in: one for a simple product, two otherwise. */
export function getProductForms(product: Product | null): string[] {
  if (!product) {
    return []
  }

  return [product.primaryForm, product.secondaryForm].filter(
    (form): form is string => Boolean(form),
  )
}

/**
 * The main process stays the authority, but the form blocks an obviously wrong
 * line before the round trip: unknown product, inactive product or a form that
 * does not belong to the selected product. A product without any movement has a
 * stock of 0 and can be received directly.
 */
export function validateDraftLine(
  productId: number,
  form: string,
  products: Product[],
): string | null {
  const product = products.find((candidate) => candidate.id === productId)

  if (!product) {
    return SUPPLY_MESSAGES.productNotFound
  }

  if (!product.isActive) {
    return SUPPLY_MESSAGES.productInactive
  }

  if (!getProductForms(product).includes(normalizeFormLabel(form))) {
    return SUPPLY_MESSAGES.formInvalid
  }

  return null
}

/**
 * Résout la sélection du SearchableSelect (une chaîne) en identifiant le
 * fournisseur choisi, ou null pour le fournisseur comptant système.
 * Le fournisseur inactif ou introuvable est refusé avant l'aller-retour.
 */
export type SupplierSelection =
  | { ok: true; supplierId: number | null }
  | { ok: false; error: string }

export function resolveSupplierSelection(rawValue: string, suppliers: Supplier[]): SupplierSelection {
  if (rawValue === CASH_SUPPLIER_VALUE || rawValue.trim() === '') {
    return { ok: true, supplierId: null }
  }

  const supplierId = parseNumberField(rawValue)

  if (supplierId === undefined || !Number.isInteger(supplierId) || supplierId <= 0) {
    return { ok: false, error: SUPPLY_MESSAGES.supplierRequired }
  }

  const supplier = suppliers.find((candidate) => candidate.id === supplierId)

  if (!supplier) {
    return { ok: false, error: SUPPLY_MESSAGES.supplierNotFound }
  }

  if (!supplier.isActive) {
    return { ok: false, error: SUPPLY_MESSAGES.supplierInactive }
  }

  return { ok: true, supplierId }
}

/**
 * Shapes the validated form data into the payload expected by the main process.
 * The amounts are not sent: the service recomputes them from the quantity and
 * the unit price, so the renderer is never the source of truth for the money.
 */
export function toSupplyInput(values: SupplyFormData): SupplyCreateInput {
  return {
    date: values.date,
    supplierId: values.supplierId ?? null,
    items: values.items.map((item) => ({
      productId: item.productId,
      form: item.form,
      quantity: item.quantity,
      purchaseUnitPrice: item.purchaseUnitPrice,
    })),
  }
}

export { parseNumberField }
