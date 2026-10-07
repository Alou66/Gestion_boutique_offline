import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { settingsService } from '@/services'
import type { SettingsInput } from '@/types'

const inputClass =
  'mt-1 block w-full rounded-md border border-gray-500 shadow-sm focus:border-blue-500 focus:ring-blue-500'

type FormValues = {
  shopName: string
  address: string
  phone: string
  phone2: string
  ninea: string
  ownerName: string
}

function SettingsPage() {
  const navigate = useNavigate()
  const [form, setForm] = useState<FormValues | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const settings = await settingsService.get()

        if (settings) {
          if (!cancelled) {
            setForm({
              shopName: settings.shopName,
              address: settings.address ?? '',
              phone: settings.phone ?? '',
              phone2: settings.phone2 ?? '',
              ninea: settings.ninea ?? '',
              ownerName: settings.ownerName ?? '',
            })
          }
        }
      } catch {
        if (!cancelled) {
          setError('Les paramètres n\'ont pas pu être chargés.')
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    load()

    return () => {
      cancelled = true
    }
  }, [])

  const update =
    (field: keyof FormValues) => (event: React.ChangeEvent<HTMLInputElement>) => {
      setForm((current) =>
        current ? { ...current, [field]: event.target.value } : current,
      )
    }

  const toSettingsInput = (values: FormValues): SettingsInput => ({
    shopName: values.shopName,
    address: values.address || null,
    phone: values.phone || null,
    phone2: values.phone2 || null,
    ninea: values.ninea || null,
    ownerName: values.ownerName || null,
  })

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!form) {
      return
    }

    setError(null)
    setSuccess(null)
    setIsSubmitting(true)

    try {
      await settingsService.save(toSettingsInput(form))
      setSuccess('Paramètres enregistrés.')
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Enregistrement impossible.')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Paramètres de la boutique</h1>
        <p className="text-sm text-gray-500">Chargement…</p>
      </div>
    )
  }

  if (!form) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Paramètres de la boutique</h1>
        <p className="text-sm text-gray-500">
          Aucune configuration trouvée. Créez d'abord votre boutique depuis la page de configuration initiale.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Paramètres de la boutique</h1>
          <p className="text-sm text-gray-600">
            Ces informations apparaissent sur la facture et dans les documents de
            l'application.
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate('/dashboard')}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Retour
        </button>
      </div>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
      )}
      {success && (
        <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{success}</p>
      )}

      <form onSubmit={handleSubmit} className="space-y-8">
        <fieldset className="space-y-4 rounded-lg border bg-white p-6 shadow">
          <legend className="px-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
            Informations de la boutique
          </legend>

          <div>
            <label htmlFor="shopName" className="block text-sm font-medium text-gray-700">
              Nom de la boutique <span className="text-red-500">*</span>
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
            <label htmlFor="address" className="block text-sm font-medium text-gray-700">
              Adresse
            </label>
            <input
              id="address"
              name="address"
              type="text"
              value={form.address}
              onChange={update('address')}
              className={inputClass}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="phone" className="block text-sm font-medium text-gray-700">
                Téléphone 1
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
              <label htmlFor="phone2" className="block text-sm font-medium text-gray-700">
                Téléphone 2
              </label>
              <input
                id="phone2"
                name="phone2"
                type="tel"
                value={form.phone2}
                onChange={update('phone2')}
                className={inputClass}
              />
            </div>
          </div>

          <div>
            <label htmlFor="ninea" className="block text-sm font-medium text-gray-700">
              NINEA
            </label>
            <input
              id="ninea"
              name="ninea"
              type="text"
              value={form.ninea}
              onChange={update('ninea')}
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="ownerName" className="block text-sm font-medium text-gray-700">
              Votre nom complet (propriétaire)
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

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={() => navigate('/dashboard')}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Annuler
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </form>
    </div>
  )
}

export default SettingsPage