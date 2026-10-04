import { z } from 'zod'

export const loginSchema = z.object({
  username: z.string().trim().min(1, "Le nom d'utilisateur est requis"),
  password: z.string().min(1, 'Le mot de passe est requis'),
})

export type LoginFormData = z.infer<typeof loginSchema>