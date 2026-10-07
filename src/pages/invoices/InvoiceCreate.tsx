import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { Client, Product, SaleCreateInput, StockFormLevel } from '@/types'
import { clientService, invoiceService, productService, stockService } from '@/services'
import ConfirmDialog from '../categories/ConfirmDialog'
import {
  clearInvoiceDraft,
  readInvoiceDraft,
  saveInvoiceDraft,
} from './invoice-draft'
import type { InvoiceDraft } from './invoice-draft'
import InvoiceForm from './InvoiceForm'
import {
  buildInvoiceConfirmationMessage,
  formatAmount,
  INVOICE_MESSAGES,
  sumLineTotals,
} from './schemas/invoice.schema'

/**
 * Page « Nouvelle facture ».
 *
 * Elle charge les clients actifs, les produits actifs et les niveaux de stock,
 * puis confie le formulaire. La validation passe toujours par
 * `invoiceService.create` : ni la référence, ni le total, ni le stock ne sont
 * calculés ici. Après succès, le détail de la facture créée s'ouvre directement.
 *
 * Le contenu saisi est mémorisé comme brouillon : aller voir les produits
 * ou les clients puis revenir restaure la facture commencée, avec ses
 * lignes, son client et sa saisie en cours. Le brouillon disparaît
 * quand la facture est créée, ou quand le commerçant l'efface.
 */
function InvoiceCreate() {
  const navigate = useNavigate()
  const [clients, setClients] = useState<Client[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [stockLevels, setStockLevels] = useState<StockFormLevel[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  /** Contenu validé attendant la confirmation, jamais écrit avant elle. */
  const [pendingInput, setPendingInput] = useState<SaleCreateInput | null>(null)
  /** Facture en cours retrouvée à l'ouverture : la saisie reprend. */
  const [restoredDraft, setRestoredDraft] = useState<InvoiceDraft | null>(() =>
    readInvoiceDraft(),
  )
  /** Force le remount du formulaire après l'effacement du brouillon. */
  const [formEpoch, setFormEpoch] = useState(0)

  /**
   * Seuls les clients actifs et les produits actifs peuvent être proposés : un
   * client ou un produit inactif est refusé par le service métier.
   */
  const loadFormData = useCallback(async () => {
    setIsLoading(true)
    setLoadError(null)

    try {
      const [availableClients, availableProducts, levels] = await Promise.all([
        clientService.list({ isActive: true }),
        productService.list({ isActive: true }),
        stockService.list(),
      ])

      setClients(availableClients)
      setProducts(availableProducts)
      setStockLevels(levels)
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : INVOICE_MESSAGES.unexpected,
      )
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadFormData()
  }, [loadFormData])

  const handleDraftChange = useCallback((draft: InvoiceDraft) => {
    saveInvoiceDraft(draft)
  }, [])

  /** Oublie le brouillon et repart d'une facture vide. */
  const handleDiscardDraft = () => {
    clearInvoiceDraft()
    setRestoredDraft(null)
    setFormEpoch((epoch) => epoch + 1)
  }

  const handleValidate = (input: SaleCreateInput) => {
    setFormError(null)
    setPendingInput(input)
  }

  const handleConfirm = async () => {
    if (!pendingInput) {
      return
    }

    setIsSubmitting(true)
    setFormError(null)

    try {
      const created = await invoiceService.create(pendingInput)

      setPendingInput(null)
      // La facture existe : le brouillon n'a plus de raison d'être.
      clearInvoiceDraft()
      // Le détail de la facture créée s'ouvre automatiquement.
      navigate(`/factures/${created.id}`, { replace: true })
    } catch (error) {
      setFormError(error instanceof Error ? error.message : INVOICE_MESSAGES.unexpected)
      setPendingInput(null)
    } finally {
      setIsSubmitting(false)
    }
  }

  // Nom affiché dans la confirmation : sans client choisi, c'est le client comptant.
  const pendingClientName = pendingInput
    ? pendingInput.clientId === null || pendingInput.clientId === undefined
      ? 'CLIENT COMPTANT'
      : (clients.find((client) => client.id === pendingInput.clientId)?.name ?? 'CLIENT COMPTANT')
    : ''

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Nouvelle facture</h1>
        <Link
          to="/factures"
          className="text-sm font-medium text-blue-600 hover:text-blue-800"
        >
          Retour à la liste des factures
        </Link>
      </div>

      {loadError && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{loadError}</p>
      )}

      {restoredDraft && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          <p>
            <span className="font-medium">Brouillon restauré :</span> la
            facture en cours (
            {restoredDraft.lines.length}{' '}
            {restoredDraft.lines.length > 1 ? 'lignes' : 'ligne'}, total de{' '}
            {formatAmount(sumLineTotals(restoredDraft.lines))} FCFA) a été
            conservée. Vous pouvez continuer là où vous étiez.
          </p>
          <button
            type="button"
            onClick={handleDiscardDraft}
            className="font-medium text-blue-900 underline"
          >
            Effacer le brouillon
          </button>
        </div>
      )}

      {isLoading && <p className="text-sm text-gray-500">Chargement…</p>}

      {!isLoading && !loadError && products.length === 0 && (
        <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <p className="font-medium">{INVOICE_MESSAGES.noProducts}</p>
          <p>Créez d&apos;abord un produit actif et alimentez son stock pour pouvoir facturer.</p>
          <Link to="/products" className="font-medium text-amber-900 underline">
            Gérer les produits
          </Link>
        </div>
      )}

      {!isLoading && !loadError && products.length > 0 && (
        <InvoiceForm
          key={formEpoch}
          mode="create"
          draft={restoredDraft}
          clients={clients}
          products={products}
          stockLevels={stockLevels}
          isSubmitting={isSubmitting}
          error={formError}
          onSubmit={handleValidate}
          onDraftChange={handleDraftChange}
          onCancel={() => navigate('/factures')}
        />
      )}

      {pendingInput && (
        <ConfirmDialog
          title="Créer la facture ?"
          message={buildInvoiceConfirmationMessage(pendingInput, pendingClientName)}
          confirmLabel="Créer la facture"
          confirmingLabel="Création…"
          confirmTone="primary"
          isConfirming={isSubmitting}
          onConfirm={handleConfirm}
          onCancel={() => {
            setPendingInput(null)
            setFormError(null)
          }}
        />
      )}
    </div>
  )
}

export default InvoiceCreate