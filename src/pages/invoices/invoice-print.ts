import type { Client, Payment, SaleDetail, Settings } from '@/types'
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

/**
 * Feuille A4 paysage : la règle `@page` est ce qui oriente réellement le
 * PDF et l'impression, Chromium lui donne priorité sur les options.
 * Les deux exemplaires se partagent la largeur, séparés par le pointillé.
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
  .copies { display: flex; align-items: stretch; }
  .copy {
    flex: 1 1 0;
    min-width: 0;
    padding: 0 5mm;
    page-break-inside: avoid;
    break-inside: avoid;
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
  .meta { margin-bottom: 2.5mm; }
  .meta th, .meta td {
    border: 1px solid #d1d5db;
    padding: 1mm 1.5mm;
    text-align: left;
    font-size: 8px;
  }
  .meta th {
    background: #f3f4f6;
    font-size: 7px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #374151;
  }
  .meta td { font-weight: 600; }
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
  .items td.numeric {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .designation { min-width: 0; }
  .designation .form { font-weight: 700; color: #374151; }
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
    font-size: 10px;
    font-weight: 400;
    letter-spacing: 0.5px;
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
`

/** Les données du document sont échappées : un nom ne peut jamais casser la page. */
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
/* Document imprimable                                                */
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

/** Numéro de facture, date et heure, sur une seule ligne de trois cases. */
function renderMeta(context: InvoicePrintContext): string {
  const { invoice } = context

  return `
    <table class="meta">
      <thead>
        <tr>
          <th>N° facture</th>
          <th>Date</th>
          <th>Heure</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>${escapeHtml(invoice.reference)}</td>
          <td>${escapeHtml(formatInvoiceDate(invoice.saleDate))}</td>
          <td>${escapeHtml(formatInvoiceTime(invoice.saleDate))}</td>
        </tr>
      </tbody>
    </table>`
}

/**
 * Lignes de la facture : Qté | Désignation | Prix U | Total. La forme
 * et le produit partagent la cellule Désignation sur une seule ligne,
 * la forme en gras devant le nom du produit.
 */
function renderLines(invoice: SaleDetail): string {
  const rows = invoice.items
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
      <tbody>${rows}</tbody>
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
      <p class="lead">Arrêtée la présente facture à la somme de :</p>
      <p class="value">${escapeHtml(formatAmountInLetters(invoice.totalAmount))}</p>
    </div>`
}

/**
 * Un exemplaire complet de la facture. Les deux exemplaires de la feuille
 * passent tous les deux par cette fonction : leurs données sont donc
 * strictement identiques, seule la mention d'exemplaire change.
 */
export function renderInvoiceCopy(
  context: InvoicePrintContext,
  copyType: InvoiceCopyType,
): string {
  const { invoice } = context
  const cancelled =
    invoice.status === 'ANNULEE'
      ? '<span class="status status-cancelled">ANNULÉE</span>'
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
      ${renderLines(invoice)}
      ${renderAmounts(invoice)}
      ${renderVisas()}
      ${renderAmountInWords(invoice)}
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
 * La feuille complète : A4 paysage, exemplaire client à gauche et
 * exemplaire boutique à droite, séparés par le pointillé de découpe.
 */
export function buildInvoicePrintHtml(context: InvoicePrintContext): string {
  const { invoice } = context

  return `<!DOCTYPE html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(getInvoicePrintTitle(invoice.reference))}</title>
    <style>${PRINT_STYLES}</style>
  </head>
  <body>
    <div class="sheet">
      <div class="copies">
        ${renderInvoiceCopy(context, 'client')}
        <div class="copy-divider" aria-hidden="true"></div>
        ${renderInvoiceCopy(context, 'boutique')}
      </div>
    </div>
  </body>
</html>`
}
