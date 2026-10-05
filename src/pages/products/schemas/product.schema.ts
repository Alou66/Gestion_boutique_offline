import { z } from 'zod'
import type { ProductInput } from '@/types'

export const PRODUCT_NAME_MIN_LENGTH = 2
export const PRODUCT_NAME_MAX_LENGTH = 120
export const PRODUCT_FORM_MAX_LENGTH = 40
export const PRODUCT_PRICE_MAX = 1_000_000_000

export const PRODUCT_MESSAGES = {
  nameRequired: 'Le nom du produit est obligatoire.',
  nameTooShort: `Le nom du produit doit contenir au moins ${PRODUCT_NAME_MIN_LENGTH} caractères.`,
  nameTooLong: `Le nom du produit ne peut pas dépasser ${PRODUCT_NAME_MAX_LENGTH} caractères.`,
  categoryRequired: 'La catégorie du produit est obligatoire.',
  purchasePriceInvalid: "Le prix d'achat doit être un entier supérieur ou égal à 0.",
  purchasePriceTooHigh: "Le prix d'achat ne peut pas dépasser 1 000 000 000 FCFA.",
  salePriceInvalid: 'Le prix de vente doit être un entier supérieur ou égal à 0.',
  salePriceTooHigh: 'Le prix de vente ne peut pas dépasser 1 000 000 000 FCFA.',
  primaryFormRequired: 'La forme principale est obligatoire.',
  primaryFormTooLong: `La forme principale ne peut pas dépasser ${PRODUCT_FORM_MAX_LENGTH} caractères.`,
  secondaryFormRequired: 'La forme secondaire est obligatoire.',
  secondaryFormTooLong: `La forme secondaire ne peut pas dépasser ${PRODUCT_FORM_MAX_LENGTH} caractères.`,
  formsMustDiffer: 'La forme principale et la forme secondaire doivent être différentes.',
  conversionQuantityRequired: 'La quantité de conversion est obligatoire.',
  conversionQuantityInvalid: 'La quantité de conversion doit être un entier supérieur à 0.',
  secondarySalePriceRequired: 'Le prix de vente secondaire est obligatoire.',
  secondarySalePriceInvalid:
    'Le prix de vente secondaire doit être un entier supérieur ou égal à 0.',
  secondarySalePriceTooHigh:
    'Le prix de vente secondaire ne peut pas dépasser 1 000 000 000 FCFA.',
  checking: 'Vérification…',
  nameAvailable: '✓ Nom disponible',
  nameTaken: '⚠ Ce produit existe déjà.',
  checkFailed: 'Impossible de vérifier la disponibilité',
  unexpected: 'Une erreur inattendue est survenue.',
} as const

/** Display form of a form label: identical to electron/services/productService.ts. */
export function normalizeFormLabel(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toUpperCase()
}

/** Compares both labels after normalization: "carton" and " CARTON " are the same. */
export function hasIdenticalForms(primaryForm: string, secondaryForm: string): boolean {
  return normalizeFormLabel(primaryForm) === normalizeFormLabel(secondaryForm)
}

/** Display only: SEAU -> SEAUX, CARTON -> CARTONS, PAQUETS -> PAQUETS. */
export function pluralizeFormLabel(formLabel: string): string {
  const label = normalizeFormLabel(formLabel)

  if (label.endsWith('S')) {
    return label
  }

  return label.endsWith('AU') ? `${label}X` : `${label}S`
}

const productNameSchema = z
  .string({ error: PRODUCT_MESSAGES.nameRequired })
  .trim()
  .min(1, PRODUCT_MESSAGES.nameRequired)
  .max(PRODUCT_NAME_MAX_LENGTH, PRODUCT_MESSAGES.nameTooLong)
  .refine((name) => name.length >= PRODUCT_NAME_MIN_LENGTH, PRODUCT_MESSAGES.nameTooShort)

const categoryIdSchema = z
  .number({ error: PRODUCT_MESSAGES.categoryRequired })
  .int(PRODUCT_MESSAGES.categoryRequired)
  .positive(PRODUCT_MESSAGES.categoryRequired)

const purchasePriceSchema = z
  .number({ error: PRODUCT_MESSAGES.purchasePriceInvalid })
  .int(PRODUCT_MESSAGES.purchasePriceInvalid)
  .min(0, PRODUCT_MESSAGES.purchasePriceInvalid)
  .max(PRODUCT_PRICE_MAX, PRODUCT_MESSAGES.purchasePriceTooHigh)

const salePriceSchema = z
  .number({ error: PRODUCT_MESSAGES.salePriceInvalid })
  .int(PRODUCT_MESSAGES.salePriceInvalid)
  .min(0, PRODUCT_MESSAGES.salePriceInvalid)
  .max(PRODUCT_PRICE_MAX, PRODUCT_MESSAGES.salePriceTooHigh)

const secondarySalePriceSchema = z
  .number({ error: PRODUCT_MESSAGES.secondarySalePriceRequired })
  .int(PRODUCT_MESSAGES.secondarySalePriceInvalid)
  .min(0, PRODUCT_MESSAGES.secondarySalePriceInvalid)
  .max(PRODUCT_PRICE_MAX, PRODUCT_MESSAGES.secondarySalePriceTooHigh)

const conversionQuantitySchema = z
  .number({ error: PRODUCT_MESSAGES.conversionQuantityRequired })
  .int(PRODUCT_MESSAGES.conversionQuantityInvalid)
  .positive(PRODUCT_MESSAGES.conversionQuantityInvalid)

function buildFormFieldSchema(requiredMessage: string, tooLongMessage: string) {
  return z
    .string({ error: requiredMessage })
    .trim()
    .min(1, requiredMessage)
    .max(PRODUCT_FORM_MAX_LENGTH, tooLongMessage)
}

const primaryFormSchema = buildFormFieldSchema(
  PRODUCT_MESSAGES.primaryFormRequired,
  PRODUCT_MESSAGES.primaryFormTooLong,
)

const secondaryFormSchema = buildFormFieldSchema(
  PRODUCT_MESSAGES.secondaryFormRequired,
  PRODUCT_MESSAGES.secondaryFormTooLong,
)

const commonProductFields = {
  name: productNameSchema,
  categoryId: categoryIdSchema,
  purchasePrice: purchasePriceSchema,
  salePrice: salePriceSchema,
}

/**
 * Mirrors electron/services/productService.ts: a simple product carries its
 * single logical form in `primaryForm`, the transformation fields are only
 * required when the product is transformable. The main process stays the
 * authority and validates again before writing to SQLite, and it is also the
 * place where the name and the form labels are normalized (trim + upper case).
 */
export const productFormSchema = z.discriminatedUnion('isTransformable', [
  z.object({
    ...commonProductFields,
    isTransformable: z.literal(false),
    primaryForm: primaryFormSchema,
  }),
  z.object({
    ...commonProductFields,
    isTransformable: z.literal(true),
    primaryForm: primaryFormSchema,
    secondaryForm: secondaryFormSchema,
    conversionQuantity: conversionQuantitySchema,
    secondarySalePrice: secondarySalePriceSchema,
  }),
])

export type ProductFormData = z.infer<typeof productFormSchema>

export type ProductFormErrors = Partial<
  Record<
    | 'name'
    | 'categoryId'
    | 'purchasePrice'
    | 'salePrice'
    | 'primaryForm'
    | 'secondaryForm'
    | 'conversionQuantity'
    | 'secondarySalePrice',
    string
  >
>

/** Empty inputs stay `undefined` so the schema reports "obligatoire" instead of 0. */
export function parseNumberField(rawValue: string): number | undefined {
  const trimmed = rawValue.trim()

  if (trimmed === '') {
    return undefined
  }

  return Number(trimmed)
}

/** Shapes the validated form data into the payload expected by the main process. */
export function toProductInput(values: ProductFormData): ProductInput {
  if (!values.isTransformable) {
    return {
      name: values.name,
      categoryId: values.categoryId,
      purchasePrice: values.purchasePrice,
      salePrice: values.salePrice,
      isTransformable: false,
      primaryForm: values.primaryForm,
      secondaryForm: null,
      conversionQuantity: null,
      secondarySalePrice: null,
    }
  }

  return {
    name: values.name,
    categoryId: values.categoryId,
    purchasePrice: values.purchasePrice,
    salePrice: values.salePrice,
    isTransformable: true,
    primaryForm: values.primaryForm,
    secondaryForm: values.secondaryForm,
    conversionQuantity: values.conversionQuantity,
    secondarySalePrice: values.secondarySalePrice,
  }
}
