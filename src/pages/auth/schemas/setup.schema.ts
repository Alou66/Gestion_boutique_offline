import { z } from 'zod'

export const PASSWORD_MIN_LENGTH = 8

export const setupSchema = z
  .object({
    shopName: z
      .string()
      .trim()
      .min(1, 'Le nom de la boutique est requis')
      .max(120, 'Le nom de la boutique est trop long'),
    address: z.string().trim().max(200, 'L\'adresse est trop longue'),
    phone: z
      .string()
      .trim()
      .max(40, 'Le numéro de téléphone est trop long'),
    phone2: z.string().trim().max(40, 'Le deuxième numéro de téléphone est trop long'),
    ninea: z.string().trim().max(40, 'Le NINEA est trop long'),
    ownerName: z.string().trim().max(120, 'Le nom est trop long'),
    username: z
      .string()
      .trim()
      .min(3, "Le nom d'utilisateur doit contenir au moins 3 caractères")
      .max(50, "Le nom d'utilisateur est trop long")
      .regex(
        /^[a-zA-Z0-9._-]+$/,
        "L'utilisateur ne peut contenir que lettres, chiffres, . _ et -",
      ),
    password: z
      .string()
      .min(PASSWORD_MIN_LENGTH, `Le mot de passe doit contenir au moins ${PASSWORD_MIN_LENGTH} caractères`)
      .max(200, 'Le mot de passe est trop long')
      .regex(/[A-Za-z]/, 'Le mot de passe doit contenir au moins une lettre')
      .regex(/[0-9]/, 'Le mot de passe doit contenir au moins un chiffre'),
    passwordConfirmation: z.string().min(1, 'Confirmez le mot de passe'),
  })
  .refine((data) => data.password === data.passwordConfirmation, {
    message: 'Les mots de passe ne correspondent pas',
    path: ['passwordConfirmation'],
  })

export type SetupFormData = z.infer<typeof setupSchema>