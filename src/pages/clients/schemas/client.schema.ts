import { z } from 'zod'

export const CLIENT_NAME_MIN_LENGTH = 2
export const CLIENT_NAME_MAX_LENGTH = 120
export const CLIENT_PHONE_MIN_DIGITS = 9
export const CLIENT_PHONE_MAX_LENGTH = 20
export const CLIENT_ADDRESS_MAX_LENGTH = 255

export const CLIENT_MESSAGES = {
  nameRequired: 'Le nom du client est obligatoire.',
  nameTooShort: `Le nom du client doit contenir au moins ${CLIENT_NAME_MIN_LENGTH} caractères.`,
  nameTooLong: `Le nom du client ne peut pas dépasser ${CLIENT_NAME_MAX_LENGTH} caractères.`,
  phoneRequired: 'Le téléphone du client est obligatoire.',
  phoneTooShort: `Le numéro de téléphone doit contenir au moins ${CLIENT_PHONE_MIN_DIGITS} chiffres.`,
  phoneTooLong: `Le numéro de téléphone ne peut pas dépasser ${CLIENT_PHONE_MAX_LENGTH} caractères.`,
  phoneInvalid: 'Le numéro de téléphone est invalide (format sénégalais attendu).',
  addressTooLong: `L'adresse ne peut pas dépasser ${CLIENT_ADDRESS_MAX_LENGTH} caractères.`,
  checking: 'Vérification…',
  nameAvailable: '✓ Nom disponible',
  nameTaken: '⚠ Ce nom de client existe déjà.',
  phoneAvailable: '✓ Téléphone disponible',
  phoneTaken: '⚠ Ce numéro de téléphone est déjà utilisé.',
  checkFailed: 'Impossible de vérifier la disponibilité',
  unexpected: 'Une erreur inattendue est survenue.',
} as const

/**
 * Phone normalization: mirrors electron/services/clientService.ts.
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
  .string({ error: CLIENT_MESSAGES.nameRequired })
  .trim()
  .min(1, CLIENT_MESSAGES.nameRequired)
  .max(CLIENT_NAME_MAX_LENGTH, CLIENT_MESSAGES.nameTooLong)
  .refine((name) => name.length >= CLIENT_NAME_MIN_LENGTH, CLIENT_MESSAGES.nameTooShort)

const phoneSchema = z
  .string({ error: CLIENT_MESSAGES.phoneRequired })
  .trim()
  .min(1, CLIENT_MESSAGES.phoneRequired)
  .max(CLIENT_PHONE_MAX_LENGTH, CLIENT_MESSAGES.phoneTooLong)
  .refine((phone) => isValidSenegalesePhone(phone), CLIENT_MESSAGES.phoneInvalid)

const addressSchema = z
  .string()
  .trim()
  .max(CLIENT_ADDRESS_MAX_LENGTH, CLIENT_MESSAGES.addressTooLong)
  .optional()
  .nullable()

export const clientSchema = z.object({
  name: nameSchema,
  phone: phoneSchema,
  address: addressSchema,
})

export type ClientFormData = z.infer<typeof clientSchema>

export type ClientFieldErrors = Partial<
  Record<'name' | 'phone' | 'address', string>
>