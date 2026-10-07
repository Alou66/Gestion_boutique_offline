import { useEffect, useMemo, useState } from 'react'
import type { KeyboardEvent } from 'react'
import {
  filterSelectOptions,
  MAX_DISPLAYED_OPTIONS,
} from './searchable-select'
import type { SearchableSelectOption } from './searchable-select'

interface SearchableSelectProps {
  id: string
  name: string
  value: string
  options: SearchableSelectOption[]
  placeholder?: string
  disabled?: boolean
  /** Valeur de l'option retenue, jamais le texte tapé. */
  onChange: (value: string) => void
}

/**
 * Champ de recherche avec liste déroulante, pour choisir parmi
 * beaucoup d'options (clients, produits) sans submerger le
 * formulaire : on tape ce qu'on cherche, on choisit au clavier
 * (flèches, Entrée, Échap) ou à la souris. La valeur rendue est
 * toujours celle d'une option, jamais le texte tapé.
 */
function SearchableSelect({
  id,
  name,
  value,
  options,
  placeholder = '',
  disabled = false,
  onChange,
}: SearchableSelectProps) {
  const [query, setQuery] = useState<string | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const listId = `${id}-list`

  const selected = options.find((option) => option.value === value) ?? null
  const filtered = useMemo(
    () => filterSelectOptions(options, query ?? ''),
    [options, query],
  )
  const visible = filtered.slice(0, MAX_DISPLAYED_OPTIONS)
  const hasMore = filtered.length > MAX_DISPLAYED_OPTIONS

  // Une valeur imposée de l'extérieur (produit choisi, client de la
  // facture modifiée) s'affiche à nouveau telle quelle.
  useEffect(() => {
    setQuery(null)
  }, [value])

  // Le choix au clavier repart du début quand la liste change.
  useEffect(() => {
    setActiveIndex(0)
  }, [filtered])

  const choose = (optionValue: string) => {
    setQuery(null)
    setIsOpen(false)
    onChange(optionValue)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (disabled) {
      return
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()

        if (!isOpen) {
          setIsOpen(true)
          return
        }

        setActiveIndex((current) =>
          visible.length === 0 ? 0 : (current + 1) % visible.length,
        )
        break
      case 'ArrowUp':
        event.preventDefault()

        if (!isOpen) {
          setIsOpen(true)
          return
        }

        setActiveIndex((current) =>
          visible.length === 0
            ? 0
            : (current - 1 + visible.length) % visible.length,
        )
        break
      case 'Enter':
        if (isOpen && visible[activeIndex]) {
          event.preventDefault()
          choose(visible[activeIndex].value)
        }
        break
      case 'Escape':
        if (isOpen) {
          event.preventDefault()
          setQuery(null)
          setIsOpen(false)
        }
        break
      case 'Tab':
        setIsOpen(false)
        break
      default:
        break
    }
  }

  return (
    <div className="relative">
      <input
        id={id}
        name={name}
        type="text"
        role="combobox"
        aria-expanded={isOpen}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          isOpen && visible[activeIndex] ? `${id}-option-${activeIndex}` : undefined
        }
        autoComplete="off"
        placeholder={placeholder}
        disabled={disabled}
        value={query ?? selected?.label ?? ''}
        onChange={(event) => {
          setQuery(event.target.value)
          setIsOpen(true)
        }}
        onFocus={() => setIsOpen(true)}
        onBlur={() => setIsOpen(false)}
        onKeyDown={handleKeyDown}
        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-60"
      />
      {isOpen && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border border-gray-200 bg-white py-1 shadow-lg"
        >
          {visible.length === 0 ? (
            <li className="px-4 py-2 text-sm text-gray-500">Aucun résultat</li>
          ) : (
            visible.map((option, index) => (
              <li
                key={option.value}
                id={`${id}-option-${index}`}
                role="option"
                aria-selected={option.value === value}
                // Le focus reste sur le champ : le clic choisit vraiment.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(option.value)}
                onMouseMove={() => setActiveIndex(index)}
                className={`cursor-pointer px-4 py-2 text-sm ${
                  index === activeIndex
                    ? 'bg-blue-50 font-medium text-blue-900'
                    : 'text-gray-900'
                }`}
              >
                <span className="block">{option.label}</span>
                {option.hint ? (
                  <span className="block text-xs text-gray-500">
                    {option.hint}
                  </span>
                ) : null}
              </li>
            ))
          )}
          {hasMore && (
            <li className="px-4 py-1 text-xs text-gray-500">
              … et {filtered.length - MAX_DISPLAYED_OPTIONS} autres :
              affinez la recherche
            </li>
          )}
        </ul>
      )}
    </div>
  )
}

export default SearchableSelect
