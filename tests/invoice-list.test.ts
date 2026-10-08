import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Sale } from '../electron/types'
import {
  buildInvoiceFilters,
  formatAmount,
  formatInvoiceDate,
  formatStatusLabel,
  INVOICES_PER_PAGE,
  paginateInvoices,
  paymentStatusTone,
  saleStatusTone,
} from '../src/pages/invoices/schemas/invoice.schema'

/**
 * La liste des factures ne filtre rien elle-même : elle transmet la recherche
 * par référence et par nom de client, ainsi que le statut, à `listInvoices()`.
 */

function buildSale(overrides: Partial<Sale> = {}): Sale {
  return {
    id: 1,
    reference: 'VTE-000001',
    clientId: 7,
    clientName: 'CLIENT COMPTANT',
    saleDate: new Date(2026, 9, 5),
    status: 'VALIDEE',
    totalAmount: 25_000,
    paidAmount: 0,
    remainingAmount: 25_000,
    paymentStatus: 'NON_PAYEE',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

describe('filtres de la liste des factures', () => {
  it('transmet la recherche par référence et par nom de client', () => {
    assert.deepEqual(buildInvoiceFilters('vte-000001', 'Awa Diop', 'all'), {
      search: 'vte-000001',
      clientSearch: 'Awa Diop',
      status: null,
      dateFrom: undefined,
      dateTo: undefined,
    })

    // Les bornes de date sont transmises telles quelles au service.
    assert.deepEqual(
      buildInvoiceFilters('vte-000001', 'Awa Diop', 'all', '2026-10-01', '2026-10-31'),
      {
        search: 'vte-000001',
        clientSearch: 'Awa Diop',
        status: null,
        dateFrom: '2026-10-01',
        dateTo: '2026-10-31',
      },
    )
  })

  it('enlève les espaces superflus et les filtres vides', () => {
    assert.deepEqual(buildInvoiceFilters('  VTE-000001  ', '   ', 'all'), {
      search: 'VTE-000001',
      clientSearch: undefined,
      status: null,
      dateFrom: undefined,
      dateTo: undefined,
    })

    assert.deepEqual(buildInvoiceFilters('', '', 'VALIDEE'), {
      search: undefined,
      clientSearch: undefined,
      status: 'VALIDEE',
      dateFrom: undefined,
      dateTo: undefined,
    })

    // Une date vide ou composée d'espaces ne filtre rien.
    assert.deepEqual(buildInvoiceFilters('', '', 'VALIDEE', '  ', ''), {
      search: undefined,
      clientSearch: undefined,
      status: 'VALIDEE',
      dateFrom: undefined,
      dateTo: undefined,
    })
  })

  it('permet de filtrer les factures annulées', () => {
    assert.deepEqual(buildInvoiceFilters('', '', 'ANNULEE').status, 'ANNULEE')
  })
})

describe('pagination de la liste', () => {
  it('renvoie une page vide quand il n\'y a aucune facture', () => {
    const page = paginateInvoices([], 1)

    assert.deepEqual(page.rows, [])
    assert.equal(page.page, 1)
    assert.equal(page.totalPages, 1)
    assert.equal(page.total, 0)
  })

  it('découpe la liste par pages de vingt factures', () => {
    const sales = Array.from({ length: 45 }, (_value, index) =>
      buildSale({ id: index + 1, reference: `VTE-${String(index + 1).padStart(6, '0')}` }),
    )

    const first = paginateInvoices(sales, 1)

    assert.equal(INVOICES_PER_PAGE, 20)
    assert.equal(first.rows.length, 20)
    assert.equal(first.rows[0].id, 1)
    assert.equal(first.totalPages, 3)
    assert.equal(first.total, 45)

    assert.equal(paginateInvoices(sales, 3).rows.length, 5)
    assert.equal(paginateInvoices(sales, 3).rows[4].id, 45)
  })

  it('ramène une page hors bornes dans la liste', () => {
    const sales = Array.from({ length: 25 }, (_value, index) => buildSale({ id: index + 1 }))

    assert.equal(paginateInvoices(sales, 0).page, 1)
    assert.equal(paginateInvoices(sales, -5).page, 1)
    assert.equal(paginateInvoices(sales, 99).page, 2)
    assert.equal(paginateInvoices(sales, 99).rows.length, 5)
  })
})

describe('affichage des colonnes de la liste', () => {
  it('présente une facture payée comme une facture partiellement payée', () => {
    const invoice = buildSale({
      reference: 'VTE-000001',
      saleDate: new Date(2026, 9, 5),
      clientName: 'CLIENT COMPTANT',
      totalAmount: 25_000,
      paidAmount: 10_000,
      remainingAmount: 15_000,
      paymentStatus: 'PARTIELLEMENT_PAYEE',
    })

    assert.equal(invoice.reference, 'VTE-000001')
    assert.equal(formatInvoiceDate(invoice.saleDate), '05/10/2026')
    assert.equal(invoice.clientName, 'CLIENT COMPTANT')

    const grouped = new Intl.NumberFormat('fr-FR')

    assert.equal(formatAmount(invoice.totalAmount), grouped.format(25_000))
    assert.equal(formatAmount(invoice.paidAmount), grouped.format(10_000))
    assert.equal(formatAmount(invoice.remainingAmount), grouped.format(15_000))
    assert.equal(formatStatusLabel(invoice.paymentStatus), 'PARTIELLEMENT PAYEE')
    assert.equal(formatStatusLabel(invoice.status), 'VALIDEE')
  })

  it('rend une facture annulée visible', () => {
    const cancelled = buildSale({ status: 'ANNULEE' })

    assert.equal(formatStatusLabel(cancelled.status), 'ANNULEE')
    assert.equal(saleStatusTone('ANNULEE').includes('red'), true)
    assert.notEqual(saleStatusTone('ANNULEE'), saleStatusTone('VALIDEE'))
    assert.equal(paymentStatusTone('PAYEE').includes('green'), true)
  })
})