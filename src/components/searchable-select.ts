export interface SearchableSelectOption {
  value: string
  label: string
  /** Indice secondaire (téléphone, catégorie) : affiché et cherchable. */
  hint?: string
}

/** Options affichées au maximum : au-delà, on affine la recherche. */
export const MAX_DISPLAYED_OPTIONS = 100

/**
 * Recherche insensible à la casse, aux espaces et aux accents :
 * « lait » trouve « LAIT concentré ».
 */
export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

/** Les options dont le libellé ou l'indice contient la recherche. */
export function filterSelectOptions(
  options: SearchableSelectOption[],
  query: string,
): SearchableSelectOption[] {
  const normalized = normalizeSearchText(query)

  if (normalized === '') {
    return options
  }

  return options.filter((option) => {
    const haystack = `${normalizeSearchText(option.label)} ${normalizeSearchText(
      option.hint ?? '',
    )}`

    return haystack.includes(normalized)
  })
}
