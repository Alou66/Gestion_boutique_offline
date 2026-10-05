import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PasswordInput } from '@/components'
import { useAuth } from '@/hooks/useAuth'
import { PASSWORD_MIN_LENGTH, setupSchema } from './schemas/setup.schema'
import type { SetupFormData } from './schemas/setup.schema'

const initialForm: SetupFormData = {
  shopName: '',
  phone: '',
  ownerName: '',
  username: '',
  password: '',
  passwordConfirmation: '',
}

const inputClass =
  'mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500'

function Setup() {
  const [form, setForm] = useState<SetupFormData>(initialForm)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const { setup } = useAuth()
  const navigate = useNavigate()

  const update =
    (field: keyof SetupFormData) => (event: React.ChangeEvent<HTMLInputElement>) => {
      setForm((current) => ({ ...current, [field]: event.target.value }))
    }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)

    const result = setupSchema.safeParse(form)
    if (!result.success) {
      setError(result.error.issues[0].message)
      return
    }

    setIsSubmitting(true)
    try {
      const response = await setup({
        shopName: result.data.shopName,
        phone: result.data.phone,
        ownerName: result.data.ownerName,
        username: result.data.username,
        password: result.data.password,
      })

      if (!response.success) {
        setError(response.error)
        return
      }

      navigate('/dashboard', { replace: true })
    } catch {
      setError('La configuration initiale a échoué.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 py-10">
      <div className="w-full max-w-lg space-y-8 rounded-lg bg-white p-8 shadow">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-bold">Configuration initiale</h1>
          <p className="text-sm text-gray-600">
            Créez votre boutique et votre compte. Ces informations restent
            uniquement sur cet ordinateur.
          </p>
        </div>

        {error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </p>
        )}

        <form onSubmit={handleSubmit} className="space-y-8">
          <fieldset className="space-y-4">
            <legend className="text-sm font-semibold uppercase tracking-wide text-gray-500">
              Boutique
            </legend>

            <div>
              <label
                htmlFor="shopName"
                className="block text-sm font-medium text-gray-700"
              >
                Nom de la boutique
              </label>
              <input
                id="shopName"
                name="shopName"
                type="text"
                value={form.shopName}
                onChange={update('shopName')}
                className={inputClass}
                required
              />
            </div>

            <div>
              <label
                htmlFor="phone"
                className="block text-sm font-medium text-gray-700"
              >
                Téléphone
              </label>
              <input
                id="phone"
                name="phone"
                type="tel"
                value={form.phone}
                onChange={update('phone')}
                className={inputClass}
              />
            </div>

            <div>
              <label
                htmlFor="ownerName"
                className="block text-sm font-medium text-gray-700"
              >
                Nom du propriétaire
              </label>
              <input
                id="ownerName"
                name="ownerName"
                type="text"
                value={form.ownerName}
                onChange={update('ownerName')}
                className={inputClass}
              />
            </div>
          </fieldset>

          <fieldset className="space-y-4">
            <legend className="text-sm font-semibold uppercase tracking-wide text-gray-500">
              Compte
            </legend>

            <div>
              <label
                htmlFor="username"
                className="block text-sm font-medium text-gray-700"
              >
                Nom d'utilisateur
              </label>
              <input
                id="username"
                name="username"
                type="text"
                autoComplete="username"
                value={form.username}
                onChange={update('username')}
                className={inputClass}
                required
              />
            </div>

            <PasswordInput
              id="password"
              name="password"
              label="Mot de passe"
              value={form.password}
              onChange={update('password')}
              autoComplete="new-password"
              required
              className={inputClass}
              hint={`${PASSWORD_MIN_LENGTH} caractères minimum, avec au moins une lettre et un chiffre.`}
            />

            <PasswordInput
              id="passwordConfirmation"
              name="passwordConfirmation"
              label="Confirmer le mot de passe"
              value={form.passwordConfirmation}
              onChange={update('passwordConfirmation')}
              autoComplete="new-password"
              required
              className={inputClass}
            />
          </fieldset>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-md bg-blue-600 py-2 px-4 text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? 'Création…' : 'Créer la boutique'}
          </button>
        </form>
      </div>
    </div>
  )
}

export default Setup