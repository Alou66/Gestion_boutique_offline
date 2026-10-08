import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Payment, Sale, SaleDetail } from '../electron/types'
import {
  buildCancelInvoiceMessage,
  buildDeleteInvoiceMessage,
  buildDeletePaymentMessage,
  buildPaymentFormSchema,
  formatAmount,
  formatInvoiceDate,
  formatSoldQuantity,
  formatStatusLabel,
  getInvoiceActions,
  getMaxPaymentAmount,
  INVOICE_MESSAGES,
  paymentStatusTone,
  saleStatusTone,
} from '../src/pages/invoices/schemas/invoice.schema'

/**
 * Le détail de la facture n'invente aucun statut : il lit ceux renvoyés par le
 * service et n'affiche que les actions réellement permises dans cet état.
 */

function buildSale(overrides: Partial<Sale> = {}): Sale {
  return {
    id: 1,
    reference: 'VTE-000001',
    clientId: 7,
    clientName: 'AWA DIOP',
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

function buildPayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: 1,
    saleId: 1,
    amount: 10_000,
    paymentDate: new Date(2026, 9, 6),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

describe('actions disponibles selon l\'état de la facture', () => {
  it('propose tout sur une facture validée et non payée', () => {
    const actions = getInvoiceActions(buildSale(), false)

    assert.deepEqual(actions, {
      canEdit: true,
      canCancel: true,
      canDelete: false,
      canAddPayment: true,
      canManagePayments: false,
      canPrint: true,
    })
  })

  it('verrouille le contenu d\'une facture partiellement payée', () => {
    const actions = getInvoiceActions(
      buildSale({
        paidAmount: 10_000,
        remainingAmount: 15_000,
        paymentStatus: 'PARTIELLEMENT_PAYEE',
      }),
      true,
    )

    assert.equal(actions.canEdit, false)
    assert.equal(actions.canCancel, false)
    assert.equal(actions.canDelete, false)
    assert.equal(actions.canAddPayment, true)
    assert.equal(actions.canManagePayments, true)
    assert.equal(actions.canPrint, true)
  })

  it('verrouille le contenu d\'une facture payée mais garde les paiements', () => {
    const actions = getInvoiceActions(
      buildSale({
        paidAmount: 25_000,
        remainingAmount: 0,
        paymentStatus: 'PAYEE',
      }),
      true,
    )

    assert.equal(actions.canEdit, false)
    assert.equal(actions.canCancel, false)
    assert.equal(actions.canDelete, false)
    // Rien à payer : plus de bouton « Ajouter un paiement ».
    assert.equal(actions.canAddPayment, false)
    assert.equal(actions.canManagePayments, true)
    assert.equal(actions.canPrint, true)
  })

  it('ne propose que la suppression sur une facture annulée', () => {
    const actions = getInvoiceActions(
      buildSale({ status: 'ANNULEE', paidAmount: 0, remainingAmount: 25_000 }),
      false,
    )

    assert.equal(actions.canEdit, false)
    assert.equal(actions.canCancel, false)
    assert.equal(actions.canDelete, true)
    assert.equal(actions.canAddPayment, false)
    assert.equal(actions.canPrint, true)
  })

  it('ne propose jamais la suppression d\'une facture payée ou validée', () => {
    assert.equal(getInvoiceActions(buildSale(), false).canDelete, false)
    assert.equal(
      getInvoiceActions(buildSale({ paidAmount: 10_000, remainingAmount: 15_000 }), true)
        .canDelete,
      false,
    )
  })

  it('lit les montants du service au lieu de les recalculer', () => {
    const invoice = buildSale({
      totalAmount: 30_000,
      paidAmount: 0,
      remainingAmount: 25_000,
    })

    // A wrong remaining amount would only hide the payment button.
    assert.equal(getInvoiceActions(invoice, false).canAddPayment, true)
    assert.equal(getInvoiceActions(buildSale({ remainingAmount: 0 }), false).canAddPayment, false)
  })
})

describe('paiements', () => {
  it('limite un nouveau paiement au reste à payer', () => {
    const invoice = buildSale({ paidAmount: 10_000, remainingAmount: 15_000 })

    assert.equal(getMaxPaymentAmount(invoice), 15_000)
    // The payment being edited is excluded, else its own amount would block it.
    assert.equal(getMaxPaymentAmount(invoice, buildPayment({ amount: 10_000 })), 25_000)
    assert.equal(getMaxPaymentAmount(buildSale(), null), 25_000)
  })

  it('accepte un montant entier positif dans la limite', () => {
    const schema = buildPaymentFormSchema(15_000)

    assert.equal(schema.safeParse({ amount: 15_000, date: '2026-10-06' }).success, true)
    assert.equal(schema.safeParse({ amount: 1, date: '2026-10-06' }).success, true)
  })

  it('refuse un montant nul, négatif ou décimal', () => {
    const schema = buildPaymentFormSchema(15_000)

    for (const amount of [0, -1, 1.5]) {
      const parsed = schema.safeParse({ amount, date: '2026-10-06' })

      assert.equal(parsed.success, false, `${amount} must be refused`)
      assert.equal(
        parsed.success ? '' : parsed.error.issues[0].message,
        INVOICE_MESSAGES.paymentInvalid,
      )
    }
  })

  it('refuse un montant supérieur au reste à payer', () => {
    const parsed = buildPaymentFormSchema(15_000).safeParse({
      amount: 15_001,
      date: '2026-10-06',
    })

    assert.equal(parsed.success, false)
    assert.equal(
      parsed.success ? '' : parsed.error.issues[0].message,
      INVOICE_MESSAGES.paymentTooHigh,
    )
  })

  it('refuse une date de paiement invalide', () => {
    const parsed = buildPaymentFormSchema(15_000).safeParse({
      amount: 1_000,
      date: '06/10/2026',
    })

    assert.equal(parsed.success, false)
    assert.equal(
      parsed.success ? '' : parsed.error.issues[0].message,
      INVOICE_MESSAGES.dateInvalid,
    )
  })

  it('refuse tout paiement quand la facture est déjà soldée', () => {
    const parsed = buildPaymentFormSchema(0).safeParse({ amount: 1, date: '2026-10-06' })

    assert.equal(parsed.success, false)
    assert.equal(getMaxPaymentAmount(buildSale({ remainingAmount: 0 })), 0)
  })
})

describe('affichage du détail', () => {
  it('affiche les statuts comme le service les nomme', () => {
    assert.equal(formatStatusLabel('NON_PAYEE'), 'NON PAYEE')
    assert.equal(formatStatusLabel('PARTIELLEMENT_PAYEE'), 'PARTIELLEMENT PAYEE')
    assert.equal(formatStatusLabel('PAYEE'), 'PAYEE')
    assert.equal(formatStatusLabel('VALIDEE'), 'VALIDEE')
    assert.equal(formatStatusLabel('ANNULEE'), 'ANNULEE')
  })

  it('distingue visuellement les statuts', () => {
    assert.notEqual(paymentStatusTone('PAYEE'), paymentStatusTone('NON_PAYEE'))
    assert.notEqual(
      paymentStatusTone('PARTIELLEMENT_PAYEE'),
      paymentStatusTone('NON_PAYEE'),
    )
    assert.notEqual(saleStatusTone('VALIDEE'), saleStatusTone('ANNULEE'))
    assert.equal(saleStatusTone('ANNULEE').includes('red'), true)
  })

  it('formate les montants, les dates et les quantités vendues', () => {
    const grouped = new Intl.NumberFormat('fr-FR')

    assert.equal(formatAmount(25_000), grouped.format(25_000))
    assert.equal(formatAmount(0), grouped.format(0))
    assert.equal(formatInvoiceDate(new Date(2026, 9, 5)), '05/10/2026')
    assert.equal(formatSoldQuantity('CARTON', 10), '10 CARTONS')
    assert.equal(formatSoldQuantity('SEAU', 4), '4 SEAUX')
    assert.equal(formatSoldQuantity('SAC', 3), '3 SACS')
  })

  it('présente la facture relue par le service', () => {
    const detail: SaleDetail = {
      ...buildSale({ paidAmount: 10_000, remainingAmount: 15_000, paymentStatus: 'PARTIELLEMENT_PAYEE' }),
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
      ],
      paymentSummary: {
        paidAmount: 10_000,
        remainingAmount: 15_000,
        status: 'PARTIELLEMENT_PAYEE',
      },
    }

    assert.equal(detail.reference, 'VTE-000001')
    assert.equal(detail.totalAmount, 25_000)
    assert.equal(detail.paidAmount, 10_000)
    assert.equal(detail.remainingAmount, 15_000)
    assert.equal(formatStatusLabel(detail.paymentStatus), 'PARTIELLEMENT PAYEE')
    assert.equal(detail.items[0].lineTotal, 25_000)
  })
})

describe('confirmations', () => {
  it('annonce la restauration du stock avant une annulation', () => {
    const message = buildCancelInvoiceMessage('VTE-000001')

    assert.equal(message.includes('VTE-000001'), true)
    assert.equal(message.includes('restaurera le stock'), true)
    assert.equal(message.includes('ne pourra pas être annulée directement'), true)
  })

  it('met en garde avant la suppression définitive d\'une facture', () => {
    const message = buildDeleteInvoiceMessage('VTE-000001')

    assert.equal(message.includes('VTE-000001'), true)
    assert.equal(message.includes('définitivement'), true)
    assert.equal(message.includes('irréversible'), true)
  })

  it('rappelle le recalcul des montants avant de supprimer un paiement', () => {
    const message = buildDeletePaymentMessage(10_000)

    assert.equal(message.includes('supprimer le paiement'), true)
    assert.equal(message.includes('recalculés'), true)
  })
})