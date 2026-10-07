import { z } from 'zod'

export const SUPPLIER_NAME_MIN_LENGTH = 2
export const SUPPLIER_NAME_MAX_LENGTH = 120
export const SUPPLIER_PHONE_MIN_DIGITS = 9
export const SUPPLIER_PHONE_MAX_LENGTH = 20
export const SUPPLIER_ADDRESS_MAX_LENGTH = 255

export const SUPPLIER_MESSAGES = {
  nameRequired: 'Le nom du fournisseur est obligatoire.',
  nameTooShort: `Le nom du fournisseur doit contenir au moins ${SUPPLIER_NAME_MIN_LENGTH} caractères.`,
  nameTooLong: `Le nom du fournisseur ne peut pas dépasser ${SUPPLIER_NAME_MAX_LENGTH} caractères.`,
  phoneRequired: 'Le téléphone du fournisseur est obligatoire.',
  phoneTooShort: `Le numéro de téléphone doit contenir au moins ${SUPPLIER_PHONE_MIN_DIGITS} chiffres.`,
  phoneTooLong: `Le numéro de téléphone ne peut pas dépasser ${SUPPLIER_PHONE_MAX_LENGTH} caractères.`,
  phoneInvalid: 'Le numéro de téléphone est invalide (format sénégalais attendu).',
  addressTooLong: `L'adresse ne peut pas dépasser ${SUPPLIER_ADDRESS_MAX_LENGTH} caractères.`,
  checking: 'Vérification…',
  nameAvailable: '✓ Nom disponible',
  nameTaken: '⚠ Ce nom de fournisseur existe déjà.',
  phoneAvailable: '✓ Téléphone disponible',
  phoneTaken: '⚠ Ce numéro de téléphone est déjà utilisé.',
  checkFailed: 'Impossible de vérifier la disponibilité',
  unexpected: 'Une erreur inattendue est survenue.',
} as const

/**
 * Phone normalization: mirrors electron/services/supplierService.ts.
 * Removes spaces, dashes, parentheses, dots.
 * Valid Senegalese formats: 9 digits, +221XXXXXXXXX, 221XXXXXXXXX
 */
export function normalizePhone(rawPhone: string): string {
  const cleaned = rawPhone.trim().replace(/[\s\-().]/g, '')

  if (cleaned.startsWith('+221')) {
    return cleaned
  }

  if (cleaned.startsWith('221') && cleaned.length === 12) {
    return '+' + cleaned
  }

  if (/^\d{9}$/.test(cleaned)) {
    return '+221' + cleaned
  }

  return cleaned
}

/**
 * Checks if a phone number is a valid Senegalese format after normalization.
 */
export function isValidSenegalesePhone(phone: string): boolean {
  const normalized = normalizePhone(phone)
  return /^\+221\d{9}$/.test(normalized) || /^\d{9}$/.test(normalized)
}

const nameSchema = z
  .string({ error: SUPPLIER_MESSAGES.nameRequired })
  .trim()
  .min(1, SUPPLIER_MESSAGES.nameRequired)
  .max(SUPPLIER_NAME_MAX_LENGTH, SUPPLIER_MESSAGES.nameTooLong)
  .refine((name) => name.length >= SUPPLIER_NAME_MIN_LENGTH, SUPPLIER_MESSAGES.nameTooShort)

const phoneSchema = z
  .string({ error: SUPPLIER_MESSAGES.phoneRequired })
  .trim()
  .min(1, SUPPLIER_MESSAGES.phoneRequired)
  .max(SUPPLIER_PHONE_MAX_LENGTH, SUPPLIER_MESSAGES.phoneTooLong)
  .refine((phone) => isValidSenegalesePhone(phone), SUPPLIER_MESSAGES.phoneInvalid)

const addressSchema = z
  .string()
  .trim()
  .max(SUPPLIER_ADDRESS_MAX_LENGTH, SUPPLIER_MESSAGES.addressTooLong)
  .optional()
  .nullable()

export const supplierSchema = z.object({
  name: nameSchema,
  phone: phoneSchema,
  address: addressSchema,
})

export type SupplierFormData = z.infer<typeof supplierSchema>

export type SupplierFieldErrors = Partial<
  Record<'name' | 'phone' | 'address', string>
>
