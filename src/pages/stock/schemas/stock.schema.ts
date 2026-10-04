import { z } from 'zod'
import type { StockDirection } from '@/types'
import { normalizeFormLabel, pluralizeFormLabel } from '../../products/schemas/product.schema'

export const STOCK_QUANTITY_MAX = 1_000_000
export const STOCK_REASON_MAX_LENGTH = 200

/** Display messages, identical to electron/services/stockService.ts. */
export const STOCK_MESSAGES = {
  productNotFound: 'Produit introuvable.',
  productInactive: "Produit inactif : l'opération de stock est refusée.",
  formRequired: 'La forme est obligatoire.',
  formTooLong: `La forme ne peut pas dépasser 40 caractères.`,
  formInvalid: 'Forme invalide pour ce produit.',
  formsRequired: 'La quantité de la forme principale est obligatoire.',
  formsMismatch: "Les formes saisies ne correspondent pas aux formes du produit.",
  quantityRequired: 'La quantité est obligatoire.',
  quantityInvalid: 'La quantité doit être un entier supérieur ou égal à 0.',
  quantityTooHigh: 'La quantité ne peut pas dépasser 1 000 000.',
  positiveQuantityRequired:
    'Au moins une forme doit être initialisée avec une quantité supérieure à 0.',
  alreadyInitialized: 'Le stock de ce produit est déjà initialisé.',
  notInitialized:
    "Le stock de ce produit doit être initialisé avant de pouvoir être ajusté.",
  directionRequired: "Le sens de l'ajustement est obligatoire (entrée ou sortie).",
  directionInvalid: "Le sens de l'ajustement doit être 'IN' ou 'OUT'.",
  reasonRequired: 'Le motif est obligatoire pour un ajustement.',
  reasonTooLong: 'Le motif ne peut pas dépasser 200 caractères.',
  insufficientStock: 'Stock insuffisant pour cette opération.',
  unexpected: 'Une erreur inattendue est survenue.',
} as const

export const STOCK_DIRECTION_LABELS: Record<StockDirection, string> = {
  IN: 'Entrée',
  OUT: 'Sortie',
}

export const STOCK_MOVEMENT_LABELS = {
  STOCK_INITIAL: 'Stock initial',
  AJUSTEMENT: 'Ajustement',
} as const

/** Movement types already implemented: no other type can exist yet. */
export const VISIBLE_MOVEMENT_TYPES = ['STOCK_INITIAL', 'AJUSTEMENT'] as const

const formFieldSchema = z
  .string({ error: STOCK_MESSAGES.formRequired })
  .trim()
  .min(1, STOCK_MESSAGES.formRequired)
  .max(40, STOCK_MESSAGES.formTooLong)
  .transform(normalizeFormLabel)

/** 0 is allowed on a single form during an initialization, never on all of them. */
export const stockQuantityEntrySchema = z.object({
  form: formFieldSchema,
  quantity: z
    .number({ error: STOCK_MESSAGES.quantityRequired })
    .int(STOCK_MESSAGES.quantityInvalid)
    .min(0, STOCK_MESSAGES.quantityInvalid)
    .max(STOCK_QUANTITY_MAX, STOCK_MESSAGES.quantityTooHigh),
})

export const stockInitializeFormSchema = z
  .object({
    quantities: z.array(stockQuantityEntrySchema).min(1, STOCK_MESSAGES.formsRequired),
  })
  .refine(
    (values) => values.quantities.some((entry) => entry.quantity > 0),
    STOCK_MESSAGES.positiveQuantityRequired,
  )

export const stockAdjustFormSchema = z.object({
  form: formFieldSchema,
  direction: z.enum(['IN', 'OUT'], { error: STOCK_MESSAGES.directionRequired }),
  quantity: z
    .number({ error: STOCK_MESSAGES.quantityRequired })
    .int(STOCK_MESSAGES.quantityInvalid)
    .positive(STOCK_MESSAGES.quantityInvalid)
    .max(STOCK_QUANTITY_MAX, STOCK_MESSAGES.quantityTooHigh),
  reason: z
    .string({ error: STOCK_MESSAGES.reasonRequired })
    .trim()
    .min(1, STOCK_MESSAGES.reasonRequired)
    .max(STOCK_REASON_MAX_LENGTH, STOCK_MESSAGES.reasonTooLong),
})

export type StockInitializeFormData = z.infer<typeof stockInitializeFormSchema>
export type StockAdjustFormData = z.infer<typeof stockAdjustFormSchema>

export type StockInitializeFormErrors = Partial<Record<'quantities', string>>
export type StockAdjustFormErrors = Partial<
  Record<'form' | 'direction' | 'quantity' | 'reason', string>
>

/** Empty inputs stay `undefined` so the schema reports "obligatoire" instead of 0. */
export function parseNumberField(rawValue: string): number | undefined {
  const trimmed = rawValue.trim()

  if (trimmed === '') {
    return undefined
  }

  return Number(trimmed)
}

/** "10" -> "10 CARTONS" for the confirmation sentence. */
export function formatQuantityForForm(form: string, quantity: number): string {
  return `${quantity} ${pluralizeFormLabel(form)}`
}

export function formatMovementDate(createdAt: Date): string {
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(createdAt)
}