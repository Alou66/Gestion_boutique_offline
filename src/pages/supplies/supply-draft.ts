import {
  computeLineTotal,
  createDraftKey,
  createEmptyDraft,
  CASH_SUPPLIER_VALUE,
  SUPPLY_ITEMS_MAX,
  supplyDateSchema,
  supplyItemFormSchema,
  todayInputValue,
} from './schemas/supply.schema'
import type {
  SupplyItemDraft,
  SupplyLineDraft,
} from './schemas/supply.schema'

/**
 * Brouillon d'un approvisionnement en cours de saisie.
 *
 * Le formulaire mémorise son contenu : quitter la page pour
 * voir les produits ou la liste ne perd plus la réception
 * commencée, et le formulaire se rouvre où on l'a quitté.
 * Le service métier reste la seule autorité : le brouillon
 * n'est qu'un préremplissage, validé à nouveau au retour.
 */
export interface SupplyDraft {
  date: string
  /** Identifiant textuel du fournisseur choisi (« comptant » pour le fournisseur système). */
  supplierId: string
  /** Lignes déjà ajoutées au document. */
  lines: SupplyLineDraft[]
  /** Contenu de l'éditeur de ligne, même incomplet. */
  editor: SupplyItemDraft
  /** Ligne en cours de modification, si l'éditeur la recharge. */
  editingKey: string | null
}

const STORAGE_KEY = 'supply-draft:v1'

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
function isItemDraft(value: unknown): value is SupplyItemDraft {
  if (!isRecord(value)) {
    return false
  }

  return (
    typeof value.key === 'string' &&
    typeof value.productId === 'string' &&
    typeof value.form === 'string' &&
    typeof value.quantity === 'string' &&
    typeof value.purchaseUnitPrice === 'string'
  )
}

/**
 * Une ligne retrouvée est ré-validée avec les règles du formulaire :
 * produit et quantités entiers, forme non vide. Une ligne corrompue
 * ou manifestement fausse est écartée, jamais repassée telle quelle.
 */
function parseLine(raw: unknown): SupplyLineDraft | null {
  if (!isRecord(raw)) {
    return null
  }

  const parsed = supplyItemFormSchema.safeParse({
    productId: raw.productId,
    form: raw.form,
    quantity: raw.quantity,
    purchaseUnitPrice: raw.purchaseUnitPrice,
  })

  if (!parsed.success) {
    return null
  }

  const { productId, form, quantity, purchaseUnitPrice } = parsed.data

  return {
    key:
      typeof raw.key === 'string' && raw.key !== '' ? raw.key : createDraftKey(),
    productId,
    form,
    quantity,
    purchaseUnitPrice,
    lineTotal: computeLineTotal(quantity, purchaseUnitPrice),
  }
}

/**
 * Nettoie le contenu brut du stockage : la date invalide revient au
 * jour du jour, le fournisseur est élagué à sa longueur maximale,
 * les lignes sont revalidées (dans la limite du maximum), et une
 * ligne en cours de modification qui n'existe plus repart d'un
 * éditeur vide plutôt que d'éditer dans le vide.
 */
function parseSupplyDraft(raw: unknown): SupplyDraft {
  const source = isRecord(raw) ? raw : {}
  const date = supplyDateSchema.safeParse(source.date)
  const lines: SupplyLineDraft[] = []

  if (Array.isArray(source.lines)) {
    for (const rawLine of source.lines) {
      if (lines.length >= SUPPLY_ITEMS_MAX) {
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
    supplierId:
      typeof source.supplierId === 'string' && source.supplierId.trim() !== ''
        ? source.supplierId.trim()
        : CASH_SUPPLIER_VALUE,
    lines,
    editor,
    editingKey,
  }
}

/**
 * Un brouillon ne vaut la peine d'être proposé que s'il contient au
 * moins une ligne, un fournisseur ou une saisie en cours : une page
 * ouverte sans rien saisir ne laisse aucune trace.
 */
export function isMeaningfulSupplyDraft(draft: SupplyDraft | null): boolean {
  if (!draft) {
    return false
  }

  if (draft.lines.length > 0) {
    return true
  }

  if (draft.supplierId !== CASH_SUPPLIER_VALUE && draft.supplierId.trim() !== '') {
    return true
  }

  return (
    draft.editor.productId.trim() !== '' ||
    draft.editor.form.trim() !== '' ||
    draft.editor.quantity.trim() !== '' ||
    draft.editor.purchaseUnitPrice.trim() !== ''
  )
}

/**
 * Le brouillon conservé, ou `null` : absent, illisible ou sans contenu
 * saisi. La lecture ne fait jamais planter le formulaire.
 */
export function readSupplyDraft(): SupplyDraft | null {
  const storage = getLocalStorage()

  if (!storage) {
    return null
  }

  try {
    const raw = storage.getItem(STORAGE_KEY)

    if (!raw) {
      return null
    }

    const draft = parseSupplyDraft(JSON.parse(raw))

    return isMeaningfulSupplyDraft(draft) ? draft : null
  } catch {
    return null
  }
}

/** Mémorise le contenu saisi : l'écriture ne bloque jamais la saisie. */
export function saveSupplyDraft(draft: SupplyDraft): void {
  const storage = getLocalStorage()

  if (!storage) {
    return
  }

  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(draft))
  } catch {
    // Le brouillon est un confort : un stockage plein ou refusé
    // laisse simplement la réception non mémorisée.
  }
}

/** Oublie le brouillon : après validation, ou quand le commerçant l'efface. */
export function clearSupplyDraft(): void {
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
