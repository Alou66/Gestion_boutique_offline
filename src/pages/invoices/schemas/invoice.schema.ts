import { z } from 'zod'
import type {
  Client,
  Payment,
  PaymentStatus,
  Product,
  Sale,
  SaleCreateInput,
  SaleDetail,
  SaleFilters,
  SaleItemInput,
  SaleStatus,
  StockFormLevel,
} from '@/types'
import {
  normalizeFormLabel,
  parseNumberField,
  pluralizeFormLabel,
} from '../../products/schemas/product.schema'

/**
 * Règles d'affichage et de saisie du module Facturation.
 *
 * Le service métier (`electron/services/invoiceService.ts`) reste la seule
 * autorité : ces règles servent à éviter un aller-retour pour une erreur
 * manifestement invalide et à.coordonner l'interface. Aucune référence, aucun
 * total officiel et aucun statut de paiement n'est calculé ici.
 */

export const INVOICE_QUANTITY_MAX = 1_000_000
export const INVOICE_UNIT_PRICE_MAX = 1_000_000_000
export const INVOICE_PAYMENT_MAX = 1_000_000_000
export const INVOICE_ITEMS_MAX = 100
/**
 * Valeur du sélecteur client quand le client comptant n'a pas encore été créé :
 * la facture sera alors enregistrée sans client choisi, et c'est le service qui
 * utilisera « CLIENT COMPTANT ».
 */
export const CASH_CLIENT_VALUE = 'comptant'

/** The list API has no pagination: the pages are sliced in the renderer. */
export const INVOICES_PER_PAGE = 20

/** Messages d'affichage, identiques à `INVOICE_ERRORS` côté service métier. */
export const INVOICE_MESSAGES = {
  dateRequired: 'La date de la facture est obligatoire.',
  dateInvalid: 'La date doit être au format AAAA-MM-JJ.',
  dateOutOfRange: 'La date doit être comprise entre le 01/01/2000 et le 31/12/2099.',
  clientRequired: 'Choisissez un client actif.',
  clientNotFound: "Ce client n'existe pas.",
  clientInactive: 'Client inactif : choisissez un client actif ou le client comptant.',
  itemsRequired: 'Une facture doit contenir au moins un produit.',
  tooManyItems: `Une facture ne peut pas dépasser ${INVOICE_ITEMS_MAX} lignes.`,
  productRequired: 'Le produit est obligatoire.',
  productNotFound: 'Produit introuvable.',
  productInactive: "Produit inactif. Veuillez réactiver le produit avant de le facturer.",
  formRequired: 'La forme est obligatoire.',
  formInvalid: 'Forme invalide pour ce produit.',
  quantityRequired: 'La quantité est obligatoire.',
  quantityInvalid: 'La quantité doit être un entier supérieur à 0.',
  quantityTooHigh: `La quantité ne peut pas dépasser ${INVOICE_QUANTITY_MAX}.`,
  unitPriceRequired: "Le prix de vente unitaire est obligatoire.",
  unitPriceInvalid: "Le prix de vente unitaire doit être un entier supérieur ou égal à 0.",
  unitPriceTooHigh: `Le prix de vente unitaire ne peut pas dépasser ${INVOICE_UNIT_PRICE_MAX} FCFA.`,
  unitPriceNotConfigured:
    "Le prix de vente de ce produit n'est pas configuré pour cette forme : saisissez le prix facturé.",
  duplicateLine:
    'Un même produit ne peut pas apparaître deux fois avec la même forme. Regroupez les quantités sur une seule ligne.',
  lineNotCommitted:
    "Ajoutez ou mettez à jour la ligne affichée avant d'enregistrer la facture.",
  insufficientStock: 'Stock insuffisant pour cette facture.',
  lineNotFound: 'Cette ligne ne fait plus partie de la facture.',
  locked: 'Cette facture a déjà reçu un paiement : son contenu ne peut plus être modifié.',
  alreadyCancelled: 'Cette facture est déjà annulée.',
  cancelNotAllowed: 'Une facture ayant reçu un paiement ne peut pas être annulée.',
  deleteNotAllowed: 'Seule une facture annulée et non payée peut être supprimée.',
  paymentRequired: 'Le montant du paiement est obligatoire.',
  paymentInvalid: 'Le montant du paiement doit être un entier supérieur à 0.',
  paymentTooHigh: 'Le montant payé ne peut pas dépasser le total de la facture.',
  paymentNotFound: 'Paiement introuvable.',
  notFound: 'Facture introuvable.',
  noProducts: 'Aucun produit actif disponible.',
  printing: 'Impression en cours…',
  unexpected: 'Une erreur inattendue est survenue.',
} as const

/**
 * Date d'une facture ou d'un paiement : `AAAA-MM-JJ`, un vrai jour du
 * calendrier, entre 2000 et 2099. Exportée pour la restauration du
 * brouillon, qui valide la date retrouvée avec les mêmes règles.
 */
export const invoiceDateSchema = z
  .string({ error: INVOICE_MESSAGES.dateRequired })
  .trim()
  .min(1, INVOICE_MESSAGES.dateRequired)
  .refine((value) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)

    if (!match) {
      return false
    }

    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))

    // Un vrai jour du calendrier : 2026-02-31 n'existe pas.
    return (
      date.getFullYear() === Number(match[1]) &&
      date.getMonth() === Number(match[2]) - 1 &&
      date.getDate() === Number(match[3])
    )
  }, INVOICE_MESSAGES.dateInvalid)
  .refine(
    (value) => Number(value.slice(0, 4)) >= 2000 && Number(value.slice(0, 4)) <= 2099,
    INVOICE_MESSAGES.dateOutOfRange,
  )

/** null : le client comptant du système, jamais un client inactif. */
const clientIdSchema = z
  .number({ error: INVOICE_MESSAGES.clientRequired })
  .int(INVOICE_MESSAGES.clientRequired)
  .positive(INVOICE_MESSAGES.clientRequired)
  .nullable()

const productIdSchema = z
  .number({ error: INVOICE_MESSAGES.productRequired })
  .int(INVOICE_MESSAGES.productRequired)
  .positive(INVOICE_MESSAGES.productRequired)

const formSchema = z
  .string({ error: INVOICE_MESSAGES.formRequired })
  .trim()
  .min(1, INVOICE_MESSAGES.formRequired)
  .transform(normalizeFormLabel)

const quantitySchema = z
  .number({ error: INVOICE_MESSAGES.quantityRequired })
  .int(INVOICE_MESSAGES.quantityInvalid)
  .positive(INVOICE_MESSAGES.quantityInvalid)
  .max(INVOICE_QUANTITY_MAX, INVOICE_MESSAGES.quantityTooHigh)

const unitPriceSchema = z
  .number({ error: INVOICE_MESSAGES.unitPriceRequired })
  .int(INVOICE_MESSAGES.unitPriceInvalid)
  .min(0, INVOICE_MESSAGES.unitPriceInvalid)
  .max(INVOICE_UNIT_PRICE_MAX, INVOICE_MESSAGES.unitPriceTooHigh)

export const invoiceItemFormSchema = z.object({
  productId: productIdSchema,
  form: formSchema,
  quantity: quantitySchema,
  unitPrice: unitPriceSchema,
})

/**
 * Même produit et même forme sur deux lignes : les quantités doivent être
 * regroupées. Deux formes différentes du même produit restent valides.
 */
export const invoiceFormSchema = z
  .object({
    date: invoiceDateSchema,
    clientId: clientIdSchema,
    items: z
      .array(invoiceItemFormSchema)
      .min(1, INVOICE_MESSAGES.itemsRequired)
      .max(INVOICE_ITEMS_MAX, INVOICE_MESSAGES.tooManyItems),
  })
  .superRefine((values, ctx) => {
    const seen = new Set<string>()

    for (const item of values.items) {
      const key = getLineKey(item.productId, item.form)

      if (seen.has(key)) {
        ctx.addIssue({ code: 'custom', path: ['items'], message: INVOICE_MESSAGES.duplicateLine })

        return
      }

      seen.add(key)
    }
  })

/**
 * Un paiement ne peut jamais dépasser le reste à payer. La borne est fournie
 * par la page : à la création c'est le reste à payer, à la modification c'est le
 * reste à payer augmenté du montant du paiement modifié.
 */
export function buildPaymentFormSchema(maxAmount: number) {
  const amountSchema = z
    .number({ error: INVOICE_MESSAGES.paymentRequired })
    .int(INVOICE_MESSAGES.paymentInvalid)
    .positive(INVOICE_MESSAGES.paymentInvalid)
    .max(Math.min(maxAmount, INVOICE_PAYMENT_MAX), INVOICE_MESSAGES.paymentTooHigh)

  return z.object({ amount: amountSchema, date: invoiceDateSchema })
}

export type InvoiceFormData = z.infer<typeof invoiceFormSchema>

export type InvoiceFormErrors = Partial<Record<'date' | 'clientId' | 'items', string>>

export type InvoiceItemDraftErrors = Partial<
  Record<'productId' | 'form' | 'quantity' | 'unitPrice', string>
>

/**
 * Une seule ligne est saisie à la fois : le contenu de l'éditeur de ligne, les
 * chaînes que détiennent les champs.
 */
export interface InvoiceItemDraft {
  key: string
  productId: string
  form: string
  quantity: string
  unitPrice: string
}

/** Une ligne déjà ajoutée à la facture, montants recalculés par le service. */
export interface InvoiceLineDraft {
  key: string
  productId: number
  form: string
  quantity: number
  unitPrice: number
  lineTotal: number
}

export function createDraftKey(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function createEmptyDraft(): InvoiceItemDraft {
  return { key: createDraftKey(), productId: '', form: '', quantity: '', unitPrice: '' }
}

/** La date du jour en `YYYY-MM-DD`, date par défaut de la facture. */
export function todayInputValue(now = new Date()): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

/** Les formes vendables d'un produit : une pour un produit simple, deux sinon. */
export function getProductForms(product: Product | null): string[] {
  if (!product) {
    return []
  }

  return [product.primaryForm, product.secondaryForm].filter(
    (form): form is string => Boolean(form),
  )
}

/**
 * Le prix de vente configuré de la forme vendue : `secondary_sale_price` pour la
 * forme secondaire, `sale_price` sinon. C'est un simple préremplissage : le prix
 * facturé reste celui saisi par le commerçant.
 */
export function getConfiguredSalePrice(product: Product | null, form: string): number | null {
  if (!product) {
    return null
  }

  const isSecondary = Boolean(product.secondaryForm && product.secondaryForm === form)
  const price = isSecondary ? product.secondarySalePrice : product.salePrice

  return typeof price === 'number' && Number.isInteger(price) && price >= 0 ? price : null
}

/** quantity * unitPrice, 0 tant que les champs ne tiennent pas des entiers. */
export function computeLineTotal(quantity: number, unitPrice: number): number {
  if (
    !Number.isInteger(quantity) ||
    !Number.isInteger(unitPrice) ||
    quantity < 0 ||
    unitPrice < 0
  ) {
    return 0
  }

  return quantity * unitPrice
}

/** Affichage seulement : total de la ligne saisie, avant son ajout. */
export function readDraftLineTotal(draft: InvoiceItemDraft): number {
  const quantity = parseNumberField(draft.quantity)
  const unitPrice = parseNumberField(draft.unitPrice)

  if (quantity === undefined || unitPrice === undefined) {
    return 0
  }

  return computeLineTotal(quantity, unitPrice)
}

/** Sous-total affiché : la somme des lignes déjà ajoutées. */
export function sumLineTotals(lines: InvoiceLineDraft[]): number {
  return lines.reduce((sum, line) => sum + line.lineTotal, 0)
}

/** Même identité pour une ligne : le produit et la forme, quel que soit le prix. */
export function getLineKey(productId: number, form: string): string {
  return `${productId}|${normalizeFormLabel(form)}`
}

/** L'éditeur contient-il exactement la ligne déjà ajoutée ? */
export function isSameLine(draft: InvoiceItemDraft, line: InvoiceLineDraft): boolean {
  const productId = parseNumberField(draft.productId)

  if (productId === undefined) {
    return false
  }

  return (
    productId === line.productId &&
    normalizeFormLabel(draft.form) === normalizeFormLabel(line.form) &&
    (parseNumberField(draft.quantity) ?? NaN) === line.quantity &&
    (parseNumberField(draft.unitPrice) ?? NaN) === line.unitPrice
  )
}

/** Recharge une ligne ajoutée dans les champs pour la modifier. */
export function toDraft(line: InvoiceLineDraft): InvoiceItemDraft {
  return {
    key: line.key,
    productId: String(line.productId),
    form: line.form,
    quantity: String(line.quantity),
    unitPrice: String(line.unitPrice),
  }
}

/** Les lignes déjà présentes sur la facture, revenues à l'état de l'éditeur. */
export function toLineDrafts(items: SaleItemInput[]): InvoiceLineDraft[] {
  return items.map((item) => ({
    key: createDraftKey(),
    productId: item.productId,
    form: item.form,
    quantity: item.quantity,
    unitPrice: item.unitPrice ?? 0,
    lineTotal: computeLineTotal(item.quantity, item.unitPrice ?? 0),
  }))
}

/**
 * Le stock disponible de chaque forme, lu dans le module Stock. Les quantités
 * déjà vendues par la facture en cours de modification lui sont rendues : le
 * service considère exactement la même chose quand il vérifie la modification.
 */
export function buildAvailableStock(
  levels: StockFormLevel[],
  invoice?: SaleDetail | null,
): Map<string, number> {
  const soldByLine = new Map<string, number>()

  for (const item of invoice?.items ?? []) {
    soldByLine.set(getLineKey(item.productId, item.form), item.quantity)
  }

  const available = new Map<string, number>()

  for (const level of levels) {
    const key = getLineKey(level.productId, level.form)

    available.set(key, level.quantity + (soldByLine.get(key) ?? 0))
  }

  for (const [key, sold] of soldByLine) {
    if (!available.has(key)) {
      available.set(key, sold)
    }
  }

  return available
}

/** Le stock restant d'une forme, pour l'affichage sous le sélecteur de forme. */
export function readAvailableStock(
  available: Map<string, number>,
  productId: number,
  form: string,
): number {
  return available.get(getLineKey(productId, form)) ?? 0
}

/**
 * Le service reste l'autorité, mais l'éditeur bloque une ligne manifestement
 * fausse avant l'aller-retour : produit inconnu ou inactif, forme qui
 * n'appartient pas au produit, ou quantité supérieure au stock disponible.
 */
export function validateDraftLine(
  productId: number,
  form: string,
  quantity: number,
  products: Product[],
  available: Map<string, number>,
): string | null {
  const product = products.find((candidate) => candidate.id === productId)

  if (!product) {
    return INVOICE_MESSAGES.productNotFound
  }

  if (!product.isActive) {
    return INVOICE_MESSAGES.productInactive
  }

  if (!getProductForms(product).includes(normalizeFormLabel(form))) {
    return INVOICE_MESSAGES.formInvalid
  }

  if (Number.isInteger(quantity) && quantity > readAvailableStock(available, productId, form)) {
    return INVOICE_MESSAGES.insufficientStock
  }

  return null
}

/**
 * Le client comptant est déjà géré par le service : le renderer ne le crée
 * jamais. Sans client choisi, la facture est enregistrée sans client et c'est le
 * service qui utilise « CLIENT COMPTANT ». Un client hors de la liste proposée
 * (inactif ou supprimé entre-temps) est refusé avant l'aller-retour.
 */
export type ClientSelection =
  | { ok: true; clientId: number | null }
  | { ok: false; error: string }

export function resolveClientSelection(rawValue: string, clients: Client[]): ClientSelection {
  if (rawValue === CASH_CLIENT_VALUE || rawValue.trim() === '') {
    return { ok: true, clientId: null }
  }

  const clientId = parseNumberField(rawValue)

  if (clientId === undefined || !Number.isInteger(clientId) || clientId <= 0) {
    return { ok: false, error: INVOICE_MESSAGES.clientRequired }
  }

  if (!clients.some((client) => client.id === clientId)) {
    return { ok: false, error: INVOICE_MESSAGES.clientNotFound }
  }

  return { ok: true, clientId }
}

/**
 * Forme le contenu validé en payload du service. Les montants ne sont jamais
 * envoyés comme total : le service les recalcule à partir de la quantité et du
 * prix unitaire de chaque ligne.
 */
export function toInvoiceInput(values: InvoiceFormData): SaleCreateInput {
  return {
    date: values.date,
    clientId: values.clientId,
    items: values.items.map((item) => ({
      productId: item.productId,
      form: item.form,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
    })),
  }
}

/* ------------------------------------------------------------------ */
/* Affichage                                                          */
/* ------------------------------------------------------------------ */

/** 300000 -> "300 000 FCFA" (fr-FR utilise une espace fine insécable). */
const amountFormatter = new Intl.NumberFormat('fr-FR')

export function formatAmount(value: number): string {
  return `${amountFormatter.format(value)}`
}

const dateFormatter = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short' })

/** Jour de la facture : 05/10/2026. */
export function formatInvoiceDate(date: Date): string {
  return dateFormatter.format(date)
}

const timeFormatter = new Intl.DateTimeFormat('fr-FR', {
  hour: '2-digit',
  minute: '2-digit',
})

/** Heure de la facture, lue sur sa date : 16:45. */
export function formatInvoiceTime(date: Date): string {
  return timeFormatter.format(date)
}

/** "10 CARTONS" pour la ligne de facture. */
export function formatSoldQuantity(form: string, quantity: number): string {
  return `${quantity} ${pluralizeFormLabel(form)}`
}

/**
 * Les statuts sont affichés tels que le service les nomme : le tiret bas devient
 * un espace, `NON_PAYEE` est donc affiché `NON PAYEE`.
 */
export function formatStatusLabel(status: PaymentStatus | SaleStatus): string {
  return status.replace(/_/g, ' ')
}

export function paymentStatusTone(status: PaymentStatus): string {
  if (status === 'PAYEE') {
    return 'bg-green-100 text-green-700'
  }

  if (status === 'PARTIELLEMENT_PAYEE') {
    return 'bg-amber-100 text-amber-700'
  }

  return 'bg-gray-100 text-gray-600'
}

export function saleStatusTone(status: SaleStatus): string {
  return status === 'VALIDEE' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
}

/* ------------------------------------------------------------------ */
/* Actions autorisées, par état de la facture                         */
/* ------------------------------------------------------------------ */

export interface InvoiceActions {
  /** Contenu commercial : client, produits, formes, quantités, prix. */
  canEdit: boolean
  canCancel: boolean
  canDelete: boolean
  canAddPayment: boolean
  canManagePayments: boolean
  canPrint: boolean
}

/**
 * Les mêmes verrous que `invoiceService`, lus sur les montants renvoyés par le
 * service (et jamais recalculés ici) :
 *
 * - VALIDEE + aucun paiement : modifiable, annulable, supprimable après
 *   annulation ;
 * - VALIDEE + paiement (partiel ou total) : contenu commercial verrouillé, mais
 *   les paiements restent modifiables et supprimables ;
 * - ANNULEE : ni modification ni annulation, seulement la suppression.
 */
export function getInvoiceActions(invoice: Sale, hasPayments: boolean): InvoiceActions {
  const isValidated = invoice.status === 'VALIDEE'
  const isUnpaid = invoice.paidAmount <= 0

  return {
    canEdit: isValidated && isUnpaid,
    canCancel: isValidated && isUnpaid,
    canDelete: !isValidated && isUnpaid,
    canAddPayment: isValidated && invoice.remainingAmount > 0,
    canManagePayments: isValidated && hasPayments,
    canPrint: true,
  }
}

/** Le maximum qu'un paiement peut recevoir, service compris. */
export function getMaxPaymentAmount(invoice: Sale, payment?: Payment | null): number {
  const alreadyPaidByPayment = payment ? payment.amount : 0

  return invoice.remainingAmount + alreadyPaidByPayment
}

/* ------------------------------------------------------------------ */
/* Liste des factures                                                 */
/* ------------------------------------------------------------------ */

export type InvoiceStatusFilter = 'all' | SaleStatus

/**
 * Les filtres de la liste ne font que transmettre ce que `listInvoices()`
 * sait déjà filtrer : la recherche reste dans le service, jamais dans React.
 */
export function buildInvoiceFilters(
  search: string,
  clientSearch: string,
  status: InvoiceStatusFilter,
  dateFrom?: string,
  dateTo?: string,
): SaleFilters {
  return {
    search: search.trim() || undefined,
    clientSearch: clientSearch.trim() || undefined,
    status: status === 'all' ? null : status,
    dateFrom: dateFrom?.trim() || undefined,
    dateTo: dateTo?.trim() || undefined,
  }
}

export interface InvoicePage {
  rows: Sale[]
  page: number
  totalPages: number
  total: number
}

/** Pagination de l'affichage : l'API renvoie la liste entière, sans limite. */
export function paginateInvoices(sales: Sale[], page: number): InvoicePage {
  const total = sales.length
  const totalPages = Math.max(1, Math.ceil(total / INVOICES_PER_PAGE))
  const currentPage = Math.min(Math.max(1, page), totalPages)
  const start = (currentPage - 1) * INVOICES_PER_PAGE

  return {
    rows: sales.slice(start, start + INVOICES_PER_PAGE),
    page: currentPage,
    totalPages,
    total,
  }
}

/* ------------------------------------------------------------------ */
/* Confirmations                                                      */
/* ------------------------------------------------------------------ */

/**
 * Résumé affiché avant écriture. Le renderer ne touche jamais au stock : c'est
 * le service qui créera les mouvements à partir des lignes validées.
 */
export function buildInvoiceConfirmationMessage(
  input: SaleCreateInput,
  clientName: string,
  isUpdate = false,
): string {
  const total = input.items.reduce(
    (sum, item) => sum + item.quantity * (item.unitPrice ?? 0),
    0,
  )
  const lines = `${input.items.length} ${input.items.length > 1 ? 'lignes' : 'ligne'}`

  return [
    `Client : ${clientName}`,
    `${lines} pour un total de ${formatAmount(total)}`,
    isUpdate
      ? "La facture sera modifiée : la différence de quantité sera corrigée dans le stock."
      : 'Le stock sera décrémenté immédiatement et la facture pourra être modifiée tant qu\'elle ne sera pas payée.',
  ].join('\n')
}

export function buildCancelInvoiceMessage(reference: string): string {
  return [
    `Voulez-vous vraiment annuler la facture ${reference} ?`,
    'Cette action restaurera le stock et ne pourra pas être annulée directement.',
    'Une facture annulée pourra seulement être supprimée.',
  ].join('\n')
}

export function buildDeleteInvoiceMessage(reference: string): string {
  return [
    `Voulez-vous vraiment supprimer définitivement la facture ${reference} ?`,
    'Cette suppression est définitive : la facture et ses lignes disparaissent de la liste.',
    'Cette action est irréversible.',
  ].join('\n')
}

export function buildDeletePaymentMessage(amount: number): string {
  return [
    `Voulez-vous vraiment supprimer le paiement de ${formatAmount(amount)} ?`,
    'Le montant payé, le reste à payer et le statut de la facture seront recalculés.',
  ].join('\n')
}

export { parseNumberField }