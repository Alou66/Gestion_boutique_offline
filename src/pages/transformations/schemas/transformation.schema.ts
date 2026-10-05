import { z } from 'zod'
import type { Product, TransformationCreateInput } from '@/types'
import {
  normalizeFormLabel,
  parseNumberField,
  pluralizeFormLabel,
} from '../../products/schemas/product.schema'

export const TRANSFORMATION_QUANTITY_MAX = 1_000_000

/** Display messages, identical to electron/services/transformationService.ts. */
export const TRANSFORMATION_MESSAGES = {
  productRequired: 'Le produit est obligatoire.',
  productNotFound: 'Produit introuvable.',
  productInactive:
    'Produit inactif. Veuillez réactiver le produit avant de le transformer.',
  productNotTransformable:
    'Ce produit est simple : il ne possède pas de forme secondaire et ne peut pas être transformé.',
  conversionRequired: 'Ce produit transformable ne possède pas de conversion exploitable.',
  formRequired: 'La forme de départ est obligatoire.',
  formInvalid: 'Forme invalide pour ce produit.',
  sameForm: "La forme de départ et la forme d'arrivée doivent être différentes.",
  quantityRequired: 'La quantité est obligatoire.',
  quantityInvalid: 'La quantité doit être un entier supérieur à 0.',
  quantityTooHigh: `La quantité ne peut pas dépasser ${TRANSFORMATION_QUANTITY_MAX}.`,
  conversionInvalid:
    "Cette quantité ne peut pas être convertie exactement : aucune quantité fractionnaire n'est acceptée.",
  insufficientStock: 'Stock insuffisant pour cette transformation.',
  dateInvalid: 'La date doit être au format AAAA-MM-JJ.',
  notFound: 'Transformation introuvable.',
  noProducts: 'Aucun produit transformable actif disponible.',
  unexpected: 'Une erreur inattendue est survenue.',
} as const

const productIdSchema = z
  .number({ error: TRANSFORMATION_MESSAGES.productRequired })
  .int(TRANSFORMATION_MESSAGES.productRequired)
  .positive(TRANSFORMATION_MESSAGES.productRequired)

const formSchema = z
  .string({ error: TRANSFORMATION_MESSAGES.formRequired })
  .trim()
  .min(1, TRANSFORMATION_MESSAGES.formRequired)
  .transform(normalizeFormLabel)

const quantitySchema = z
  .number({ error: TRANSFORMATION_MESSAGES.quantityRequired })
  .int(TRANSFORMATION_MESSAGES.quantityInvalid)
  .positive(TRANSFORMATION_MESSAGES.quantityInvalid)
  .max(TRANSFORMATION_QUANTITY_MAX, TRANSFORMATION_MESSAGES.quantityTooHigh)

export const transformationFormSchema = z.object({
  date: z
    .string({ error: TRANSFORMATION_MESSAGES.dateInvalid })
    .trim()
    .refine((value) => /^\d{4}-\d{2}-\d{2}$/.test(value), TRANSFORMATION_MESSAGES.dateInvalid),
  productId: productIdSchema,
  sourceForm: formSchema,
  sourceQuantity: quantitySchema,
})

export type TransformationFormData = z.infer<typeof transformationFormSchema>

export type TransformationFormErrors = Partial<
  Record<'date' | 'productId' | 'sourceForm' | 'sourceQuantity', string>
>

/**
 * The forms a product can be transformed between: exactly two for a transformable
 * product, none otherwise. A simple product is never offered by the main process
 * and is refused here too.
 */
export function getProductForms(product: Product | null): string[] {
  if (!product?.isTransformable) {
    return []
  }

  return [product.primaryForm, product.secondaryForm].filter(
    (form): form is string => Boolean(form),
  )
}

/** The conversion of the product, or null when it is not usable. */
export function getConversionRatio(product: Product | null): number | null {
  const forms = getProductForms(product)

  if (forms.length !== 2) {
    return null
  }

  const ratio = product?.conversionQuantity ?? null

  if (ratio === null || !Number.isInteger(ratio) || ratio <= 0) {
    return null
  }

  return ratio
}

/**
 * The destination form is never typed: it is always the other form of the
 * selected product, so source and destination can never be the same form.
 */
export function getDestinationForm(
  product: Product | null,
  sourceForm: string,
): string | null {
  const forms = getProductForms(product)
  const normalized = normalizeFormLabel(sourceForm)

  if (!forms.includes(normalized)) {
    return null
  }

  return forms.find((form) => form !== normalized) ?? null
}

/**
 * Exact conversion, identical to the main process: no rounding and no loss. With
 * 1 CARTON = 4 SEAUX, 2 -> 8 and 4 -> 1, while 1 SEAU or 5 SEAUX are refused
 * because they would produce a fractional carton.
 */
export function computeDestinationQuantity(
  product: Product | null,
  sourceForm: string,
  sourceQuantity: number,
): number | null {
  const ratio = getConversionRatio(product)
  const destinationForm = getDestinationForm(product, sourceForm)

  if (ratio === null || destinationForm === null) {
    return null
  }

  const isPrimaryForm = normalizeFormLabel(sourceForm) === normalizeFormLabel(
    product?.primaryForm ?? '',
  )
  const raw = isPrimaryForm ? sourceQuantity * ratio : sourceQuantity / ratio

  if (!Number.isInteger(raw) || raw <= 0 || raw > TRANSFORMATION_QUANTITY_MAX) {
    return null
  }

  return raw
}

/** "1 CARTON = 4 SEAUX", the conversion line displayed under the product. */
export function formatConversionRule(product: Product | null): string | null {
  const ratio = getConversionRatio(product)
  const forms = getProductForms(product)

  if (ratio === null || forms.length !== 2) {
    return null
  }

  return `1 ${forms[0]} = ${ratio} ${pluralizeFormLabel(forms[1])}`
}

/**
 * "1 CARTON" but "2 CARTONS": the quantity decides the number, so the
 * confirmation reads "4 SEAUX → 1 CARTON".
 */
export function formatFormQuantity(form: string, quantity: number): string {
  const label = normalizeFormLabel(form)

  return `${quantity} ${quantity >= 2 ? pluralizeFormLabel(label) : label}`
}

/** "2 CARTONS → 8 SEAUX", the transformation sentence of the history. */
export function formatTransformationSentence(
  sourceForm: string,
  sourceQuantity: number,
  destinationForm: string,
  destinationQuantity: number,
): string {
  return `${formatFormQuantity(sourceForm, sourceQuantity)} → ${formatFormQuantity(
    destinationForm,
    destinationQuantity,
  )}`
}

/** Display of the transformation day: 04/10/2026. */
export function formatTransformationDate(date: Date): string {
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short' }).format(date)
}

/** Local today as `YYYY-MM-DD`, the default date of a document. */
export function todayInputValue(now = new Date()): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

/**
 * The main process stays the authority, but the form blocks an obviously wrong
 * selection before the round trip: unknown product, simple product, inactive
 * product or a form that does not belong to the selected product.
 */
export function validateTransformationDraft(
  productId: number,
  sourceForm: string,
  products: Product[],
): string | null {
  const product = products.find((candidate) => candidate.id === productId)

  if (!product) {
    return TRANSFORMATION_MESSAGES.productNotFound
  }

  if (!product.isActive) {
    return TRANSFORMATION_MESSAGES.productInactive
  }

  if (getConversionRatio(product) === null || getProductForms(product).length !== 2) {
    return TRANSFORMATION_MESSAGES.productNotTransformable
  }

  if (!getProductForms(product).includes(normalizeFormLabel(sourceForm))) {
    return TRANSFORMATION_MESSAGES.formInvalid
  }

  return null
}

/**
 * Shapes the validated form data into the payload expected by the main process.
 * The destination form and the destination quantity are never sent: the service
 * recomputes both, so the renderer is never the source of truth for the
 * conversion.
 */
export function toTransformationInput(
  values: TransformationFormData,
): TransformationCreateInput {
  return {
    productId: values.productId,
    sourceForm: values.sourceForm,
    sourceQuantity: values.sourceQuantity,
    date: values.date,
  }
}

export { parseNumberField }