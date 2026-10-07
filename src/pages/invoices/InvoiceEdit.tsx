import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { Client, Product, SaleCreateInput, SaleDetail, StockFormLevel } from '@/types'
import { clientService, invoiceService, productService, stockService } from '@/services'
import ConfirmDialog from '../categories/ConfirmDialog'
import InvoiceForm from './InvoiceForm'
import {
  buildInvoiceConfirmationMessage,
  getInvoiceActions,
  INVOICE_MESSAGES,
} from './schemas/invoice.schema'

/**
 * Page « Modifier la facture ».
 *
 * Le contenu commercial n'est modifiable que sur une facture validée qui n'a
 * reçu aucun paiement : la page le vérifie avant d'afficher le formulaire, et
 * `invoiceService.update` refuse de toute façon la facture payée. Le renderer ne
 * calcule aucun mouvement de stock : le service ne traite que la différence
 * entre les anciennes et les nouvelles quantités.
 */
function InvoiceEdit() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const invoiceId = Number(id)
  const [invoice, setInvoice] = useState<SaleDetail | null>(null)
  const [clients, setClients] = useState<Client[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [stockLevels, setStockLevels] = useState<StockFormLevel[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  /** Contenu validé attendant la confirmation, jamais écrit avant elle. */
  const [pendingInput, setPendingInput] = useState<SaleCreateInput | null>(null)

  /**
   * La facture, ses clients actifs, ses produits actifs et les niveaux de stock.
   * Un produit ou un client désactivé après la création reste sélectionnable :
   * seule la ligne existante en a besoin pour être affichée telle quelle.
   */
  const loadFormData = useCallback(async () => {
    setIsLoading(true)
    setLoadError(null)

    try {
      const detail = await invoiceService.getById(invoiceId)
      const [activeClients, activeProducts, levels] = await Promise.all([
        clientService.list({ isActive: true }),
        productService.list({ isActive: true }),
        stockService.list(),
      ])
      const missingProductIds = detail.items
        .map((item) => item.productId)
        .filter((productId) => !activeProducts.some((product) => product.id === productId))
      const missingClients =
        activeClients.some((client) => client.id === detail.clientId)
          ? []
          : [await clientService.get(detail.clientId)]
      const missingProducts = await Promise.all(
        missingProductIds.map((productId) => productService.get(productId)),
      )
      const extraClients = missingClients.filter(
        (client): client is Client => client !== null,
      )
      const extraProducts = missingProducts.filter(
        (product): product is Product => product !== null,
      )

      setInvoice(detail)
      setClients([...extraClients, ...activeClients])
      setProducts([...extraProducts, ...activeProducts])
      setStockLevels(levels)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : INVOICE_MESSAGES.unexpected)
    } finally {
      setIsLoading(false)
    }
  }, [invoiceId])

  useEffect(() => {
    loadFormData()
  }, [loadFormData])

  const handleValidate = (input: SaleCreateInput) => {
    setFormError(null)
    setPendingInput(input)
  }

  const handleConfirm = async () => {
    if (!pendingInput || !invoice) {
      return
    }

    setIsSubmitting(true)
    setFormError(null)

    try {
      await invoiceService.update(invoice.id, pendingInput)
      setPendingInput(null)
      navigate(`/factures/${invoice.id}`, { replace: true })
    } catch (error) {
      setFormError(error instanceof Error ? error.message : INVOICE_MESSAGES.unexpected)
      setPendingInput(null)
    } finally {
      setIsSubmitting(false)
    }
  }

  const actions = invoice ? getInvoiceActions(invoice, invoice.paidAmount > 0) : null
  const canEdit = actions?.canEdit ?? false

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">
          {invoice ? `Modifier la facture ${invoice.reference}` : 'Modifier la facture'}
        </h1>
        <Link
          to={invoice ? `/factures/${invoice.id}` : '/factures'}
          className="text-sm font-medium text-blue-600 hover:text-blue-800"
        >
          {invoice ? 'Retour au détail de la facture' : 'Retour à la liste des factures'}
        </Link>
      </div>

      {loadError && (
        <div className="space-y-3 rounded-lg border bg-white p-6 shadow">
          <p className="text-sm text-red-600">{loadError}</p>
          <Link
            to="/factures"
            className="text-sm font-medium text-blue-600 hover:text-blue-800"
          >
            Retour à la liste des factures
          </Link>
        </div>
      )}

      {isLoading && <p className="text-sm text-gray-500">Chargement…</p>}

      {!isLoading && !loadError && invoice && !canEdit && (
        <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <p className="font-medium">{INVOICE_MESSAGES.locked}</p>
          <p>
            Le contenu d&apos;une facture payée ou annulée ne peut plus être modifié. Ses
            paiements restent modifiables depuis le détail de la facture.
          </p>
          <Link
            to={`/factures/${invoice.id}`}
            className="font-medium text-amber-900 underline"
          >
            Ouvrir le détail de la facture
          </Link>
        </div>
      )}

      {!isLoading && !loadError && invoice && canEdit && (
        <>
          <InvoiceForm
            mode="edit"
            invoice={invoice}
            clients={clients}
            products={products}
            stockLevels={stockLevels}
            isSubmitting={isSubmitting}
            error={formError}
            onSubmit={handleValidate}
            onCancel={() => navigate(`/factures/${invoice.id}`)}
          />

          {pendingInput && (
            <ConfirmDialog
              title="Enregistrer les modifications ?"
              message={buildInvoiceConfirmationMessage(
                pendingInput,
                clients.find((client) => client.id === pendingInput.clientId)?.name ??
                  'CLIENT COMPTANT',
                true,
              )}
              confirmLabel="Enregistrer"
              confirmingLabel="Enregistrement…"
              confirmTone="primary"
              isConfirming={isSubmitting}
              onConfirm={handleConfirm}
              onCancel={() => {
                setPendingInput(null)
                setFormError(null)
              }}
            />
          )}
        </>
      )}
    </div>
  )
}

export default InvoiceEdit