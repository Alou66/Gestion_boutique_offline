import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Product } from '../electron/types'
import {
  buildValidationMessage,
  computeLineTotal,
  createEmptyDraft,
  formatAmount,
  formatReceivedQuantity,
  getLineKey,
  getProductForms,
  isSameLine,
  parseNumberField,
  readDraftLineTotal,
  sumLineTotals,
  SUPPLY_MESSAGES,
  supplyFormSchema,
  supplyItemFormSchema,
  toDraft,
  toSupplyInput,
  validateDraftLine,
} from '../src/pages/supplies/schemas/supply.schema'
import type { SupplyLineDraft } from '../src/pages/supplies/schemas/supply.schema'

/**
 * The rules of the approvisionnement form. The main process stays the authority
 * and validates everything again: these checks only make the shopkeeper see the
 * error before the round trip.
 */
function buildSimpleProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 1,
    name: 'SUCRE 1 KG',
    categoryId: 1,
    categoryName: 'BOISSONS',
    purchasePrice: 5_000,
    salePrice: 7_000,
    isTransformable: false,
    primaryForm: 'SAC',
    secondaryForm: null,
    conversionQuantity: null,
    secondarySalePrice: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

function buildTransformableProduct(overrides: Partial<Product> = {}): Product {
  return buildSimpleProduct({
    id: 2,
    name: 'CHOCOPAIN 5 KG',
    isTransformable: true,
    primaryForm: 'CARTON',
    secondaryForm: 'SEAU',
    conversionQuantity: 4,
    secondarySalePrice: 4_000,
    ...overrides,
  })
}

describe('formulaire d\'approvisionnement', () => {
  it('accepte un document valide avec plusieurs lignes', () => {
    const parsed = supplyFormSchema.safeParse({
      date: '2026-10-04',
      supplierName: '  Grossiste Sokna  ',
      items: [
        { productId: 1, form: 'SAC', quantity: 10, purchaseUnitPrice: 2_500 },
        { productId: 2, form: 'CARTON', quantity: 4, purchaseUnitPrice: 10_000 },
      ],
    })

    assert.equal(parsed.success, true)

    const payload = parsed.success ? toSupplyInput(parsed.data) : null

    assert.equal(payload?.date, '2026-10-04')
    assert.equal(payload?.supplierName, 'Grossiste Sokna')
    assert.deepEqual(payload?.items, [
      { productId: 1, form: 'SAC', quantity: 10, purchaseUnitPrice: 2_500 },
      { productId: 2, form: 'CARTON', quantity: 4, purchaseUnitPrice: 10_000 },
    ])
  })

  it('refuse un document sans ligne', () => {
    const parsed = supplyFormSchema.safeParse({
      date: '2026-10-04',
      supplierName: '',
      items: [],
    })

    assert.equal(parsed.success, false)
    assert.equal(parsed.success ? '' : parsed.error.issues[0].message, SUPPLY_MESSAGES.itemsRequired)
  })

  it('refuse une date absente, mal formée ou hors plage', () => {
    const cases: [unknown, string][] = [
      ['', SUPPLY_MESSAGES.dateRequired],
      ['04/10/2026', SUPPLY_MESSAGES.dateInvalid],
      ['2026-13-01', SUPPLY_MESSAGES.dateInvalid],
      ['2026-02-31', SUPPLY_MESSAGES.dateInvalid],
      ['1999-12-31', SUPPLY_MESSAGES.dateOutOfRange],
    ]

    for (const [date, expected] of cases) {
      const parsed = supplyFormSchema.safeParse({
        date,
        supplierName: '',
        items: [{ productId: 1, form: 'SAC', quantity: 1, purchaseUnitPrice: 100 }],
      })

      assert.equal(parsed.success, false, `${String(date)} must be refused`)
      assert.equal(parsed.success ? '' : parsed.error.issues[0].message, expected)
    }
  })

  it('refuse une quantité nulle, négative ou non entière', () => {
    for (const quantity of [0, -1, 1.5]) {
      const parsed = supplyFormSchema.safeParse({
        date: '2026-10-04',
        supplierName: '',
        items: [{ productId: 1, form: 'SAC', quantity, purchaseUnitPrice: 100 }],
      })

      assert.equal(parsed.success, false, `${quantity} must be refused`)
      assert.equal(
        parsed.success ? '' : parsed.error.issues[0].message,
        SUPPLY_MESSAGES.quantityInvalid,
      )
    }
  })

  it('refuse un prix négatif ou décimal et accepte zéro', () => {
    for (const purchaseUnitPrice of [-1, 1.5]) {
      const parsed = supplyFormSchema.safeParse({
        date: '2026-10-04',
        supplierName: '',
        items: [{ productId: 1, form: 'SAC', quantity: 1, purchaseUnitPrice }],
      })

      assert.equal(parsed.success, false, `${purchaseUnitPrice} must be refused`)
    }

    const free = supplyFormSchema.safeParse({
      date: '2026-10-04',
      supplierName: '',
      items: [{ productId: 1, form: 'SAC', quantity: 1, purchaseUnitPrice: 0 }],
    })

    assert.equal(free.success, true)
  })

  it('refuse deux lignes du même produit dans la même forme', () => {
    const parsed = supplyFormSchema.safeParse({
      date: '2026-10-04',
      supplierName: '',
      items: [
        { productId: 1, form: 'SAC', quantity: 10, purchaseUnitPrice: 2_500 },
        { productId: 1, form: 'SAC', quantity: 5, purchaseUnitPrice: 2_500 },
      ],
    })

    assert.equal(parsed.success, false)
    assert.equal(
      parsed.success ? '' : parsed.error.issues[0].message,
      SUPPLY_MESSAGES.duplicateLine,
    )
  })

  it('accepte le même produit dans deux formes différentes', () => {
    const parsed = supplyFormSchema.safeParse({
      date: '2026-10-04',
      supplierName: '',
      items: [
        { productId: 2, form: 'CARTON', quantity: 10, purchaseUnitPrice: 10_000 },
        { productId: 2, form: 'SEAU', quantity: 5, purchaseUnitPrice: 2_500 },
      ],
    })

    assert.equal(parsed.success, true)
  })

  it('propose les formes du produit sélectionné', () => {
    assert.deepEqual(getProductForms(buildSimpleProduct()), ['SAC'])
    assert.deepEqual(getProductForms(buildTransformableProduct()), ['CARTON', 'SEAU'])
    assert.deepEqual(getProductForms(null), [])
  })

  it('refuse une ligne dont la forme n\'appartient pas au produit', () => {
    const products = [buildSimpleProduct(), buildTransformableProduct()]

    assert.equal(
      validateDraftLine(1, 'SAC', products),
      null,
    )
    assert.equal(
      validateDraftLine(2, 'CARTON', products),
      null,
    )
    assert.equal(
      validateDraftLine(2, 'SEAU', products),
      null,
    )
    assert.equal(
      validateDraftLine(1, 'CARTON', products),
      SUPPLY_MESSAGES.formInvalid,
    )
    assert.equal(
      validateDraftLine(2, 'BIDON', products),
      SUPPLY_MESSAGES.formInvalid,
    )
    assert.equal(
      validateDraftLine(4242, 'SAC', products),
      SUPPLY_MESSAGES.productNotFound,
    )
    assert.equal(
      validateDraftLine(1, 'SAC', [buildSimpleProduct({ isActive: false })]),
      SUPPLY_MESSAGES.productInactive,
    )
  })

  it('accepte une ligne sur un produit dont le stock n’a aucun mouvement', () => {
    const products = [buildSimpleProduct(), buildTransformableProduct()]

    // The stock of a product without any movement is 0: nothing to initialize
    // before receiving it, the editor must not block the line.
    assert.equal(validateDraftLine(1, 'SAC', products), null)
    assert.equal(validateDraftLine(2, 'CARTON', products), null)
    assert.equal(validateDraftLine(2, 'SEAU', products), null)
  })

  it('formate les montants et les quantités pour l\'affichage', () => {
    // fr-FR groups thousands with a narrow no break space.
    const grouped = new Intl.NumberFormat('fr-FR')

    assert.equal(formatAmount(300_000), `${grouped.format(300_000)} FCFA`)
    assert.equal(formatAmount(0), `${grouped.format(0)} FCFA`)
    assert.equal(formatReceivedQuantity('CARTON', 10), '10 CARTONS')
    assert.equal(formatReceivedQuantity('SEAU', 4), '4 SEAUX')
  })

  it('crée une ligne vide et garde les champs numériques vides en undefined', () => {
    const draft = createEmptyDraft()

    assert.equal(draft.productId, '')
    assert.equal(draft.form, '')
    assert.equal(draft.quantity, '')
    assert.equal(draft.purchaseUnitPrice, '')
    assert.equal(parseNumberField(''), undefined)
    assert.equal(parseNumberField(' 12 '), 12)
  })
})

/**
 * The single line editor: the same inputs are reused for every product, a line
 * moves to the list when it is added, and an added line can be reloaded to be
 * modified.
 */
describe('saisie des lignes d\'approvisionnement', () => {
  function buildLine(overrides: Partial<SupplyLineDraft> = {}): SupplyLineDraft {
    return {
      key: 'line-1',
      productId: 1,
      form: 'SAC',
      quantity: 10,
      purchaseUnitPrice: 2_500,
      lineTotal: 25_000,
      ...overrides,
    }
  }

  it('valide une ligne unique avant de l\'ajouter', () => {
    const parsed = supplyItemFormSchema.safeParse({
      productId: 1,
      form: 'SAC',
      quantity: 12,
      purchaseUnitPrice: 19_500,
    })

    assert.equal(parsed.success, true)

    const stillRefused = supplyItemFormSchema.safeParse({
      productId: 1,
      form: 'SAC',
      quantity: 0,
      purchaseUnitPrice: 19_500,
    })

    assert.equal(stillRefused.success, false)
  })

  it('calcule le total de la ligne saisie puis celui du document', () => {
    assert.equal(computeLineTotal(12, 19_500), 234_000)
    // Display only: an input still being typed never produces NaN.
    assert.equal(computeLineTotal(NaN, 19_500), 0)
    assert.equal(computeLineTotal(10, -1), 0)

    assert.equal(
      readDraftLineTotal({
        key: 'k',
        productId: '1',
        form: 'SAC',
        quantity: '12',
        purchaseUnitPrice: '19500',
      }),
      234_000,
    )

    assert.equal(
      readDraftLineTotal({
        key: 'k',
        productId: '1',
        form: 'SAC',
        quantity: '',
        purchaseUnitPrice: '19500',
      }),
      0,
    )

    assert.equal(
      sumLineTotals([
        buildLine(),
        buildLine({ key: 'line-2', productId: 2, quantity: 4, purchaseUnitPrice: 10_000, lineTotal: 40_000 }),
      ]),
      65_000,
    )
  })

  it('identifie une ligne par son produit et sa forme', () => {
    assert.equal(getLineKey(1, 'SAC'), getLineKey(1, ' sac '))
    assert.notEqual(getLineKey(1, 'SAC'), getLineKey(1, 'SEAU'))
    assert.notEqual(getLineKey(1, 'SAC'), getLineKey(2, 'SAC'))
  })

  it('recharge une ligne dans les champs sans la modifier', () => {
    const line = buildLine()
    const draft = toDraft(line)

    assert.deepEqual(draft, {
      key: 'line-1',
      productId: '1',
      form: 'SAC',
      quantity: '10',
      purchaseUnitPrice: '2500',
    })
    assert.equal(isSameLine(draft, line), true)

    // A changed quantity makes the editor dirty: it must be committed first.
    assert.equal(isSameLine({ ...draft, quantity: '15' }, line), false)
    assert.equal(isSameLine({ ...draft, form: 'CARTON' }, line), false)
  })

  it('refuse un produit inexistant, inactif ou mal formé dans l\'éditeur', () => {
    const products = [buildSimpleProduct(), buildTransformableProduct()]

    assert.equal(validateDraftLine(1, 'SAC', products), null)
    assert.equal(validateDraftLine(1, 'CARTON', products), SUPPLY_MESSAGES.formInvalid)
    assert.equal(validateDraftLine(4242, 'SAC', products), SUPPLY_MESSAGES.productNotFound)
    assert.equal(
      validateDraftLine(1, 'SAC', [buildSimpleProduct({ isActive: false })]),
      SUPPLY_MESSAGES.productInactive,
    )
  })

  it('rappelle qu\'une ligne saisie doit être ajoutée avant de valider', () => {
    assert.equal(
      typeof SUPPLY_MESSAGES.lineNotCommitted,
      'string',
    )
    assert.equal(SUPPLY_MESSAGES.lineNotCommitted.length > 0, true)
  })

it('résume le document avant la confirmation', () => {
    const message = buildValidationMessage({
      date: '2026-10-04',
      supplierName: 'Grossiste Sokna',
      items: [
        { productId: 1, form: 'SAC', quantity: 10, purchaseUnitPrice: 2_500 },
        { productId: 2, form: 'CARTON', quantity: 5, purchaseUnitPrice: 10_000 },
      ],
    })

    // 25 000 + 50 000
    assert.equal(message.includes('2 lignes'), true)
    assert.equal(message.includes('Grossiste Sokna'), true)
    assert.equal(message.includes(new Intl.NumberFormat('fr-FR').format(75_000)), true)
    assert.equal(message.includes('ne pourra plus être modifié'), true)

    const single = buildValidationMessage({
      date: '2026-10-04',
      supplierName: null,
      items: [{ productId: 1, form: 'SAC', quantity: 10, purchaseUnitPrice: 2_500 }],
    })

    assert.equal(single.includes('1 ligne '), true)
    assert.equal(single.includes('fournisseur'), false)
  })
})
