import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Client, Payment, SaleDetail, Settings } from '../electron/types'
import {
  buildInvoicePdfFileName,
  buildInvoicePrintHtml,
  escapeHtml,
  formatAmountInLetters,
  getInvoicePrintTitle,
  renderInvoiceCopy,
} from '../src/pages/invoices/invoice-print'

/**
 * Le document imprimé de la facture : une feuille A4 paysage portant
 * deux exemplaires identiques côte à côte (client et boutique),
 * séparés par un pointillé de découpe. Le document est produit en
 * HTML autonome par le renderer, puis imprimé ou converti en PDF par
 * le service d'impression : aucune ressource externe n'est donc
 * demandée, l'impression fonctionne hors ligne.
 */

function buildInvoice(overrides: Partial<SaleDetail> = {}): SaleDetail {
  return {
    id: 1,
    reference: 'VTE-000001',
    clientId: 7,
    clientName: 'AWA DIOP',
    saleDate: new Date(2026, 9, 5),
    status: 'VALIDEE',
    totalAmount: 28_000,
    paidAmount: 10_000,
    remainingAmount: 18_000,
    paymentStatus: 'PARTIELLEMENT_PAYEE',
    createdAt: new Date(2026, 9, 5, 16, 45),
    updatedAt: new Date(),
    items: [
      {
        id: 1,
        saleId: 1,
        productId: 1,
        productName: 'SUCRE 1 KG',
        form: 'SAC',
        quantity: 10,
        unitPrice: 2_500,
        lineTotal: 25_000,
      },
      {
        id: 2,
        saleId: 1,
        productId: 2,
        productName: 'CHOCOPAIN 5 KG',
        form: 'SEAU',
        quantity: 2,
        unitPrice: 1_500,
        lineTotal: 3_000,
      },
    ],
    paymentSummary: {
      paidAmount: 10_000,
      remainingAmount: 18_000,
      status: 'PARTIELLEMENT_PAYEE',
    },
    ...overrides,
  }
}

function buildShop(overrides: Partial<Settings> = {}): Settings {
  return {
    id: 1,
    shopName: 'BOUTIQUE SOKNA',
    phone: '77 123 45 67',
    address: 'Rue 10, Dakar',
    ninea: '12345678901',
    ownerName: 'Awa Ndiaye',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

function buildClient(overrides: Partial<Client> = {}): Client {
  return {
    id: 7,
    name: 'AWA DIOP',
    phone: '771234567',
    address: 'Pikine, Dakar',
    isActive: true,
    isSystem: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

function buildPayments(): Payment[] {
  return [
    {
      id: 1,
      saleId: 1,
      amount: 10_000,
      paymentDate: new Date(2026, 9, 6),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ]
}

function buildContext(
  overrides: Partial<{
    shop: Settings | null
    invoice: SaleDetail
    client: Client | null
    payments: Payment[]
  }> = {},
) {
  return {
    shop: buildShop(),
    invoice: buildInvoice(),
    client: buildClient(),
    payments: buildPayments(),
    ...overrides,
  }
}

/** Nombre d'occurrences exactes d'une chaîne dans le document. */
function countOccurrences(html: string, needle: string): number {
  return html.split(needle).length - 1
}

/** Cellules Désignation du document, en ordre de lecture. */
function designationCells(html: string): string[] {
  return [...html.matchAll(/<td class="designation">([\s\S]*?)<\/td>/g)].map(
    (match) => match[1],
  )
}

describe('document imprimable de la facture', () => {
  it('est une feuille A4 paysage portant ses deux exemplaires côte à côte', () => {
    const html = buildInvoicePrintHtml(buildContext())

    // A4 paysage : la règle @page oriente le PDF et l'impression.
    assert.equal(html.includes('@page'), true)
    assert.equal(html.includes('A4 landscape'), true)
    // Les deux exemplaires sont placés côte à côte par le flux.
    assert.equal(html.includes('.copies { display: flex'), true)
    assert.equal(countOccurrences(html, 'class="copy"'), 2)
  })

  it('porte les deux mentions d’exemplaire, séparées par un pointillé', () => {
    const html = buildInvoicePrintHtml(buildContext())

    assert.equal(html.includes('À remettre au client'), true)
    assert.equal(html.includes('À conserver par la boutique'), true)
    assert.equal(countOccurrences(html, 'À remettre au client'), 1)
    assert.equal(countOccurrences(html, 'À conserver par la boutique'), 1)
    // Séparation centrale en pointillés, entre les deux exemplaires.
    assert.equal(html.includes('class="copy-divider"'), true)
    assert.equal(html.includes('dashed'), true)

    const clientIndex = html.indexOf('À remettre au client')
    const dividerIndex = html.indexOf('class="copy-divider"')
    const boutiqueIndex = html.indexOf('À conserver par la boutique')

    assert.equal(
      clientIndex < dividerIndex && dividerIndex < boutiqueIndex,
      true,
      'le pointillon doit séparer les deux exemplaires',
    )
  })

  it('porte les informations de la boutique et le numéro de facture', () => {
    const html = buildInvoicePrintHtml(buildContext())

    assert.equal(html.startsWith('<!DOCTYPE html>'), true)
    assert.equal(html.includes('<style>'), true)
    assert.equal(html.includes('BOUTIQUE SOKNA'), true)
    assert.equal(html.includes('77 123 45 67'), true)
    assert.equal(html.includes('Rue 10, Dakar'), true)
    assert.equal(html.includes('12345678901'), true)
    assert.equal(html.includes('FACTURE'), true)
    assert.equal(html.includes('VTE-000001'), true)
  })

  it('place la boutique et le client côte à côte', () => {
    const html = buildInvoicePrintHtml(buildContext())
    const partiesIndex = html.indexOf('class="parties"')

    assert.equal(partiesIndex > 0, true)
    // Le bloc boutique/client est un flex : les deux colonnes sont
    // voisines, jamais l’une au-dessus de l’autre.
    assert.equal(html.includes('.parties { display: flex'), true)

    const boutiqueIndex = html.indexOf('>Boutique<', partiesIndex)
    const clientIndex = html.indexOf('>Client<', partiesIndex)

    assert.equal(boutiqueIndex > partiesIndex, true)
    assert.equal(clientIndex > boutiqueIndex, true)
    assert.equal(html.includes('AWA DIOP'), true)
    assert.equal(html.includes('771234567'), true)
    assert.equal(html.includes('Pikine, Dakar'), true)
  })

  it('porte le numéro, la date et l’heure de la facture', () => {
    const html = buildInvoicePrintHtml(buildContext())

    assert.equal(html.includes('N° facture :'), true)
    assert.equal(html.includes('Date :'), true)
    assert.equal(html.includes('Heure :'), true)
    // Une fois par exemplaire dans la méta, plus une fois dans le
    // titre du document : le numéro n'est plus répété sous le titre.
    assert.equal(countOccurrences(html, 'VTE-000001'), 3)
    assert.equal(html.includes('05/10/2026'), true)
    assert.equal(html.includes('16:45'), true)
  })

  it('affiche l’heure de création, pas l’heure de la date de vente', () => {
    // saleDate est à minuit (date saisie par le commerçant, sans heure).
    // createdAt conserve l’heure réelle de création.
    const context = buildContext({
      invoice: buildInvoice({
        saleDate: new Date(2026, 9, 5),
        createdAt: new Date(2026, 9, 5, 16, 45),
      }),
    })
    const html = buildInvoicePrintHtml(context)

    // La date affichée provient de saleDate (jour saisi).
    assert.equal(html.includes('05/10/2026'), true)
    // L’heure affichée provient de createdAt (heure de création réelle).
    assert.equal(html.includes('Heure :'), true)
    assert.equal(html.includes('>16:45<'), true)
    // L’heure de la date de vente (minuit) n’apparaît pas.
    assert.equal(html.includes('00:00'), false)
  })

  it('liste les lignes avec exactement Qté, Désignation, Prix U et Total', () => {
    const html = buildInvoicePrintHtml(buildContext())
    const grouped = new Intl.NumberFormat('fr-FR')

    assert.equal(html.includes('>Qté<'), true)
    assert.equal(html.includes('>Désignation<'), true)
    assert.equal(html.includes('>Prix U<'), true)
    assert.equal(html.includes('>Total<'), true)
    // Aucune colonne Forme séparée : la forme est dans la Désignation.
    assert.equal(html.includes('Forme'), false)
    assert.equal(html.includes('>Produit<'), false)

    const cells = designationCells(html)

    assert.equal(cells.length, 4)
    // Forme et produit partagent une seule ligne : aucun retour à la ligne.
    for (const cell of cells) {
      assert.equal(cell.includes('<br'), false)
    }
    assert.equal(
      cells[0].replace(/\s+/g, ' ').trim(),
      '<span class="form">SAC</span> <span class="product">SUCRE 1 KG</span>',
    )
    assert.equal(
      cells[1].replace(/\s+/g, ' ').trim(),
      '<span class="form">SEAU</span> <span class="product">CHOCOPAIN 5 KG</span>',
    )
    assert.equal(html.includes(grouped.format(2_500)), true)
    assert.equal(html.includes(grouped.format(25_000)), true)
    assert.equal(html.includes(grouped.format(3_000)), true)
  })

  it('porte les montants total, payé et reste à payer', () => {
    const html = buildInvoicePrintHtml(buildContext())
    const grouped = new Intl.NumberFormat('fr-FR')

    assert.equal(html.includes('>Total facture<'), true)
    assert.equal(html.includes('>Déjà payé<'), true)
    assert.equal(html.includes('>Reste à payer<'), true)
    // Les montants sont portés tels que le service les renvoie, une
    // fois par exemplaire : la devise est écrite en lettres sous les
    // visas, jamais répétée à côté des chiffres.
    assert.equal(countOccurrences(html, grouped.format(28_000)), 2)
    assert.equal(countOccurrences(html, grouped.format(10_000)), 2)
    assert.equal(countOccurrences(html, grouped.format(18_000)), 2)
  })

  it('porte les trois cases de visa avec leur espace de signature', () => {
    const html = buildInvoicePrintHtml(buildContext())

    assert.equal(html.includes('>Responsable dépôt<'), true)
    assert.equal(html.includes('>Livreur<'), true)
    assert.equal(html.includes('>Caissier<'), true)
    assert.equal(html.includes('Visa responsable dépôt'), true)
    assert.equal(html.includes('Visa livreur'), true)
    assert.equal(html.includes('Visa caissier'), true)
    assert.equal(html.includes('visa-space'), true)
  })

  it('écrit le total de la facture en lettres', () => {
    const html = buildInvoicePrintHtml(buildContext())

    assert.equal(
      html.includes('Arrêtée la présente facture à la somme de :'),
      true,
    )
    assert.equal(html.includes('VINGT-HUIT MILLE FRANCS CFA'), true)
  })

  it('rend deux exemplaires strictement identiques', () => {
    const context = buildContext()
    const html = buildInvoicePrintHtml(context)

    // Chaque donnée de la facture apparaît exactement deux fois.
    assert.equal(countOccurrences(html, 'AWA DIOP'), 2)
    assert.equal(countOccurrences(html, 'BOUTIQUE SOKNA'), 2)
    assert.equal(countOccurrences(html, 'SUCRE 1 KG'), 2)
    assert.equal(countOccurrences(html, 'CHOCOPAIN 5 KG'), 2)
    assert.equal(countOccurrences(html, 'VINGT-HUIT MILLE FRANCS CFA'), 2)
    assert.equal(countOccurrences(html, '16:45'), 2)

    // Les deux exemplaires ne diffèrent que par leur mention.
    const clientCopy = renderInvoiceCopy(context, 'client')
    const boutiqueCopy = renderInvoiceCopy(context, 'boutique')

    assert.equal(
      clientCopy.replace('À remettre au client', 'EXEMPLAIRE'),
      boutiqueCopy.replace('À conserver par la boutique', 'EXEMPLAIRE'),
    )
  })

  it('marque une facture annulée sur ses deux exemplaires', () => {
    const html = buildInvoicePrintHtml(
      buildContext({ invoice: buildInvoice({ status: 'ANNULEE' }) }),
    )

    assert.equal(html.includes('ANNULÉE'), true)
    assert.equal(html.includes('status-cancelled'), true)
    assert.equal(countOccurrences(html, 'ANNULÉE'), 2)
  })

  it('reste imprimable sans boutique ni client connus', () => {
    const html = buildInvoicePrintHtml(
      buildContext({
        shop: null,
        invoice: buildInvoice({ clientName: 'CLIENT COMPTANT' }),
        client: null,
        payments: [],
      }),
    )

    assert.equal(html.includes('Ma boutique'), true)
    assert.equal(html.includes('CLIENT COMPTANT'), true)
    assert.equal(html.includes('Téléphone :'), false)
  })

  it('n\'échappe jamais le contenu venu de la base', () => {
    const html = buildInvoicePrintHtml(
      buildContext({
        shop: buildShop({ shopName: 'Boutique <script>alert(1)</script>' }),
        invoice: buildInvoice({ clientName: 'AWA <b>DIOP</b> & CO' }),
        client: buildClient({ address: 'Rue "des Lilas" <br>' }),
        payments: [],
      }),
    )

    assert.equal(html.includes('<script>alert(1)</script>'), false)
    assert.equal(html.includes('&lt;script&gt;'), true)
    assert.equal(html.includes('AWA &lt;b&gt;DIOP&lt;/b&gt; &amp; CO'), true)
    assert.equal(html.includes('&quot;des Lilas&quot;'), true)
    assert.equal(html.includes('<br>'), false)
  })

  it('n\'appelle aucune ressource externe, donc fonctionne hors ligne', () => {
    const html = buildInvoicePrintHtml(buildContext())

    assert.equal(html.includes('http://'), false)
    assert.equal(html.includes('https://'), false)
    assert.equal(html.includes('<script'), false)
    assert.equal(html.includes('<link'), false)
    assert.equal(html.includes('<img'), false)
  })

  it('propose un nom de fichier et un titre pour le PDF', () => {
    assert.equal(getInvoicePrintTitle('VTE-000001'), 'Facture VTE-000001')
    assert.equal(buildInvoicePdfFileName('VTE-000001'), 'Facture VTE-000001.pdf')
  })

  it('écrit les montants en lettres, en francs CFA', () => {
    assert.equal(formatAmountInLetters(0), 'ZÉRO FRANC CFA')
    assert.equal(formatAmountInLetters(1), 'UN FRANC CFA')
    assert.equal(formatAmountInLetters(10), 'DIX FRANCS CFA')
    assert.equal(formatAmountInLetters(17), 'DIX-SEPT FRANCS CFA')
    assert.equal(formatAmountInLetters(21), 'VINGT ET UN FRANCS CFA')
    assert.equal(formatAmountInLetters(70), 'SOIXANTE-DIX FRANCS CFA')
    assert.equal(formatAmountInLetters(71), 'SOIXANTE ET ONZE FRANCS CFA')
    assert.equal(formatAmountInLetters(76), 'SOIXANTE-SEIZE FRANCS CFA')
    assert.equal(formatAmountInLetters(80), 'QUATRE-VINGTS FRANCS CFA')
    assert.equal(formatAmountInLetters(81), 'QUATRE-VINGT-UN FRANCS CFA')
    assert.equal(formatAmountInLetters(90), 'QUATRE-VINGT-DIX FRANCS CFA')
    assert.equal(formatAmountInLetters(99), 'QUATRE-VINGT-DIX-NEUF FRANCS CFA')
    assert.equal(formatAmountInLetters(100), 'CENT FRANCS CFA')
    assert.equal(formatAmountInLetters(200), 'DEUX CENTS FRANCS CFA')
    assert.equal(formatAmountInLetters(201), 'DEUX CENT UN FRANCS CFA')
    assert.equal(
      formatAmountInLetters(999),
      'NEUF CENT QUATRE-VINGT-DIX-NEUF FRANCS CFA',
    )
    assert.equal(formatAmountInLetters(1_000), 'MILLE FRANCS CFA')
    assert.equal(formatAmountInLetters(2_500), 'DEUX MILLE CINQ CENTS FRANCS CFA')
    assert.equal(
      formatAmountInLetters(23_500),
      'VINGT-TROIS MILLE CINQ CENTS FRANCS CFA',
    )
    assert.equal(
      formatAmountInLetters(28_000),
      'VINGT-HUIT MILLE FRANCS CFA',
    )
    assert.equal(
      formatAmountInLetters(1_000_000),
      'UN MILLION FRANCS CFA',
    )
    assert.equal(
      formatAmountInLetters(2_500_000),
      'DEUX MILLIONS CINQ CENTS MILLE FRANCS CFA',
    )
  })

  it('échappe les caractères HTML', () => {
    assert.equal(escapeHtml('a & b < c > d " e \' f'), 'a &amp; b &lt; c &gt; d &quot; e &#39; f')
  })
})

describe('pagination explicite des factures longues', () => {
  function buildManyItems(count: number): SaleDetail['items'] {
    return Array.from({ length: count }, (_, i) => ({
      id: i + 1,
      saleId: 1,
      productId: i + 1,
      productName: `PRODUIT ${i + 1}`,
      form: 'SAC',
      quantity: 1,
      unitPrice: 1_000,
      lineTotal: 1_000,
    }))
  }

  function buildLargeInvoice(
    itemCount: number,
    overrides: Partial<SaleDetail> = {},
  ): SaleDetail {
    const items = buildManyItems(itemCount)
    return buildInvoice({
      items,
      totalAmount: itemCount * 1_000,
      paidAmount: 0,
      remainingAmount: itemCount * 1_000,
      paymentStatus: 'NON_PAYEE',
      ...overrides,
    })
  }

  function extractPageContents(html: string): string[] {
    return [...html.matchAll(/<div class="page">([\s\S]*?<\/section>)\s*<\/div>\s*<\/div>/g)]
      .map((m) => m[1])
      .filter(Boolean)
  }

  function extractProductNames(html: string): string[] {
    return [...html.matchAll(/class="product">([^<]*)</g)].map((m) => m[1].trim())
  }

  function extractCopyContents(html: string): string[] {
    return [...html.matchAll(/<section class="copy">([\s\S]*?)<\/section>/g)].map(
      (m) => m[1],
    )
  }

  it('reste sur une seule page quand les articles tiennent', () => {
    const context = buildContext({ invoice: buildLargeInvoice(10) })
    const html = buildInvoicePrintHtml(context)

    assert.equal(countOccurrences(html, 'class="page"'), 1)
    assert.equal(countOccurrences(html, 'class="copy"'), 2)
    assert.equal(countOccurrences(html, 'class="copy-divider"'), 1)
  })

  it('découpe en plusieurs pages quand l’article justifie', () => {
    const context = buildContext({ invoice: buildLargeInvoice(40) })
    const html = buildInvoicePrintHtml(context)

    const pageCount = countOccurrences(html, 'class="page"')
    assert.equal(pageCount > 1, true, 'une facture longue produit plusieurs pages')
    assert.equal(countOccurrences(html, 'class="copy"'), pageCount * 2)
    assert.equal(countOccurrences(html, 'class="copy-divider"'), pageCount)
  })

  it('précise A4 paysage et break-after:page dans le CSS', () => {
    const html = buildInvoicePrintHtml(buildContext({ invoice: buildLargeInvoice(40) }))

    assert.equal(html.includes('@page'), true)
    assert.equal(html.includes('A4 landscape'), true)
    assert.equal(html.includes('break-after: page'), true)
    assert.equal(html.includes('.page'), true)
  })

  it('ne perd ni ne duplique d’article sur les pages', () => {
    const itemCount = 40
    const context = buildContext({ invoice: buildLargeInvoice(itemCount) })
    const html = buildInvoicePrintHtml(context)

    const allProducts = extractProductNames(html)
    // Deux exemplaires par article.
    assert.equal(allProducts.length, itemCount * 2)

    const uniqueProducts = new Set(allProducts)
    assert.equal(uniqueProducts.size, itemCount)
    for (let i = 1; i <= itemCount; i++) {
      assert.equal(allProducts.filter((p) => p === `PRODUIT ${i}`).length, 2)
    }
  })

  it('répète les en-têtes de colonne et les infos sur chaque page', () => {
    const context = buildContext({ invoice: buildLargeInvoice(40) })
    const html = buildInvoicePrintHtml(context)
    const pageCount = countOccurrences(html, 'class="page"')

    // En-tête du tableau : Qté, Désignation, Prix U, Total — deux fois par page (un par exemplaire).
    for (const header of ['>Qté<', '>Désignation<', '>Prix U<', '>Total<']) {
      assert.equal(
        countOccurrences(html, header),
        pageCount * 2,
        `${header} doit apparaître ${pageCount * 2} fois (2 exemplaires × ${pageCount} pages)`,
      )
    }
    // Boutique et métadonnées répétées sur chaque page.
    assert.equal(countOccurrences(html, 'BOUTIQUE SOKNA'), pageCount * 2)
    assert.equal(countOccurrences(html, 'VTE-000001'), pageCount * 2 + 1)
  })

  it('ne place les totaux, visas et montant en lettres que sur la dernière page', () => {
    const context = buildContext({ invoice: buildLargeInvoice(40) })
    const html = buildInvoicePrintHtml(context)

    // Totaux : exactement 2 (un par exemplaire, sur la dernière page uniquement).
    assert.equal(countOccurrences(html, '>Total facture<'), 2)
    assert.equal(countOccurrences(html, '>Déjà payé<'), 2)
    assert.equal(countOccurrences(html, '>Reste à payer<'), 2)
    assert.equal(countOccurrences(html, 'Visa responsable dépôt'), 2)
    assert.equal(countOccurrences(html, 'Arrêtée la présente facture'), 2)
  })

  it('garde les deux exemplaires synchronisés sur chaque page', () => {
    const context = buildContext({ invoice: buildLargeInvoice(40) })
    const html = buildInvoicePrintHtml(context)
    const pages = extractPageContents(html)
    const pageCount = pages.length

    assert.equal(pageCount > 1, true)

    for (let i = 0; i < pageCount; i++) {
      const copies = extractCopyContents(pages[i])
      assert.equal(copies.length, 2, `page ${i + 1} : deux exemplaires attendus`)

      const leftProducts = extractProductNames(copies[0])
      const rightProducts = extractProductNames(copies[1])

      assert.deepEqual(leftProducts, rightProducts, `page ${i + 1} : les deux exemplaires doivent être synchronisés`)
    }
  })

  it('place le pointillé de découpe au centre de chaque page', () => {
    const context = buildContext({ invoice: buildLargeInvoice(40) })
    const html = buildInvoicePrintHtml(context)
    const pageCount = countOccurrences(html, 'class="page"')

    for (const page of extractPageContents(html)) {
      const labelClient = page.indexOf('À remettre au client')
      const divider = page.indexOf('class="copy-divider"')
      const labelBoutique = page.indexOf('À conserver par la boutique')

      assert.equal(
        labelClient < divider && divider < labelBoutique,
        true,
        'le pointillé doit séparer les deux exemplaires sur chaque page',
      )
    }
    assert.equal(countOccurrences(html, 'class="copy-divider"'), pageCount)
  })

  it('gère une facture très longue (4 pages ou plus)', () => {
    const itemCount = 100
    const context = buildContext({ invoice: buildLargeInvoice(itemCount) })
    const html = buildInvoicePrintHtml(context)

    const pageCount = countOccurrences(html, 'class="page"')
    assert.equal(pageCount >= 4, true, `attendu ≥ 4 pages, obtenu ${pageCount}`)

    // Aucun article perdu ni dupliqué.
    const allProducts = extractProductNames(html)
    assert.equal(allProducts.length, itemCount * 2)
    assert.equal(new Set(allProducts).size, itemCount)

    // Les deux exemplaires sont synchronisés sur chaque page.
    for (const page of extractPageContents(html)) {
      const copies = extractCopyContents(page)
      assert.equal(copies.length, 2)
      assert.deepEqual(
        extractProductNames(copies[0]),
        extractProductNames(copies[1]),
      )
    }
  })

  it('gère des désignations longues sans perdre d’articles', () => {
    const longName =
      'PRODUIT AVEC UNE TRÈS LONGUE DÉSIGNATION QUI DOIT DÉPASSER LA LARGEUR DE LA COLONNE POUR PROVOQUER UN RETOUR À LA LIGNE'
    const items: SaleDetail['items'] = []
    for (let i = 0; i < 30; i++) {
      items.push({
        id: i + 1,
        saleId: 1,
        productId: i + 1,
        productName: `${longName} ${i + 1}`,
        form: 'SAC',
        quantity: 1,
        unitPrice: 1_000,
        lineTotal: 1_000,
      })
    }
    const context = buildContext({
      invoice: buildInvoice({ items, totalAmount: 30_000 }),
    })
    const html = buildInvoicePrintHtml(context)

    // Le CSS autorise le retour à la ligne dans la désignation.
    assert.equal(html.includes('white-space: normal'), true)

    // Tous les articles sont présents, deux fois chacun.
    const allProducts = extractProductNames(html)
    assert.equal(allProducts.length, 30 * 2)
    assert.equal(new Set(allProducts).size, 30)
  })

  it('gère une facture annulée sur plusieurs pages', () => {
    const context = buildContext({
      invoice: buildLargeInvoice(40, { status: 'ANNULEE' }),
    })
    const html = buildInvoicePrintHtml(context)
    const pageCount = countOccurrences(html, 'class="page"')

    assert.equal(pageCount > 1, true)
    // Le sceau ANNULÉE apparaît sur chaque copie de chaque page.
    assert.equal(countOccurrences(html, 'ANNULÉE'), pageCount * 2)
    assert.equal(countOccurrences(html, 'status-cancelled'), pageCount * 2 + 1)
    // +1 pour l'occurrence dans la CSS (.status-cancelled { ... })
    // Les totaux restent sur la dernière page uniquement.
    assert.equal(countOccurrences(html, 'Total facture'), 2)
  })

  it('gère une boutique sans informations facultatives sur plusieurs pages', () => {
    const context = buildContext({
      shop: buildShop({ phone: null, phone2: null, address: null, ninea: null }),
      invoice: buildLargeInvoice(40),
    })
    const html = buildInvoicePrintHtml(context)
    const pageCount = countOccurrences(html, 'class="page"')

    assert.equal(pageCount > 1, true)
    // La boutique est toujours affichée, sans les champs optionnels.
    assert.equal(countOccurrences(html, 'BOUTIQUE SOKNA'), pageCount * 2)
    // Les champs optionnels de la boutique sont absents, mais le client
    // garde les siens propres : on vérifie par valeur plutôt qu'avec le
    // libellé générique partagé par les deux parties.
    assert.equal(html.includes('Rue 10, Dakar'), false)
    assert.equal(html.includes('77 123 45 67'), false)
    assert.equal(html.includes('12345678901'), false)
    // Le client conserve bien son adresse et son téléphone.
    assert.equal(html.includes('Pikine, Dakar'), true)
    assert.equal(html.includes('771234567'), true)
    // Aucun article perdu.
    const allProducts = extractProductNames(html)
    assert.equal(allProducts.length, 40 * 2)
  })

  it('produit une page de dernier rang contenant les totaux et signatures', () => {
    const context = buildContext({ invoice: buildLargeInvoice(40) })
    const html = buildInvoicePrintHtml(context)
    const pages = extractPageContents(html)
    const lastPage = pages[pages.length - 1]

    // La dernière page porte les totaux, visas et montant en lettres.
    assert.equal(lastPage.includes('Total facture'), true)
    assert.equal(lastPage.includes('Déjà payé'), true)
    assert.equal(lastPage.includes('Reste à payer'), true)
    assert.equal(lastPage.includes('Responsable dépôt'), true)
    assert.equal(lastPage.includes('Visa caissier'), true)
    assert.equal(lastPage.includes('Arrêtée la présente facture'), true)
    // La page précédente ne porte pas ces totaux.
    if (pages.length > 1) {
      const prevPage = pages[pages.length - 2]
      assert.equal(prevPage.includes('Total facture'), false)
      assert.equal(prevPage.includes('Arrêtée la présente facture'), false)
    }
  })

  it('remplit la première feuille au maximum pour une facture de deux feuilles', () => {
    const context = buildContext({ invoice: buildLargeInvoice(22) })
    const html = buildInvoicePrintHtml(context)
    const pages = html.split('<div class="page">').slice(1)

    assert.equal(pages.length, 2, '22 articles nécessitent exactement 2 feuilles')

    const itemsPerPage = pages.map((p) => (p.match(/class="product">/g) || []).length / 2)

    assert.equal(
      itemsPerPage[0] > itemsPerPage[1],
      true,
      `première feuille (${itemsPerPage[0]}) doit contenir plus que la dernière (${itemsPerPage[1]})`,
    )

    const allProducts = extractProductNames(html)
    assert.equal(allProducts.length, 22 * 2)
    assert.equal(new Set(allProducts).size, 22)
  })

  it('remplit les premières feuilles au maximum pour une facture de trois feuilles ou plus', () => {
    const context = buildContext({ invoice: buildLargeInvoice(50) })
    const html = buildInvoicePrintHtml(context)
    const pages = html.split('<div class="page">').slice(1)

    assert.equal(pages.length >= 3, true, `50 articles nécessitent ≥ 3 feuilles, obtenu ${pages.length}`)

    const itemsPerPage = pages.map((p) => (p.match(/class="product">/g) || []).length / 2)

    for (let i = 0; i + 1 < pages.length; i++) {
      assert.equal(
        itemsPerPage[i] >= itemsPerPage[itemsPerPage.length - 1],
        true,
        `feuille ${i + 1} (${itemsPerPage[i]}) doit contenir au moins autant que la dernière (${itemsPerPage[itemsPerPage.length - 1]})`,
      )
    }

    const lastPage = pages[pages.length - 1]
    assert.equal(lastPage.includes('Total facture'), true)

    const allProducts = extractProductNames(html)
    assert.equal(allProducts.length, 50 * 2)
    assert.equal(new Set(allProducts).size, 50)
  })
})
