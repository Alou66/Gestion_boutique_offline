import {
  computeLineTotal,
  createDraftKey,
  createEmptyDraft,
  CASH_CLIENT_VALUE,
  INVOICE_ITEMS_MAX,
  invoiceDateSchema,
  invoiceItemFormSchema,
  todayInputValue,
} from './schemas/invoice.schema'
import type {
  InvoiceItemDraft,
  InvoiceLineDraft,
} from './schemas/invoice.schema'

/**
 * Brouillon d'une facture en cours de saisie.
 *
 * Le formulaire de création mémorise son contenu ici : quitter la page
 * pour voir les produits, les clients ou la liste ne perd plus la
 * facture commencée. Le service métier reste la seule autorité : le
 * brouillon n'est qu'un préremplissage, validé à nouveau au retour.
 */
export interface InvoiceDraft {
  date: string
  /** Valeur du sélecteur client : identifiant ou « comptant ». */
  clientId: string
  /** Lignes déjà ajoutées à la facture. */
  lines: InvoiceLineDraft[]
  /** Contenu de l'éditeur de ligne, même incomplet. */
  editor: InvoiceItemDraft
  /** Ligne en cours de modification, si l'éditeur la recharge. */
  editingKey: string | null
}

const STORAGE_KEY = 'invoice-draft:v1'

/** Le stockage local du renderer : absent (tests, SSR), le brouillon est ignoré. */
function getLocalStorage(): Storage | null {
  try {
    return typeof globalThis.localStorage === 'undefined'
      ? null
      : globalThis.localStorage
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** L'éditeur ne contient que des chaînes : une ligne en cours de saisie. */
function isItemDraft(value: unknown): value is InvoiceItemDraft {
  if (!isRecord(value)) {
    return false
  }

  return (
    typeof value.key === 'string' &&
    typeof value.productId === 'string' &&
    typeof value.form === 'string' &&
    typeof value.quantity === 'string' &&
    typeof value.unitPrice === 'string'
  )
}

/**
 * Une ligne retrouvée est ré-validée avec les règles du formulaire :
 * produit et quantités entiers, forme non vide. Une ligne corrompue
 * ou manifestement fausse est écartée, jamais repassée telle quelle.
 */
function parseLine(raw: unknown): InvoiceLineDraft | null {
  if (!isRecord(raw)) {
    return null
  }

  const parsed = invoiceItemFormSchema.safeParse({
    productId: raw.productId,
    form: raw.form,
    quantity: raw.quantity,
    unitPrice: raw.unitPrice,
  })

  if (!parsed.success) {
    return null
  }

  const { productId, form, quantity, unitPrice } = parsed.data

  return {
    key:
      typeof raw.key === 'string' && raw.key !== '' ? raw.key : createDraftKey(),
    productId,
    form,
    quantity,
    unitPrice,
    lineTotal: computeLineTotal(quantity, unitPrice),
  }
}

/**
 * Nettoie le contenu brut du stockage : la date invalide revient au
 * jour du jour, les lignes sont revalidées (dans la limite du
 * maximum), et une ligne en cours de modification qui n'existe plus
 * repart d'un éditeur vide plutôt que d'éditer dans le vide.
 */
function parseInvoiceDraft(raw: unknown): InvoiceDraft {
  const source = isRecord(raw) ? raw : {}
  const date = invoiceDateSchema.safeParse(source.date)
  const lines: InvoiceLineDraft[] = []

  if (Array.isArray(source.lines)) {
    for (const rawLine of source.lines) {
      if (lines.length >= INVOICE_ITEMS_MAX) {
        break
      }

      const line = parseLine(rawLine)

      if (line) {
        lines.push(line)
      }
    }
  }

  let editor = isItemDraft(source.editor) ? { ...source.editor } : createEmptyDraft()
  const rawEditingKey =
    typeof source.editingKey === 'string' ? source.editingKey : null
  let editingKey: string | null = null

  if (rawEditingKey !== null) {
    if (lines.some((line) => line.key === rawEditingKey)) {
      editingKey = rawEditingKey
    } else {
      editor = createEmptyDraft()
    }
  }

  return {
    date: date.success ? date.data : todayInputValue(),
    clientId: typeof source.clientId === 'string' ? source.clientId : '',
    lines,
    editor,
    editingKey,
  }
}

/**
 * Un brouillon ne vaut la peine d'être proposé que s'il contient au
 * moins une ligne, une saisie en cours ou un client réel : une page
 * ouverte sans rien saisir ne laisse aucune trace.
 */
export function isMeaningfulInvoiceDraft(draft: InvoiceDraft | null): boolean {
  if (!draft) {
    return false
  }

  if (draft.lines.length > 0) {
    return true
  }

  if (
    draft.editor.productId.trim() !== '' ||
    draft.editor.form.trim() !== '' ||
    draft.editor.quantity.trim() !== '' ||
    draft.editor.unitPrice.trim() !== ''
  ) {
    return true
  }

  return draft.clientId.trim() !== '' && draft.clientId !== CASH_CLIENT_VALUE
}

/**
 * Le brouillon conservé, ou `null` : absent, illisible ou sans contenu
 * saisi. La lecture ne fait jamais planter le formulaire.
 */
export function readInvoiceDraft(): InvoiceDraft | null {
  const storage = getLocalStorage()

  if (!storage) {
    return null
  }

  try {
    const raw = storage.getItem(STORAGE_KEY)

    if (!raw) {
      return null
    }

    const draft = parseInvoiceDraft(JSON.parse(raw))

    return isMeaningfulInvoiceDraft(draft) ? draft : null
  } catch {
    return null
  }
}

/** Mémorise le contenu saisi : l'écriture ne bloque jamais la saisie. */
export function saveInvoiceDraft(draft: InvoiceDraft): void {
  const storage = getLocalStorage()

  if (!storage) {
    return
  }

  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(draft))
  } catch {
    // Le brouillon est un confort : un stockage plein ou refusé
    // laisse simplement la facture non mémorisée.
  }
}

/** Oublie le brouillon : après création, ou quand le commerçant efface. */
export function clearInvoiceDraft(): void {
  const storage = getLocalStorage()

  if (!storage) {
    return
  }

  try {
    storage.removeItem(STORAGE_KEY)
  } catch {
    // Rien à faire : il n'y a alors plus de brouillon à effacer.
  }
}
