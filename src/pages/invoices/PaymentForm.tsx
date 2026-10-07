import { useState } from 'react'
import type { FormEvent } from 'react'
import type { Payment, SalePaymentInput } from '@/types'
import {
  buildPaymentFormSchema,
  formatAmount,
  INVOICE_MESSAGES,
  INVOICE_PAYMENT_MAX,
  parseNumberField,
  todayInputValue,
} from './schemas/invoice.schema'

interface PaymentFormProps {
  title: string
  /** Paiement modifié : ses valeurs sont rechargées dans le formulaire. */
  payment?: Payment | null
  /**
   * Montant maximal accepté : le reste à payer pour un nouveau paiement, le
   * reste à payer augmenté de l'ancien montant pour une modification.
   */
  maxAmount: number
  isSubmitting: boolean
  error: string | null
  onSubmit: (input: SalePaymentInput) => void
  onCancel: () => void
}

interface PaymentFieldErrors {
  amount?: string
  date?: string
}

/**
 * Formulaire d'un paiement. Il n'y a pas de mode de paiement dans cette version :
 * seuls le montant et la date sont saisis. Le montant ne peut pas dépasser le
 * reste à payer, et le service métier reste l'autorité sur cette règle.
 */
function PaymentForm({
  title,
  payment = null,
  maxAmount,
  isSubmitting,
  error,
  onSubmit,
  onCancel,
}: PaymentFormProps) {
  const [amount, setAmount] = useState(
    payment ? String(payment.amount) : maxAmount > 0 ? String(maxAmount) : '',
  )
  const [date, setDate] = useState(
    payment ? todayInputValue(payment.paymentDate) : todayInputValue(),
  )
  const [fieldErrors, setFieldErrors] = useState<PaymentFieldErrors>({})

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const parsed = buildPaymentFormSchema(maxAmount).safeParse({
      amount: parseNumberField(amount),
      date,
    })

    if (!parsed.success) {
      const nextErrors: PaymentFieldErrors = {}

      for (const issue of parsed.error.issues) {
        const field = issue.path[0]

        if (typeof field === 'string' && !nextErrors[field as keyof PaymentFieldErrors]) {
          nextErrors[field as keyof PaymentFieldErrors] = issue.message
        }
      }

      setFieldErrors(nextErrors)

      return
    }

    setFieldErrors({})
    onSubmit({ amount: parsed.data.amount, date: parsed.data.date })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border bg-white p-6 shadow">
      <h2 className="text-lg font-semibold">{title}</h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="payment-amount" className="block text-sm font-medium text-gray-700">
            Montant (FCFA)
          </label>
          <input
            id="payment-amount"
            name="amount"
            type="number"
            inputMode="numeric"
            min={1}
            max={Math.min(maxAmount, INVOICE_PAYMENT_MAX)}
            step={1}
            placeholder="0"
            value={amount}
            onChange={(event) => {
              setFieldErrors((current) => ({ ...current, amount: undefined }))
              setAmount(event.target.value)
            }}
            disabled={isSubmitting}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-60"
          />
          {fieldErrors.amount && (
            <p className="mt-1 text-sm text-red-600">{fieldErrors.amount}</p>
          )}
          <p className="mt-1 text-xs text-gray-500">
            Montant maximum accepté : {formatAmount(maxAmount)}
          </p>
        </div>

        <div>
          <label htmlFor="payment-date" className="block text-sm font-medium text-gray-700">
            Date du paiement
          </label>
          <input
            id="payment-date"
            name="date"
            type="date"
            value={date}
            onChange={(event) => {
              setFieldErrors((current) => ({ ...current, date: undefined }))
              setDate(event.target.value)
            }}
            disabled={isSubmitting}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-60"
          />
          {fieldErrors.date && <p className="mt-1 text-sm text-red-600">{fieldErrors.date}</p>}
        </div>
      </div>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
      )}

      <p className="text-xs text-gray-500">
        Aucun mode de paiement n&apos;est enregistré dans cette version. Après
        l&apos;enregistrement, le montant payé, le reste à payer et le statut de la facture
        sont recalculés par le service métier.
      </p>

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
          disabled={isSubmitting || maxAmount <= 0}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? 'Enregistrement…' : 'Enregistrer le paiement'}
        </button>
      </div>

      {maxAmount <= 0 && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {INVOICE_MESSAGES.paymentTooHigh}
        </p>
      )}
    </form>
  )
}

export default PaymentForm