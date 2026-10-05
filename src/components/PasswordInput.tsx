import { useState } from 'react'
import type { ChangeEvent } from 'react'

interface PasswordInputProps {
  id: string
  name: string
  label: string
  value: string
  onChange: (event: ChangeEvent<HTMLInputElement>) => void
  autoComplete: string
  required?: boolean
  className?: string
  /** Optional hint rendered under the field. */
  hint?: string
}

const eyeIcon = (
  <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
)
const eyeOffIcon = (
  <>
    <path d="M3 3l18 18" />
    <path d="M10.6 6.1A9.9 9.9 0 0112 6c6 0 9.5 6 9.5 6a17 17 0 01-3.3 3.9" />
    <path d="M6.6 7.6A16.8 16.8 0 002.5 12S6 18 12 18a9.6 9.6 0 003.9-.8" />
    <path d="M9.9 10a2.8 2.8 0 004 4" />
  </>
)

/**
 * Password field with a visibility toggle: the shopkeeper can check what he
 * typed without leaving the login form. The icon is a button, so it never
 * submits the form and keeps the native `required` validation.
 */
function PasswordInput({
  id,
  name,
  label,
  value,
  onChange,
  autoComplete,
  required = false,
  className = '',
  hint,
}: PasswordInputProps) {
  const [isVisible, setIsVisible] = useState(false)

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-700">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          name={name}
          type={isVisible ? 'text' : 'password'}
          autoComplete={autoComplete}
          value={value}
          onChange={onChange}
          required={required}
          className={`pr-10 ${className}`}
        />
        <button
          type="button"
          onClick={() => setIsVisible((current) => !current)}
          aria-label={isVisible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
          aria-pressed={isVisible}
          title={isVisible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
          className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 transition-colors hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-5 w-5"
          >
            {isVisible ? eyeIcon : eyeOffIcon}
          </svg>
        </button>
      </div>
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  )
}

export default PasswordInput