import type { Client, Payment, SaleDetail, SaleItem, Settings } from '@/types'
import {
  formatAmount,
  formatInvoiceDate,
  formatInvoiceTime,
} from './schemas/invoice.schema'

/**
 * Document imprimable de la facture VTE-000001.
 *
 * La mise en page est produite ici, en HTML autonome : ni le renderer ni le
 * service métier n'ont besoin d'une nouvelle dépendance. Le service
 * d'impression charge cette page dans une fenêtre cachée et la confie au
 * moteur Chromium, ce qui fonctionne entièrement hors ligne.
 *
 * Format : une feuille A4 paysage portant deux exemplaires strictement
 * identiques côte à côte — l'exemplaire client et l'exemplaire boutique —
 * séparés par un trait pointillé de découpe. Les deux exemplaires sont rendus
 * par la même fonction `renderInvoiceCopy` : ils ne peuvent jamais diverger.
 *
 * Pagination explicite : Chromium ne peut pas fiablement synchroniser deux
 * colonnes paginées automatiquement. Le document est donc découpé en pages
 * explicites, chacune portant les deux exemplaires côte à côte avec le même
 * tronçon d'articles. Les en-têtes de colonne et les informations de boutique
 * sont répétés sur chaque page ; les totaux, visas et montant en lettres ne
 * figurent que sur la dernière page.
 */

export interface InvoicePrintContext {
  /** Informations de la boutique, déjà présentes dans l'application. */
  shop: Settings | null
  invoice: SaleDetail
  /** Client de la facture : téléphone et adresse pour l'en-tête. */
  client: Client | null
  payments: Payment[]
}

/** Les deux exemplaires de la même facture, côte à côte sur la feuille. */
export type InvoiceCopyType = 'client' | 'boutique'

/** Mention portée en haut de chaque exemplaire. */
export const INVOICE_COPY_LABELS: Record<InvoiceCopyType, string> = {
  client: 'À remettre au client',
  boutique: 'À conserver par la boutique',
}

/* ------------------------------------------------------------------ */
/* Mesures de pagination (CSS pixels à 96 DPI, comme Chromium)        */
/* ------------------------------------------------------------------ */

/** 1 mm = 96/25.4 px dans le modèle CSS de Chromium. */
const MM_TO_PX = 96 / 25.4
const LINE_HEIGHT = 1.35

/** Dimensions A4 paysage. */
const PAGE_MARGIN_MM = 10
const PRINTABLE_WIDTH_MM = 297 - 2 * PAGE_MARGIN_MM
const PRINTABLE_HEIGHT_MM = 210 - 2 * PAGE_MARGIN_MM
const PRINTABLE_WIDTH_PX = PRINTABLE_WIDTH_MM * MM_TO_PX
const PRINTABLE_HEIGHT_PX = PRINTABLE_HEIGHT_MM * MM_TO_PX

/** Marges et paddings (mm) — synchronisés avec PRINT_STYLES. */
const COPY_PADDING_MM = 5
const DIVIDER_MARGIN_MM = 3
const PARTIES_MARGIN_BOTTOM_MM = 2.5
const COPY_HEAD_MARGIN_BOTTOM_MM = 2.5
const COPY_HEAD_PADDING_BOTTOM_MM = 1.5
const COPY_LABEL_MARGIN_BOTTOM_MM = 1.5
const META_MARGIN_BOTTOM_MM = 2.5
const ITEMS_PADDING_MM = 1
const AMOUNTS_MARGIN_TOP_MM = 2.5
const VISAS_MARGIN_TOP_MM = 2.5
const AMOUNT_WORDS_MARGIN_TOP_MM = 2.5
const AMOUNT_WORDS_VALUE_MARGIN_TOP_MM = 0.8

/** Tailles de police (px) — synchronisées avec PRINT_STYLES. */
const FONT_SIZE_COPY_LABEL = 7.5
const FONT_SIZE_COPY_HEAD = 14
const FONT_SIZE_PARTY_LABEL = 8
const FONT_SIZE_PARTY_VALUE = 12
const FONT_SIZE_PARTY_DETAIL = 10
const FONT_SIZE_META_TD = 8
const FONT_SIZE_ITEMS_HEADER = 8.5
const FONT_SIZE_ITEMS_CELL = 9.5
const FONT_SIZE_AMOUNTS_TH = 7
const FONT_SIZE_AMOUNTS_TD = 9
const FONT_SIZE_AMOUNT_WORDS_LEAD = 8
const FONT_SIZE_AMOUNT_WORDS_VALUE = 10

/** Hauteur d'une bordure de tableau (px), avec border-collapse. */
const BORDER_PX = 1

/** Nombre de lignes de sécurité en dessous du calcul théorique. */
const SAFETY_ROWS = 1

/**
 * Hauteur d'une ligne de produit, avec un facteur de sécurité pour les
 * descriptions qui pourraient aller à l'écran suivant. Le multiplicateur
 * `wrapFactor` est calculé dynamiquement selon la longueur maximale des
 * désignations (voir `calculateRowHeight`).
 */
function rowContentHeight(wrapFactor: number): number {
  return FONT_SIZE_ITEMS_CELL * LINE_HEIGHT * wrapFactor
}

function rowPaddingPx(): number {
  return 2 * ITEMS_PADDING_MM * MM_TO_PX
}

/** Hauteur théorique d'une ligne d'article (multi-lignes comprise). */
function itemRowHeight(wrapFactor: number): number {
  return rowContentHeight(wrapFactor) + rowPaddingPx()
}

/** Hauteur de l'en-tête du tableau des articles. */
const ITEMS_HEADER_H =
  FONT_SIZE_ITEMS_HEADER * LINE_HEIGHT + 2 * ITEMS_PADDING_MM * MM_TO_PX

/** Hauteur de la section CopyHead (titre + statut). */
const COPY_HEAD_H =
  FONT_SIZE_COPY_HEAD * LINE_HEIGHT +
  COPY_HEAD_PADDING_BOTTOM_MM * MM_TO_PX +
  COPY_HEAD_MARGIN_BOTTOM_MM * MM_TO_PX +
  BORDER_PX * 1.5 // border-bottom

/** Hauteur du label de copie. */
const COPY_LABEL_H =
  FONT_SIZE_COPY_LABEL * LINE_HEIGHT +
  COPY_LABEL_MARGIN_BOTTOM_MM * MM_TO_PX

/** Hauteur de la ligne Méta (N° facture, Date, Heure sur une seule ligne). */
const META_H =
  (FONT_SIZE_META_TD * LINE_HEIGHT + 2 * ITEMS_PADDING_MM * MM_TO_PX) +
  META_MARGIN_BOTTOM_MM * MM_TO_PX

/** Hauteur totale du pied de page de la dernière page (amounts + visas + mots). */
const AMOUNTS_H =
  AMOUNTS_MARGIN_TOP_MM * MM_TO_PX +
  (FONT_SIZE_AMOUNTS_TH * LINE_HEIGHT + 2 * ITEMS_PADDING_MM * MM_TO_PX) +
  (FONT_SIZE_AMOUNTS_TD * LINE_HEIGHT + 2 * ITEMS_PADDING_MM * MM_TO_PX)

const VISAS_H =
  VISAS_MARGIN_TOP_MM * MM_TO_PX +
  (FONT_SIZE_AMOUNTS_TH * LINE_HEIGHT + 2 * ITEMS_PADDING_MM * MM_TO_PX) +
  13 * MM_TO_PX // .visas td { height: 13mm }

const AMOUNT_WORDS_H =
  AMOUNT_WORDS_MARGIN_TOP_MM * MM_TO_PX +
  FONT_SIZE_AMOUNT_WORDS_LEAD * LINE_HEIGHT +
  FONT_SIZE_AMOUNT_WORDS_VALUE * LINE_HEIGHT +
  AMOUNT_WORDS_VALUE_MARGIN_TOP_MM * MM_TO_PX

const LAST_PAGE_FOOTER_H = AMOUNTS_H + VISAS_H + AMOUNT_WORDS_H

/**
 * Largeur effective de la colonne Désignation, en px.
 * Utilisée pour estimer le nombre de lignes qu'un texte occupe.
 */
const DESIGNATION_COL_WIDTH_PX = (() => {
  const dividerW = BORDER_PX + 2 * DIVIDER_MARGIN_MM * MM_TO_PX
  const copyW = (PRINTABLE_WIDTH_PX - dividerW) / 2
  const contentW = copyW - 2 * COPY_PADDING_MM * MM_TO_PX
  return 0.52 * contentW
})()

/**
 * Nombre de caractères pouvant tenir sur une ligne dans la colonne
 * Désignation, à 9.5 px. Estimation conservatrice pour les polices
 * sans empattement (0.55 em par caractère en moyenne).
 */
const CHARS_PER_LINE = Math.max(
  10,
  Math.floor(DESIGNATION_COL_WIDTH_PX / (FONT_SIZE_ITEMS_CELL * 0.55)),
)

/**
 * Calcule la hauteur réelle de la zone Parties pour un contexte donné,
 * en comptant les champs optionnels (téléphone, adresse, NINEA, etc.).
 */
function calculatePartiesHeight(
  shop: Settings | null,
  client: Client | null,
): number {
  const labelH = FONT_SIZE_PARTY_LABEL * LINE_HEIGHT
  const valueH = FONT_SIZE_PARTY_VALUE * LINE_HEIGHT
  const detailH = FONT_SIZE_PARTY_DETAIL * LINE_HEIGHT
  const partyPaddingV = 2 * 1.5 * MM_TO_PX
  const partyBorder = BORDER_PX * 2

  const shopDetails =
    (shop?.address ? 1 : 0) +
    (shop?.phone ? 1 : 0) +
    (shop?.phone2 ? 1 : 0) +
    (shop?.ninea ? 1 : 0)
  const clientDetails = (client?.phone ? 1 : 0) + (client?.address ? 1 : 0)

  const shopH = labelH + valueH + shopDetails * detailH + partyPaddingV + partyBorder
  const clientH = labelH + valueH + clientDetails * detailH + partyPaddingV + partyBorder

  return Math.max(shopH, clientH) + PARTIES_MARGIN_BOTTOM_MM * MM_TO_PX
}

/**
 * Facteur d'extension (nombre de lignes) pour la ligne la plus longue
 * du tableau des articles. 1 = une ligne, 2 = deux lignes, etc.
 */
function calculateWrapFactor(items: SaleItem[]): number {
  if (items.length === 0) return 1

  let maxLines = 1
  for (const item of items) {
    const text = `${item.form} ${item.productName}`
    const lines = Math.ceil(text.length / CHARS_PER_LINE)
    if (lines > maxLines) maxLines = lines
  }
  return maxLines
}

/**
 * Calcule le nombre d'articles pouvant tenir sur une page.
 * `isLast` indique si c'est la dernière page (avec le pied de page complet).
 */
function calculateItemsPerPage(
  context: InvoicePrintContext,
  isLast: boolean,
): number {
  const { shop, invoice, client } = context
   const partiesH = calculatePartiesHeight(shop, client)
  const fixedOverhead = COPY_LABEL_H + COPY_HEAD_H + partiesH + META_H + ITEMS_HEADER_H
  const available =
    PRINTABLE_HEIGHT_PX - fixedOverhead - (isLast ? LAST_PAGE_FOOTER_H : 0)

  const wrapFactor = calculateWrapFactor(invoice.items)
  const rowH = itemRowHeight(wrapFactor)

  return Math.max(1, Math.floor(available / rowH) - SAFETY_ROWS)
}

/**
 * Découpe les articles en pages synchronisées. Chaque page (sauf la dernière)
 * peut contenir `capacityNonLast` articles ; la dernière peut en contenir
 * `capacityLast`, toujours moins ou égale car elle porte le pied de page.
 */
function paginateItems<T>(
  items: T[],
  capacityNonLast: number,
  capacityLast: number,
): T[][] {
  if (items.length === 0) return [items]
  if (items.length <= capacityLast) return [items]

  const pages: T[][] = []
  let pos = 0

  while (pos < items.length) {
    const remaining = items.length - pos

    if (remaining <= capacityLast) {
      pages.push(items.slice(pos))
      break
    }

    // Fill the non-last page to its full capacity, but always leave at least
    // one row for the last page (which has a smaller capacity due to the
    // footer). When `remaining` is between `capacityLast` and `capacityNonLast`,
    // this maximises the first page instead of minimising it.
    const take = Math.min(capacityNonLast, remaining - 1)

    pages.push(items.slice(pos, pos + take))
    pos += take
  }

  return pages
}

/* ------------------------------------------------------------------ */
/* Feuille de style                                                   */
/* ------------------------------------------------------------------ */

/**
 * Feuille A4 paysage : la règle `@page` origne réellement le PDF et
 * l'impression. Chaque `.page` porte un `break-after: page` pour forcer
 * le saut de page suivant, et les deux exemplaires sont rendus par la
 * même fonction : ils ne peuvent jamais diverger.
 */
const PRINT_STYLES = `
  @page { size: A4 landscape; margin: 10mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: "Segoe UI", Arial, Helvetica, sans-serif;
    font-size: 9px;
    line-height: 1.35;
    color: #111827;
    background: #ffffff;
  }
  .sheet { width: 100%; }
  .page {
    width: 277mm;
    break-after: page;
    box-sizing: border-box;
  }
  .page:last-child { break-after: avoid; }
  .copies { display: flex; align-items: stretch; }
  .copy {
    flex: 1 1 0;
    min-width: 0;
    padding: 0 5mm;
  }
  .copy:first-child { padding-left: 0; }
  .copy:last-child { padding-right: 0; }
  .copy-divider {
    flex: 0 0 auto;
    align-self: stretch;
    width: 0;
    border-left: 1px dashed #9ca3af;
    margin: 0 3mm;
  }
  .copy-label {
    margin: 0 0 1.5mm;
    font-size: 7.5px;
    font-weight: 700;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    color: #4b5563;
  }
  .copy-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 4mm;
    border-bottom: 1.5px solid #111827;
    padding-bottom: 1.5mm;
    margin-bottom: 2.5mm;
  }
  .copy-title {
    margin: 0;
    font-size: 14px;
    font-weight: 700;
  }
  .parties { display: flex; gap: 4mm; margin-bottom: 2.5mm; }
  .party {
    flex: 1 1 0;
    min-width: 0;
    border: 1px solid #e5e7eb;
    padding: 1.5mm 2mm;
  }
  .party-label {
    margin: 0 0 1mm;
    font-size: 8px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: #6b7280;
  }
  .party-value { margin: 0; font-size: 12px; font-weight: 700; }
  .party-detail { margin: 0.8mm 0 0; font-size: 10px; color: #4b5563; }
   .meta {
     display: flex;
     justify-content: space-between;
     align-items: center;
     gap: 2mm;
     margin-bottom: 2.5mm;
     font-size: 8px;
   }
   .meta-item {
     display: flex;
     align-items: center;
     gap: 0.5mm;
   }
   .meta-label {
     font-size: 7px;
     font-weight: 700;
     text-transform: uppercase;
     letter-spacing: 0.5px;
     color: #374151;
   }
   .meta-value {
     font-weight: 600;
     color: #111827;
   }
  table { width: 100%; border-collapse: collapse; }
  .items {
    table-layout: fixed;
    width: 100%;
    border-collapse: collapse;
  }
  .items col.col-qte { width: 8%; }
  .items col.col-desig { width: 52%; }
  .items col.col-prix { width: 20%; }
  .items col.col-total { width: 20%; }
  .items th {
    border-top: 1px solid #d1d5db;
    border-right: 1px solid #d1d5db;
    border-bottom: 1px solid #9ca3af;
    border-left: 1px solid #d1d5db;
    padding: 1mm 1.5mm;
    font-size: 8.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #374151;
    text-align: left;
    white-space: nowrap;
  }
  .items th.numeric { text-align: right; }
  .items td {
    border-bottom: 1px solid #e5e7eb;
    border-left: 1px solid #d1d5db;
    border-right: 1px solid #d1d5db;
    padding: 1mm 1.5mm;
    font-size: 9.5px;
    vertical-align: middle;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .items td.designation {
    white-space: normal;
    word-break: break-word;
  }
  .items td.numeric {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .items tbody tr {
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .designation { min-width: 0; }
  .designation .form { font-weight: 500; color: #374151; }
  .designation .product { margin-left: 0.8mm; }
  .amounts, .visas { margin-top: 2.5mm; }
  .amounts th, .amounts td, .visas th, .visas td {
    border: 1px solid #d1d5db;
    padding: 1mm 1.5mm;
    text-align: center;
    font-size: 8px;
  }
  .amounts th, .visas th {
    background: #f3f4f6;
    font-size: 7px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #374151;
  }
  .amounts td { font-size: 9px; font-weight: 700; white-space: nowrap; }
  .visas td { height: 13mm; vertical-align: top; }
  .visa-label {
    display: block;
    font-size: 7px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #6b7280;
  }
  .visa-space { display: block; height: 9mm; }
  .amount-words { margin-top: 2.5mm; }
  .amount-words .lead { margin: 0; font-size: 8px; color: #374151; }
  .amount-words .value {
    margin: 0.8mm 0 0;
    font-size: 7px;
    font-weight: 400;
    text-transform: uppercase;
  }
  .status {
    display: inline-block;
    padding: 0.5mm 2mm;
    border: 1px solid #111827;
    border-radius: 999px;
    font-size: 7.5px;
    font-weight: 700;
    letter-spacing: 0.5px;
  }
  .status-cancelled { border-color: #b91c1c; color: #b91c1c; }
  @media screen {
    .page { padding-bottom: 5mm; }
  }
  @media print {
    .page { padding: 0; }
  }
`

/** Les données du document sont échappées : un nom ne peut jamais casser une page. */
export function escapeHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/* ------------------------------------------------------------------ */
/* Montant en lettres (francs CFA)                                    */
/* ------------------------------------------------------------------ */

const AMOUNT_UNITS = [
  'zéro',
  'un',
  'deux',
  'trois',
  'quatre',
  'cinq',
  'six',
  'sept',
  'huit',
  'neuf',
  'dix',
  'onze',
  'douze',
  'treize',
  'quatorze',
  'quinze',
  'seize',
] as const

const AMOUNT_TENS = [
  '',
  '',
  'vingt',
  'trente',
  'quarante',
  'cinquante',
  'soixante',
] as const

/** 0-99 : vingt-trois, soixante-dix, quatre-vingt-dix-neuf… */
function convertAmountTens(value: number): string {
  if (value < 17) {
    return AMOUNT_UNITS[value]
  }

  if (value < 20) {
    return `dix-${AMOUNT_UNITS[value - 10]}`
  }

  const tens = Math.floor(value / 10)
  const units = value % 10

  // 70-79 : soixante + dix..seize ; 71 garde le « et » traditionnel.
  if (tens === 7) {
    if (units === 1) {
      return 'soixante et onze'
    }

    return `soixante-${convertAmountTens(value - 60)}`
  }

  // 80-99 : quatre-vingt + 0..19, sans « s » quand il est suivi.
  if (tens === 8) {
    if (units === 0) {
      return 'quatre-vingts'
    }

    return `quatre-vingt-${convertAmountTens(units)}`
  }

  if (tens === 9) {
    return `quatre-vingt-${convertAmountTens(value - 80)}`
  }

  // 20-69 : vingt et un, trente-deux…
  if (units === 0) {
    return AMOUNT_TENS[tens]
  }

  if (units === 1) {
    return `${AMOUNT_TENS[tens]} et un`
  }

  return `${AMOUNT_TENS[tens]}-${AMOUNT_UNITS[units]}`
}

/** 0-999 : deux cents, cent cinq, neuf cent quatre-vingt-dix-neuf… */
function convertAmountHundreds(value: number): string {
  if (value === 0) {
    return ''
  }

  const hundreds = Math.floor(value / 100)
  const rest = value % 100
  const head =
    hundreds === 0
      ? ''
      : hundreds === 1
        ? 'cent'
        : `${AMOUNT_UNITS[hundreds]} cent${rest === 0 ? 's' : ''}`
  const tail = rest > 0 ? convertAmountTens(rest) : ''

  return [head, tail].filter(Boolean).join(' ')
}

/**
 * Montant entier en lettres, jusqu'aux millions :
 * 23 500 -> "vingt-trois mille cinq cents".
 */
function convertAmountToWords(value: number): string {
  if (value < 1_000) {
    return convertAmountHundreds(value)
  }

  if (value < 1_000_000) {
    const thousands = Math.floor(value / 1_000)
    const rest = value % 1_000
    const head =
      thousands === 1 ? 'mille' : `${convertAmountHundreds(thousands)} mille`
    const tail = rest > 0 ? convertAmountHundreds(rest) : ''

    return [head, tail].filter(Boolean).join(' ')
  }

  const millions = Math.floor(value / 1_000_000)
  const rest = value % 1_000_000
  const head =
    millions === 1
      ? 'un million'
      : `${convertAmountHundreds(millions)} millions`
  const tail = rest > 0 ? convertAmountToWords(rest) : ''

  return [head, tail].filter(Boolean).join(' ')
}

/**
 * Total de la facture en lettres, en francs CFA :
 * 23 500 -> "VINGT-TROIS MILLE CINQ CENTS FRANCS CFA".
 * Les montants de l'application sont des entiers de francs.
 */
export function formatAmountInLetters(value: number): string {
  const amount = Math.max(0, Math.round(value))
  const words = amount === 0 ? 'zéro' : convertAmountToWords(amount)
  const francs = amount <= 1 ? 'FRANC CFA' : 'FRANCS CFA'

  return `${words.toUpperCase()} ${francs}`
}

/* ------------------------------------------------------------------ */
/* Rendu du document imprimable                                        */
/* ------------------------------------------------------------------ */

/** En-tête boutique et client, côte à côte dans chaque exemplaire. */
function renderParties(context: InvoicePrintContext): string {
  const { shop, invoice, client } = context
  const shopPhones: string[] = []
  if (shop?.phone) {
    shopPhones.push(escapeHtml(shop.phone))
  }
  if (shop?.phone2) {
    shopPhones.push(escapeHtml(shop.phone2))
  }
  const shopPhone = shopPhones.length > 0
    ? `<p class="party-detail">Téléphone : ${shopPhones.join(' - ')}</p>`
    : ''
  const shopAddress = shop?.address
    ? `<p class="party-detail">Adresse : ${escapeHtml(shop.address)}</p>`
    : ''
  const shopNinea = shop?.ninea
    ? `<p class="party-detail">NINEA : ${escapeHtml(shop.ninea)}</p>`
    : ''
  const clientPhone = client?.phone
    ? `<p class="party-detail">Téléphone : ${escapeHtml(client.phone)}</p>`
    : ''
  const clientAddress = client?.address
    ? `<p class="party-detail">Adresse : ${escapeHtml(client.address)}</p>`
    : ''

  return `
    <div class="parties">
      <div class="party">
        <p class="party-label">Boutique</p>
        <p class="party-value">${escapeHtml(shop?.shopName ?? 'Ma boutique')}</p>
        ${shopAddress}
        ${shopPhone}
        ${shopNinea}
      </div>
      <div class="party">
        <p class="party-label">Client</p>
        <p class="party-value">${escapeHtml(invoice.clientName)}</p>
        ${clientPhone}
        ${clientAddress}
      </div>
    </div>`
}

/** Numéro de facture, date et heure, sur une seule ligne horizontale. */
function renderMeta(context: InvoicePrintContext): string {
  const { invoice } = context

  return `
    <div class="meta">
      <span class="meta-item">
        <span class="meta-label">N° facture :</span>
        <span class="meta-value">${escapeHtml(invoice.reference)}</span>
      </span>
      <span class="meta-item">
        <span class="meta-label">Date :</span>
        <span class="meta-value">${escapeHtml(formatInvoiceDate(invoice.saleDate))}</span>
      </span>
      <span class="meta-item">
        <span class="meta-label">Heure :</span>
        <span class="meta-value">${escapeHtml(formatInvoiceTime(invoice.createdAt))}</span>
      </span>
    </div>`
}

/**
 * Lignes de la facture : Qté | Désignation | Prix U | Total. La forme
 * et le produit partagent la cellule Désignation sur une seule ligne,
 * la forme en gras devant le nom du produit.
 */
function renderItemRows(items: SaleItem[]): string {
  return items
    .map(
      (item) => `
        <tr>
          <td class="numeric">${item.quantity}</td>
          <td class="designation">
            <span class="form">${escapeHtml(item.form)}</span>
            <span class="product">${escapeHtml(item.productName)}</span>
          </td>
          <td class="numeric">${escapeHtml(formatAmount(item.unitPrice))}</td>
          <td class="numeric">${escapeHtml(formatAmount(item.lineTotal))}</td>
        </tr>`,
    )
    .join('')
}

/** Tableau des articles, avec en-tête répété et le tronçon d'articles donné. */
function renderItemsTable(items: SaleItem[]): string {
  return `
    <table class="items">
      <colgroup>
        <col class="col-qte" />
        <col class="col-desig" />
        <col class="col-prix" />
        <col class="col-total" />
      </colgroup>
      <thead>
        <tr>
          <th class="numeric">Qté</th>
          <th>Désignation</th>
          <th class="numeric">Prix U</th>
          <th class="numeric">Total</th>
        </tr>
      </thead>
      <tbody>${renderItemRows(items)}</tbody>
    </table>`
}

/** Total facture, déjà payé, reste à payer : les montants de la facture. */
function renderAmounts(invoice: SaleDetail): string {
  return `
    <table class="amounts">
      <thead>
        <tr>
          <th>Total facture</th>
          <th>Déjà payé</th>
          <th>Reste à payer</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>${escapeHtml(formatAmount(invoice.totalAmount))}</td>
          <td>${escapeHtml(formatAmount(invoice.paidAmount))}</td>
          <td>${escapeHtml(formatAmount(invoice.remainingAmount))}</td>
        </tr>
      </tbody>
    </table>`
}

/** Trois cases de signature, laissées blanches pour le visa manuel. */
function renderVisas(): string {
  return `
    <table class="visas">
      <thead>
        <tr>
          <th>Responsable dépôt</th>
          <th>Livreur</th>
          <th>Caissier</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <span class="visa-label">Visa responsable dépôt</span>
            <span class="visa-space"></span>
          </td>
          <td>
            <span class="visa-label">Visa livreur</span>
            <span class="visa-space"></span>
          </td>
          <td>
            <span class="visa-label">Visa caissier</span>
            <span class="visa-space"></span>
          </td>
        </tr>
      </tbody>
    </table>`
}

/** Montant total en lettres, sous les visas. */
function renderAmountInWords(invoice: SaleDetail): string {
  return `
    <div class="amount-words">
      <p class="lead">
        Arrêtée la présente facture à la somme de :
        <span style="font-weight: bold; font-size: 11px;">
          ${escapeHtml(formatAmount(invoice.totalAmount))} FCFA
        </span>
      </p>     
      <p class="value">${escapeHtml(formatAmountInLetters(invoice.totalAmount))}</p>
    </div>`
}

/**
 * Rendu d'un exemplaire complet de la facture. Les deux exemplaires de la
 * feuille passent tous les deux par cette fonction : leurs données sont donc
 * strictement identiques, seule la mention d'exemplaire change.
 *
 * Quand `items` est fourni, seul ce tronçon est rendu (pagination explicite)
 * ; sinon, tous les articles sont inclus. `isLastPage` contrôle l'affichage
 * du pied de page (totaux, visas, montant en lettres).
 */
export function renderInvoiceCopy(
  context: InvoicePrintContext,
  copyType: InvoiceCopyType,
  items: SaleItem[] = context.invoice.items,
  isLastPage: boolean = true,
): string {
  const { invoice } = context
  const cancelled =
    invoice.status === 'ANNULEE'
      ? `<span class="status status-cancelled">ANNULÉE</span>`
      : ''
  const footer = isLastPage
    ? `${renderAmounts(invoice)}
       ${renderVisas()}
       ${renderAmountInWords(invoice)}`
    : ''

  return `
    <section class="copy">
      <p class="copy-label">${INVOICE_COPY_LABELS[copyType]}</p>
      <div class="copy-head">
        <div>
          <h1 class="copy-title">FACTURE</h1>
        </div>
        <div>${cancelled}</div>
      </div>
      ${renderParties(context)}
      ${renderMeta(context)}
      ${renderItemsTable(items)}
      ${footer}
    </section>`
}

/** Titre de la facture : utilisé comme titre de fenêtre et comme nom de PDF. */
export function getInvoicePrintTitle(reference: string): string {
  return `Facture ${reference}`
}

/** Nom de fichier proposé pour le téléchargement PDF. */
export function buildInvoicePdfFileName(reference: string): string {
  return `${getInvoicePrintTitle(reference)}.pdf`
}

/**
 * Bouton de fermeture pour l'aperçu : visible seulement dans la fenêtre d'aperçu,
 * masqué à l'impression et dans le PDF grâce à @media print.
 */
const PREVIEW_CLOSE_BUTTON = `
  <style>
    @media screen {
      .preview-close {
        position: fixed;
        top: 12px;
        right: 12px;
        z-index: 1000;
        padding: 8px 16px;
        font-size: 13px;
        font-weight: 600;
        color: #fff;
        background: #16a34a;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        box-shadow: 0 2px 8px rgba(0,0,0,.15);
      }
      .preview-close:hover { background: #15803d; }
      .preview-close:focus-visible { outline: 2px solid #15803d; outline-offset: 2px; }
    }
    @media print {
      .preview-close { display: none !important; }
    }
  </style>
  <button class="preview-close" onclick="window.close()">Fermer l'aperçu</button>
`

/**
 * Génère une page explicite contenant les deux exemplaires côte à côte,
 * avec le même tronçon d'articles sur les deux. La pagination est
 * déterministe : les deux exemplaires partagent exactement les mêmes
 * lignes, et aucune ligne n'est jamais coupée entre deux pages.
 */
function renderPage(
  context: InvoicePrintContext,
  pageItems: SaleItem[],
  isLastPage: boolean,
): string {
  return `
    <div class="page">
      <div class="copies">
        ${renderInvoiceCopy(context, 'client', pageItems, isLastPage)}
        <div class="copy-divider" aria-hidden="true"></div>
        ${renderInvoiceCopy(context, 'boutique', pageItems, isLastPage)}
      </div>
    </div>`
}

/**
 * La feuille complète : A4 paysage, chaque page portant les deux
 * exemplaires (client à gauche, boutique à droite) séparés par le pointillé
 * de découpe. La pagination est explicite : les articles sont découpés en
 * pages synchronisées avant d'être rendus, garantissant que les deux
 * exemplaires restent alignés sur chaque feuille.
 */
export function buildInvoicePrintHtml(context: InvoicePrintContext): string {
  const { invoice } = context

  const itemsPerPageNonLast = calculateItemsPerPage(context, false)
  const itemsPerPageLast = calculateItemsPerPage(context, true)
  const pageItems = paginateItems(invoice.items, itemsPerPageNonLast, itemsPerPageLast)
  const totalPages = pageItems.length

  const pages = pageItems
    .map((items, index) => {
      const isLastPage = index === totalPages - 1
      return renderPage(context, items, isLastPage)
    })
    .join('')

  return `<!DOCTYPE html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(getInvoicePrintTitle(invoice.reference))}</title>
    <style>${PRINT_STYLES}</style>
  </head>
  <body>
    ${PREVIEW_CLOSE_BUTTON}
    <div class="sheet">
      ${pages}
    </div>
  </body>
</html>`
}
