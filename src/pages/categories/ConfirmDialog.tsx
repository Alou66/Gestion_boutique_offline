interface ConfirmDialogProps {
  title: string
  message: string
  confirmLabel: string
  confirmingLabel?: string
  cancelLabel?: string
  /**
   * Danger (red) for an irreversible removal, primary (blue) for a positive
   * action. Defaults to danger so the existing call sites stay unchanged.
   */
  confirmTone?: 'danger' | 'primary'
  isConfirming?: boolean
  onConfirm: () => void
  onCancel: () => void
}

const CONFIRM_TONE_CLASSES = {
  danger: 'bg-red-600 hover:bg-red-700',
  primary: 'bg-blue-600 hover:bg-blue-700',
} as const

function ConfirmDialog({
  title,
  message,
  confirmLabel,
  confirmingLabel = 'Suppression…',
  cancelLabel = 'Annuler',
  confirmTone = 'danger',
  isConfirming = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <div className="w-full max-w-sm space-y-4 rounded-lg bg-white p-6 shadow-xl">
        <h2 id="confirm-dialog-title" className="text-lg font-semibold">
          {title}
        </h2>
        <p className="whitespace-pre-line text-sm text-gray-600">{message}</p>
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isConfirming}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isConfirming}
            className={`rounded-md px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60 ${CONFIRM_TONE_CLASSES[confirmTone]}`}
          >
            {isConfirming ? confirmingLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ConfirmDialog
