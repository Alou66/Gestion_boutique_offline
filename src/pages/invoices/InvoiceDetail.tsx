import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { Client, Payment, SaleDetail, SalePaymentInput } from '@/types'
import { clientService, invoiceService, printService } from '@/services'
import ConfirmDialog from '../categories/ConfirmDialog'
import PaymentForm from './PaymentForm'
import {
  buildInvoicePrintHtml,
  getInvoicePrintTitle,
} from './invoice-print'
import {
  buildCancelInvoiceMessage,
  buildDeleteInvoiceMessage,
  buildDeletePaymentMessage,
  formatAmount,
  formatInvoiceDate,
  formatStatusLabel,
  getInvoiceActions,
  getMaxPaymentAmount,
  INVOICE_MESSAGES,
  paymentStatusTone,
  saleStatusTone,
} from './schemas/invoice.schema'

type PaymentEditor = 'closed' | 'add' | 'edit'

/**
 * Page « Détail facture ».
 *
 * Elle affiche la facture relue par le service : les lignes avec le prix
 * facturé, le total, le montant payé, le reste à payer et les statuts. Toutes
 * les actions proposées découlent de l'état renvoyé par le service, et chaque
 * action recharge la facture et ses paiements : aucun état local ne peut
 * diverger de la base.
 */
function InvoiceDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const invoiceId = Number(id)
  const [invoice, setInvoice] = useState<SaleDetail | null>(null)
  const [payments, setPayments] = useState<Payment[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isPrinting, setIsPrinting] = useState(false)
  const [isCancelPending, setIsCancelPending] = useState(false)
  const [isDeletePending, setIsDeletePending] = useState(false)
  const [paymentToDelete, setPaymentToDelete] = useState<Payment | null>(null)
  const [paymentEditor, setPaymentEditor] = useState<PaymentEditor>('closed')
  const [editedPayment, setEditedPayment] = useState<Payment | null>(null)
  const [paymentError, setPaymentError] = useState<string | null>(null)
  /** Le formulaire de paiement est affiché en haut de la facture. */
  const paymentFormRef = useRef<HTMLDivElement | null>(null)

  const loadInvoice = useCallback(async () => {
    setIsLoading(true)
    setLoadError(null)

    try {
      const [detail, invoicePayments] = await Promise.all([
        invoiceService.getById(invoiceId),
        invoiceService.listPayments(invoiceId),
      ])

      setInvoice(detail)
      setPayments(invoicePayments)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : INVOICE_MESSAGES.unexpected)
    } finally {
      setIsLoading(false)
    }
  }, [invoiceId])

  useEffect(() => {
    loadInvoice()
  }, [loadInvoice])

  const openPaymentEditor = (editor: PaymentEditor, payment: Payment | null = null) => {
    setActionError(null)
    setSuccessMessage(null)
    setPaymentError(null)
    setEditedPayment(payment)
    setPaymentEditor(editor)
  }

  const closePaymentEditor = () => {
    setPaymentEditor('closed')
    setEditedPayment(null)
    setPaymentError(null)
  }

  const handleAddPayment = async (input: SalePaymentInput) => {
    setIsSubmitting(true)
    setPaymentError(null)

    try {
      await invoiceService.addPayment(invoiceId, input)
      closePaymentEditor()
      setSuccessMessage('Paiement enregistré.')
      await loadInvoice()
    } catch (error) {
      setPaymentError(error instanceof Error ? error.message : INVOICE_MESSAGES.unexpected)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleUpdatePayment = async (input: SalePaymentInput) => {
    if (!editedPayment) {
      return
    }

    setIsSubmitting(true)
    setPaymentError(null)

    try {
      await invoiceService.updatePayment(editedPayment.id, input)
      closePaymentEditor()
      setSuccessMessage('Paiement modifié.')
      await loadInvoice()
    } catch (error) {
      setPaymentError(error instanceof Error ? error.message : INVOICE_MESSAGES.unexpected)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDeletePayment = async () => {
    if (!paymentToDelete) {
      return
    }

    setIsSubmitting(true)
    setActionError(null)

    try {
      await invoiceService.deletePayment(paymentToDelete.id)
      setPaymentToDelete(null)
      setSuccessMessage('Paiement supprimé.')
      await loadInvoice()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : INVOICE_MESSAGES.unexpected)
      setPaymentToDelete(null)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCancel = async () => {
    setIsSubmitting(true)
    setActionError(null)

    try {
      await invoiceService.cancel(invoiceId)
      setIsCancelPending(false)
      setSuccessMessage('Facture annulée : le stock a été restauré.')
      await loadInvoice()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : INVOICE_MESSAGES.unexpected)
      setIsCancelPending(false)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = async () => {
    setIsSubmitting(true)
    setActionError(null)

    try {
      await invoiceService.delete(invoiceId)
      setIsDeletePending(false)
      // La facture n'existe plus : la liste des factures est la seule vue utile.
      navigate('/factures', { replace: true })
    } catch (error) {
      setActionError(error instanceof Error ? error.message : INVOICE_MESSAGES.unexpected)
      setIsDeletePending(false)
    } finally {
      setIsSubmitting(false)
    }
  }

/**
    * Le document imprimé est construit à partir de la facture relue et des
    * informations de la boutique déjà présentes dans l'application. Le renderer
    * ne fait que produire du HTML : c'est le service d'impression qui l'imprime ou
    * le convertit en PDF, hors ligne.
    */
  const buildPrintableInvoice = useCallback(async (): Promise<string | null> => {
    if (!invoice) {
      return null
    }

    let client: Client | null = null

    try {
      client = await clientService.get(invoice.clientId)
    } catch {
      // Le client est un bonus d'en-tête : son absence n'empêche pas l'impression.
      client = null
    }

    const shop = await window.api.settings.get()

    return buildInvoicePrintHtml({ shop, invoice, client, payments })
  }, [invoice, payments])

  const handlePrint = async () => {
    setActionError(null)
    setIsPrinting(true)

    try {
      const html = await buildPrintableInvoice()

      if (html && invoice) {
        await printService.print(html, getInvoicePrintTitle(invoice.reference))
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : INVOICE_MESSAGES.unexpected)
    } finally {
      setIsPrinting(false)
    }
  }

  const handleSavePdf = async () => {
    setActionError(null)
    setIsPrinting(true)

    try {
      const html = await buildPrintableInvoice()

      if (html && invoice) {
        const path = await printService.savePdf(html, getInvoicePrintTitle(invoice.reference))

        if (path) {
          setSuccessMessage('PDF enregistré.')
        }
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : INVOICE_MESSAGES.unexpected)
    } finally {
      setIsPrinting(false)
    }
  }

  const handlePreview = async () => {
    setActionError(null)
    setIsPrinting(true)

    try {
      const html = await buildPrintableInvoice()

      if (html && invoice) {
        await printService.preview(html, getInvoicePrintTitle(invoice.reference))
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : INVOICE_MESSAGES.unexpected)
    } finally {
      setIsPrinting(false)
    }
  }

  /**
   * Le formulaire de paiement se trouve sous les boutons de la facture : on y
   * remonte dès son ouverture, où que soit l'écran, pour ne jamais avoir à
   * faire défiler la page.
   */
  useEffect(() => {
    if (paymentEditor === 'closed') {
      return
    }

    paymentFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [paymentEditor])

  const scrollToPayments = () => {
    document.getElementById('invoice-payments')?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    })
  }

  const actions = invoice ? getInvoiceActions(invoice, payments.length > 0) : null
  const maxPaymentAmount = invoice
    ? getMaxPaymentAmount(invoice, paymentEditor === 'edit' ? editedPayment : null)
    : 0

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">
            {invoice ? `Facture ${invoice.reference}` : 'Détail facture'}
          </h1>
          {invoice && (
            <p className="text-sm text-gray-600">
              Date : {formatInvoiceDate(invoice.saleDate)}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {invoice && (
            <>
              <span
                className={`rounded-full px-3 py-1 text-xs font-medium ${saleStatusTone(invoice.status)}`}
              >
                {formatStatusLabel(invoice.status)}
              </span>
              <span
                className={`rounded-full px-3 py-1 text-xs font-medium ${paymentStatusTone(invoice.paymentStatus)}`}
              >
                {formatStatusLabel(invoice.paymentStatus)}
              </span>
            </>
          )}
          <Link
            to="/factures"
            className="text-sm font-medium text-blue-600 hover:text-blue-800"
          >
            Retour à la liste des factures
          </Link>
        </div>
      </div>

      {actionError && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{actionError}</p>
      )}

      {successMessage && (
        <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
          {successMessage}
        </p>
      )}

      {isLoading && <p className="text-sm text-gray-500">Chargement…</p>}

      {!isLoading && loadError && (
        <div className="space-y-3 rounded-lg border bg-white p-6 shadow">
          <p className="text-sm text-red-600">{loadError}</p>
          <Link to="/factures" className="text-sm font-medium text-blue-600 hover:text-blue-800">
            Retour à la liste des factures
          </Link>
        </div>
      )}

      {invoice && actions && (
        <>
          <div className="flex flex-wrap gap-3">
            {actions.canEdit && (
              <Link
                to={`/factures/${invoice.id}/modifier`}
                className="rounded-md border border-blue-600 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50"
              >
                Modifier la facture
              </Link>
            )}

            {actions.canAddPayment && (
              <button
                type="button"
                onClick={() => openPaymentEditor(paymentEditor === 'add' ? 'closed' : 'add')}
                aria-expanded={paymentEditor === 'add'}
                className={`rounded-md border border-blue-600 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50 ${
                  paymentEditor === 'add' ? 'bg-blue-50 ring-2 ring-blue-200' : ''
                }`}
              >
                {paymentEditor === 'add' ? 'Fermer le formulaire' : '+ Ajouter un paiement'}
              </button>
            )}

            {!actions.canAddPayment && actions.canManagePayments && (
              <button
                type="button"
                onClick={scrollToPayments}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Voir les paiements
              </button>
            )}

            {actions.canCancel && (
              <button
                type="button"
                onClick={() => {
                  setActionError(null)
                  setSuccessMessage(null)
                  setIsCancelPending(true)
                }}
                className="rounded-md border border-red-600 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
              >
                Annuler la facture
              </button>
            )}

            {actions.canDelete && (
              <button
                type="button"
                onClick={() => {
                  setActionError(null)
                  setSuccessMessage(null)
                  setIsDeletePending(true)
                }}
                className="rounded-md border border-red-600 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
              >
                Supprimer la facture
              </button>
            )}

            <button
              type="button"
              onClick={handlePreview}
              disabled={isPrinting}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPrinting ? INVOICE_MESSAGES.printing : 'Aperçu'}
            </button>

            <button
              type="button"
              onClick={handlePrint}
              disabled={isPrinting}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPrinting ? INVOICE_MESSAGES.printing : 'Imprimer la facture'}
            </button>

            <button
              type="button"
              onClick={handleSavePdf}
              disabled={isPrinting}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPrinting ? INVOICE_MESSAGES.printing : 'Télécharger PDF'}
            </button>
          </div>

          {paymentEditor !== 'closed' && (
            <div ref={paymentFormRef} className="scroll-mt-4">
              {paymentEditor === 'add' && (
                <PaymentForm
                  title="Ajouter un paiement"
                  maxAmount={getMaxPaymentAmount(invoice)}
                  isSubmitting={isSubmitting}
                  error={paymentError}
                  onSubmit={handleAddPayment}
                  onCancel={closePaymentEditor}
                />
              )}

              {paymentEditor === 'edit' && editedPayment && (
                <PaymentForm
                  title="Modifier le paiement"
                  payment={editedPayment}
                  maxAmount={maxPaymentAmount}
                  isSubmitting={isSubmitting}
                  error={paymentError}
                  onSubmit={handleUpdatePayment}
                  onCancel={closePaymentEditor}
                />
              )}
            </div>
          )}

          <div className="space-y-4 rounded-lg border bg-white p-6 shadow">
            <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-4">
              <div>
                <dt className="text-sm text-gray-500">Référence</dt>
                <dd className="text-sm font-medium text-gray-900">{invoice.reference}</dd>
              </div>
              <div>
                <dt className="text-sm text-gray-500">Date</dt>
                <dd className="text-sm font-medium text-gray-900">
                  {formatInvoiceDate(invoice.saleDate)}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-gray-500">Client</dt>
                <dd className="text-sm font-medium text-gray-900">{invoice.clientName}</dd>
              </div>
              <div>
                <dt className="text-sm text-gray-500">Statut</dt>
                <dd className="text-sm font-medium text-gray-900">
                  {formatStatusLabel(invoice.status)}
                </dd>
              </div>
            </dl>

            <div className="overflow-hidden rounded-lg border">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th
                      scope="col"
                      className="px-4 py-2 text-left text-xs font-semibold text-gray-700"
                    >
                      Produit
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-2 text-left text-xs font-semibold text-gray-700"
                    >
                      Forme
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-2 text-right text-xs font-semibold text-gray-700"
                    >
                      Quantité
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-2 text-right text-xs font-semibold text-gray-700"
                    >
                      Prix unitaire
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-2 text-right text-xs font-semibold text-gray-700"
                    >
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {invoice.items.map((item) => (
                    <tr key={item.id}>
                      <td className="px-4 py-2 text-sm font-medium text-gray-900">
                        {item.productName}
                      </td>
                      <td className="px-4 py-2 text-sm text-gray-600">{item.form}</td>
                      <td className="px-4 py-2 text-right text-sm text-gray-600">
                        {item.quantity}
                      </td>
                      <td className="px-4 py-2 text-right text-sm text-gray-600">
                        {formatAmount(item.unitPrice)}
                      </td>
                      <td className="px-4 py-2 text-right text-sm font-medium text-gray-900">
                        {formatAmount(item.lineTotal)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <dl className="ml-auto grid w-full max-w-sm gap-1 border-t border-gray-200 pt-3 text-sm">
              <div className="flex items-baseline justify-between">
                <dt className="text-gray-600">Total</dt>
                <dd className="text-lg font-bold text-gray-900">
                  {formatAmount(invoice.totalAmount)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between">
                <dt className="text-gray-600">Montant payé</dt>
                <dd className="font-medium text-gray-900">{formatAmount(invoice.paidAmount)}</dd>
              </div>
              <div className="flex items-baseline justify-between">
                <dt className="text-gray-600">Reste à payer</dt>
                <dd className="font-medium text-gray-900">
                  {formatAmount(invoice.remainingAmount)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between">
                <dt className="text-gray-600">Statut paiement</dt>
                <dd className="font-medium text-gray-900">
                  {formatStatusLabel(invoice.paymentStatus)}
                </dd>
              </div>
            </dl>

            {!actions.canEdit && invoice.status === 'VALIDEE' && (
              <p className="text-xs text-gray-500">
                {INVOICE_MESSAGES.locked}
              </p>
            )}
          </div>

          <section id="invoice-payments" className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Paiements</h2>

              <p className="text-xs text-gray-500">
                {paymentEditor === 'closed'
                  ? actions.canManagePayments
                    ? 'Les paiements restent modifiables : utilisez « Modifier » ou « Supprimer » sur une ligne.'
                    : 'Aucun paiement enregistré pour le moment.'
                  : 'Le formulaire de paiement est ouvert en haut de la page.'}
              </p>
            </div>

            <dl className="grid gap-3 rounded-lg border bg-white p-4 text-sm shadow sm:grid-cols-3">
              <div>
                <dt className="text-gray-500">Montant total</dt>
                <dd className="font-semibold text-gray-900">
                  {formatAmount(invoice.totalAmount)}
                </dd>
              </div>
              <div>
                <dt className="text-gray-500">Montant payé</dt>
                <dd className="font-semibold text-gray-900">
                  {formatAmount(invoice.paidAmount)}
                </dd>
              </div>
              <div>
                <dt className="text-gray-500">Reste à payer</dt>
                <dd className="font-semibold text-gray-900">
                  {formatAmount(invoice.remainingAmount)}
                </dd>
              </div>
            </dl>

            <div className="overflow-hidden rounded-lg border bg-white shadow">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th
                      scope="col"
                      className="px-6 py-3 text-left text-sm font-semibold text-gray-700"
                    >
                      Date
                    </th>
                    <th
                      scope="col"
                      className="px-6 py-3 text-right text-sm font-semibold text-gray-700"
                    >
                      Montant
                    </th>
                    <th
                      scope="col"
                      className="px-6 py-3 text-right text-sm font-semibold text-gray-700"
                    >
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {payments.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-6 py-6 text-center text-sm text-gray-500">
                        Aucun paiement enregistré pour cette facture.
                      </td>
                    </tr>
                  )}

                  {payments.map((payment) => (
                    <tr key={payment.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 text-sm text-gray-600">
                        {formatInvoiceDate(payment.paymentDate)}
                      </td>
                      <td className="px-6 py-4 text-right text-sm font-medium text-gray-900">
                        {formatAmount(payment.amount)}
                      </td>
                      <td className="px-6 py-4 text-right text-sm">
                        <div className="flex justify-end gap-3">
                          {actions.canManagePayments && (
                            <button
                              type="button"
                              onClick={() => openPaymentEditor('edit', payment)}
                              className="font-medium text-blue-600 hover:text-blue-800"
                            >
                              Modifier
                            </button>
                          )}
                          {actions.canManagePayments && (
                            <button
                              type="button"
                              onClick={() => {
                                setActionError(null)
                                setPaymentToDelete(payment)
                              }}
                              className="font-medium text-red-600 hover:text-red-800"
                            >
                              Supprimer
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {isCancelPending && invoice && (
        <ConfirmDialog
          title="Annuler la facture ?"
          message={buildCancelInvoiceMessage(invoice.reference)}
          confirmLabel="Annuler la facture"
          confirmingLabel="Annulation…"
          isConfirming={isSubmitting}
          onConfirm={handleCancel}
          onCancel={() => setIsCancelPending(false)}
        />
      )}

      {isDeletePending && invoice && (
        <ConfirmDialog
          title="Supprimer la facture ?"
          message={buildDeleteInvoiceMessage(invoice.reference)}
          confirmLabel="Supprimer définitivement"
          confirmingLabel="Suppression…"
          isConfirming={isSubmitting}
          onConfirm={handleDelete}
          onCancel={() => setIsDeletePending(false)}
        />
      )}

      {paymentToDelete && (
        <ConfirmDialog
          title="Supprimer le paiement ?"
          message={buildDeletePaymentMessage(paymentToDelete.amount)}
          confirmLabel="Supprimer"
          confirmingLabel="Suppression…"
          isConfirming={isSubmitting}
          onConfirm={handleDeletePayment}
          onCancel={() => setPaymentToDelete(null)}
        />
      )}
    </div>
  )
}

export default InvoiceDetail