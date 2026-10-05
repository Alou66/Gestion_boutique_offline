import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { Client, ClientInput, ClientUpdateInput } from '@/types'
import { clientService } from '@/services'
import {
  CLIENT_MESSAGES,
  CLIENT_NAME_MAX_LENGTH,
  CLIENT_PHONE_MAX_LENGTH,
  CLIENT_ADDRESS_MAX_LENGTH,
  CLIENT_NAME_MIN_LENGTH,
  CLIENT_PHONE_MIN_DIGITS,
  clientSchema,
  isValidSenegalesePhone,
} from './schemas/client.schema'
import type { ClientFieldErrors } from './schemas/client.schema'

interface ClientFormProps {
  title: string
  submitLabel: string
  initialClient?: Client | null
  isSubmitting: boolean
  error: string | null
  onSubmit: (input: ClientInput | ClientUpdateInput) => void
  onCancel: () => void
}

const DEBOUNCE_MS = 400

// Server-side duplicate error messages (from CLIENT_ERRORS in electron/services/clientService.ts)
const SERVER_DUPLICATE_NAME = 'Ce nom de client existe déjà.'
const SERVER_DUPLICATE_PHONE = 'Ce numéro de téléphone est déjà utilisé.'

function ClientForm({
  title,
  submitLabel,
  initialClient = null,
  isSubmitting,
  error,
  onSubmit,
  onCancel,
}: ClientFormProps) {
  const [name, setName] = useState(initialClient?.name ?? '')
  const [phone, setPhone] = useState(initialClient?.phone ?? '')
  const [address, setAddress] = useState(initialClient?.address ?? '')
  const [fieldErrors, setFieldErrors] = useState<ClientFieldErrors>({})
  const [nameAvailability, setNameAvailability] = useState<'idle' | 'checking' | 'available' | 'taken' | 'error'>('idle')
  const [phoneAvailability, setPhoneAvailability] = useState<'idle' | 'checking' | 'available' | 'taken' | 'error'>('idle')
  const [formError, setFormError] = useState<string | null>(null)

  const nameDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const phoneDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const checkNameAvailability = useCallback(async (value: string, excludeId?: number) => {
    if (!value || value.trim().length < CLIENT_NAME_MIN_LENGTH) {
      setNameAvailability('idle')
      return
    }

    setNameAvailability('checking')

    try {
      const available = await clientService.isNameAvailable(value.trim(), excludeId)
      console.log('[ClientForm] available =', available, typeof available)
      setNameAvailability(available ? 'available' : 'taken')
    } catch {
      setNameAvailability('error')
    }
  }, [])

  const checkPhoneAvailability = useCallback(async (value: string, excludeId?: number) => {
    if (!value || value.trim().length < CLIENT_PHONE_MIN_DIGITS) {
      setPhoneAvailability('idle')
      return
    }

    if (!isValidSenegalesePhone(value)) {
      setPhoneAvailability('idle')
      return
    }

    setPhoneAvailability('checking')

    try {
      const available = await clientService.isPhoneAvailable(value.trim(), excludeId)
      setPhoneAvailability(available ? 'available' : 'taken')
    } catch {
      setPhoneAvailability('error')
    }
  }, [])

  const handleNameChange = (value: string) => {
    setName(value)
    setFieldErrors((prev) => ({ ...prev, name: undefined }))

    if (nameDebounceRef.current) {
      clearTimeout(nameDebounceRef.current)
    }

    nameDebounceRef.current = setTimeout(() => {
      checkNameAvailability(value, initialClient?.id)
    }, DEBOUNCE_MS)
  }

  const handlePhoneChange = (value: string) => {
    setPhone(value)
    setFieldErrors((prev) => ({ ...prev, phone: undefined }))

    if (phoneDebounceRef.current) {
      clearTimeout(phoneDebounceRef.current)
    }

    phoneDebounceRef.current = setTimeout(() => {
      checkPhoneAvailability(value, initialClient?.id)
    }, DEBOUNCE_MS)
  }

  const handleAddressChange = (value: string) => {
    setAddress(value)
    setFieldErrors((prev) => ({ ...prev, address: undefined }))
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const rawData = { name, phone, address }
    const parsed = clientSchema.safeParse(rawData)

    if (!parsed.success) {
      const nextErrors: ClientFieldErrors = {}

      for (const issue of parsed.error.issues) {
        const field = issue.path[0]
        if (typeof field === 'string' && !nextErrors[field as keyof ClientFieldErrors]) {
          nextErrors[field as keyof ClientFieldErrors] = issue.message
        }
      }

      setFieldErrors(nextErrors)
      return
    }

    if (nameAvailability === 'taken') {
      setFieldErrors((prev) => ({ ...prev, name: CLIENT_MESSAGES.nameTaken }))
      return
    }

    if (phoneAvailability === 'taken') {
      setFieldErrors((prev) => ({ ...prev, phone: CLIENT_MESSAGES.phoneTaken }))
      return
    }

    setFieldErrors({})
    setFormError(null)
    onSubmit(parsed.data)
  }

  const displayedError = formError ?? (error && error !== SERVER_DUPLICATE_NAME && error !== SERVER_DUPLICATE_PHONE ? error : null)

  const nameStatusIcon = () => {
    switch (nameAvailability) {
      case 'checking':
        return <span className="text-blue-600">⟳</span>
      case 'available':
        return <span className="text-green-600">✓</span>
      case 'taken':
        return <span className="text-amber-600">⚠</span>
      case 'error':
        return <span className="text-gray-500">?</span>
      default:
        return null
    }
  }

  const phoneStatusIcon = () => {
    switch (phoneAvailability) {
      case 'checking':
        return <span className="text-blue-600">⟳</span>
      case 'available':
        return <span className="text-green-600">✓</span>
      case 'taken':
        return <span className="text-amber-600">⚠</span>
      case 'error':
        return <span className="text-gray-500">?</span>
      default:
        return null
    }
  }

  const nameStatusText = () => {
    switch (nameAvailability) {
      case 'checking':
        return <span className="text-blue-600">{CLIENT_MESSAGES.checking}</span>
      case 'available':
        return <span className="text-green-600">{CLIENT_MESSAGES.nameAvailable}</span>
      case 'taken':
        return <span className="text-amber-600">{CLIENT_MESSAGES.nameTaken}</span>
      case 'error':
        return <span className="text-gray-500">{CLIENT_MESSAGES.checkFailed}</span>
      default:
        return null
    }
  }

  const phoneStatusText = () => {
    switch (phoneAvailability) {
      case 'checking':
        return <span className="text-blue-600">{CLIENT_MESSAGES.checking}</span>
      case 'available':
        return <span className="text-green-600">{CLIENT_MESSAGES.phoneAvailable}</span>
      case 'taken':
        return <span className="text-amber-600">{CLIENT_MESSAGES.phoneTaken}</span>
      case 'error':
        return <span className="text-gray-500">{CLIENT_MESSAGES.checkFailed}</span>
      default:
        return null
    }
  }

  const isSubmitDisabled =
    isSubmitting ||
    nameAvailability === 'taken' ||
    phoneAvailability === 'taken' ||
    nameAvailability === 'checking' ||
    phoneAvailability === 'checking'

  useEffect(() => {
    return () => {
      if (nameDebounceRef.current) clearTimeout(nameDebounceRef.current)
      if (phoneDebounceRef.current) clearTimeout(phoneDebounceRef.current)
    }
  }, [])

  // Convert server-side duplicate errors to field errors
  useEffect(() => {
    if (!error) return

    if (error === SERVER_DUPLICATE_NAME) {
      setFieldErrors((prev) => ({ ...prev, name: CLIENT_MESSAGES.nameTaken }))
    } else if (error === SERVER_DUPLICATE_PHONE) {
      setFieldErrors((prev) => ({ ...prev, phone: CLIENT_MESSAGES.phoneTaken }))
    }
  }, [error])

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border bg-white p-6 shadow">
      <h2 className="text-lg font-semibold">{title}</h2>

      <div>
        <label htmlFor="client-name" className="block text-sm font-medium text-gray-700">
          Nom <span className="text-red-500">*</span>
        </label>
        <div className="mt-1 flex items-center gap-2">
          <input
            id="client-name"
            name="name"
            type="text"
            maxLength={CLIENT_NAME_MAX_LENGTH}
            value={name}
            onChange={(event) => handleNameChange(event.target.value)}
            style={{ textTransform: 'uppercase' }}
            disabled={isSubmitting}
            className="flex-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-60"
          />
          {nameStatusIcon()}
        </div>
        {nameStatusText() && (
          <p className="mt-1 text-sm">{nameStatusText()}</p>
        )}
        {fieldErrors.name && <p className="mt-1 text-sm text-red-600">{fieldErrors.name}</p>}
      </div>

      <div>
        <label htmlFor="client-phone" className="block text-sm font-medium text-gray-700">
          Téléphone <span className="text-red-500">*</span>
        </label>
        <div className="mt-1 flex items-center gap-2">
          <input
            id="client-phone"
            name="phone"
            type="tel"
            maxLength={CLIENT_PHONE_MAX_LENGTH}
            value={phone}
            onChange={(event) => handlePhoneChange(event.target.value)}
            placeholder="77 123 45 67"
            disabled={isSubmitting}
            className="flex-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-60"
          />
          {phoneStatusIcon()}
        </div>
        {phoneStatusText() && (
          <p className="mt-1 text-sm">{phoneStatusText()}</p>
        )}
        {fieldErrors.phone && <p className="mt-1 text-sm text-red-600">{fieldErrors.phone}</p>}
        <p className="mt-1 text-xs text-gray-500">
          Formats acceptés : 77 123 45 67, +221771234567, 221771234567
        </p>
      </div>

      <div>
        <label htmlFor="client-address" className="block text-sm font-medium text-gray-700">
          Adresse
        </label>
        <textarea
          id="client-address"
          name="address"
          maxLength={CLIENT_ADDRESS_MAX_LENGTH}
          value={address}
          onChange={(event) => handleAddressChange(event.target.value)}
          placeholder="Pikine, Dakar"
          rows={3}
          disabled={isSubmitting}
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-60"
        />
        {fieldErrors.address && <p className="mt-1 text-sm text-red-600">{fieldErrors.address}</p>}
      </div>

      {displayedError && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{displayedError}</p>
      )}

      <div className="flex justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
        >
          Annuler
        </button>
        <button
          type="submit"
          disabled={isSubmitDisabled}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? 'Enregistrement…' : submitLabel}
        </button>
      </div>
    </form>
  )
}

export default ClientForm