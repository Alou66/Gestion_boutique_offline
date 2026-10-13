import { useCallback } from 'react'

interface PaginationProps {
  page: number
  totalPages: number
  total: number
  itemLabel: string
  onPageChange: (page: number) => void
}

function Pagination({ page, totalPages, total, itemLabel, onPageChange }: PaginationProps) {
  const goToPrevious = useCallback(() => {
    onPageChange(Math.max(1, page - 1))
  }, [page, onPageChange])

  const goToNext = useCallback(() => {
    onPageChange(Math.min(totalPages, page + 1))
  }, [totalPages, onPageChange, page])

  const goToPage = useCallback(
    (targetPage: number) => {
      onPageChange(Math.min(Math.max(1, targetPage), totalPages))
    },
    [totalPages, onPageChange],
  )

  if (totalPages <= 1) {
    return null
  }

  const pages: number[] = []
  const start = Math.max(1, page - 2)
  const end = Math.min(totalPages, start + 4)

  for (let p = start; p <= end; p++) {
    pages.push(p)
  }

  return (
    <div className="flex flex-col flex-wrap items-center justify-between gap-3 sm:flex-row">
      <p className="text-sm text-gray-600">
        Page {page} / {totalPages} — {total} {itemLabel}
        {total > 1 ? 's' : ''}
      </p>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={goToPrevious}
          disabled={page === 1}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Précédente
        </button>

        {totalPages > 5 && (
          <div className="flex items-center gap-1">
            {pages.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => goToPage(p)}
                disabled={p === page}
                className={
                  p === page
                    ? 'rounded-md border border-blue-500 bg-blue-100 px-3 py-1.5 text-sm font-medium text-blue-700'
                    : 'rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50'
                }
              >
                {p}
              </button>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={goToNext}
          disabled={page === totalPages}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Suivante
        </button>
      </div>
    </div>
  )
}

export default Pagination
