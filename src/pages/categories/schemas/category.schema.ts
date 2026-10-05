import { z } from 'zod'

export const CATEGORY_NAME_MIN_LENGTH = 2
export const CATEGORY_NAME_MAX_LENGTH = 60

export const CATEGORY_MESSAGES = {
  nameRequired: 'Le nom de la catégorie est obligatoire.',
  nameTooShort: `Le nom de la catégorie doit contenir au moins ${CATEGORY_NAME_MIN_LENGTH} caractères.`,
  nameTooLong: `Le nom de la catégorie ne peut pas dépasser ${CATEGORY_NAME_MAX_LENGTH} caractères.`,
  checking: 'Vérification…',
  nameAvailable: '✓ Nom disponible',
  nameTaken: '⚠ Cette catégorie existe déjà.',
  checkFailed: 'Impossible de vérifier la disponibilité',
  unexpected: 'Une erreur inattendue est survenue.',
} as const

// Mirrors electron/services/categoryService.ts. The main process remains the
// authority: it normalizes and validates again before writing to SQLite.
export const categorySchema = z.object({
  name: z
    .string({ error: CATEGORY_MESSAGES.nameRequired })
    .trim()
    .min(1, CATEGORY_MESSAGES.nameRequired)
    .max(CATEGORY_NAME_MAX_LENGTH, CATEGORY_MESSAGES.nameTooLong)
    .refine((name) => name.length >= CATEGORY_NAME_MIN_LENGTH, CATEGORY_MESSAGES.nameTooShort),
})

export type CategoryFormData = z.infer<typeof categorySchema>
