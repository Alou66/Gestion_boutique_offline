export const PAGINATION_PER_PAGE = 10

export interface Page<T> {
  rows: T[]
  page: number
  totalPages: number
  total: number
}

export function paginate<T>(
  items: T[],
  page: number,
  perPage: number = PAGINATION_PER_PAGE,
): Page<T> {
  const total = items.length
  const totalPages = Math.max(1, Math.ceil(total / perPage))
  const currentPage = Math.min(Math.max(1, page), totalPages)
  const start = (currentPage - 1) * perPage

  return {
    rows: items.slice(start, start + perPage),
    page: currentPage,
    totalPages,
    total,
  }
}
