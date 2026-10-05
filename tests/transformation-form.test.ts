import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Product } from '../electron/types'
import {
  computeDestinationQuantity,
  formatConversionRule,
  formatFormQuantity,
  formatTransformationDate,
  formatTransformationSentence,
  getConversionRatio,
  getDestinationForm,
  getProductForms,
  parseNumberField,
  toTransformationInput,
  TRANSFORMATION_MESSAGES,
  transformationFormSchema,
  validateTransformationDraft,
} from '../src/pages/transformations/schemas/transformation.schema'

/**
 * The rules of the transformation form. The main process stays the authority and
 * validates everything again: these checks only make the shopkeeper see the
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

const product = buildTransformableProduct()
const products = [buildSimpleProduct(), product]

function parse(overrides: Record<string, unknown> = {}) {
  return transformationFormSchema.safeParse({
    date: '2026-10-04',
    productId: 2,
    sourceForm: 'CARTON',
    sourceQuantity: 2,
    ...overrides,
  })
}

describe('formulaire de transformation', () => {
  it('accepte une transformation valide et n\'envoie que la source', () => {
    const parsed = parse()

    assert.equal(parsed.success, true)

    const payload = parsed.success ? toTransformationInput(parsed.data) : null

    assert.deepEqual(payload, {
      productId: 2,
      sourceForm: 'CARTON',
      sourceQuantity: 2,
      date: '2026-10-04',
    })
    // The destination form and quantity are recomputed by the main process: they
    // are never sent by the renderer.
    assert.equal('destinationForm' in (payload ?? {}), false)
    assert.equal('destinationQuantity' in (payload ?? {}), false)
  })

  it('refuse un produit absent', () => {
    const parsed = parse({ productId: undefined })

    assert.equal(parsed.success, false)
    assert.equal(
      parsed.success ? '' : parsed.error.issues[0].message,
      TRANSFORMATION_MESSAGES.productRequired,
    )
  })

  it('refuse une forme absente', () => {
    const parsed = parse({ sourceForm: '   ' })

    assert.equal(parsed.success, false)
    assert.equal(
      parsed.success ? '' : parsed.error.issues[0].message,
      TRANSFORMATION_MESSAGES.formRequired,
    )
  })

  it('refuse une quantité nulle, négative ou décimale', () => {
    for (const sourceQuantity of [0, -1, 1.5]) {
      const parsed = parse({ sourceQuantity })

      assert.equal(parsed.success, false, `${sourceQuantity} must be refused`)
      assert.equal(
        parsed.success ? '' : parsed.error.issues[0].message,
        TRANSFORMATION_MESSAGES.quantityInvalid,
      )
    }
  })

  it('refuse une date mal formée', () => {
    assert.equal(parse({ date: '04/10/2026' }).success, false)
    assert.equal(parse({ date: '' }).success, false)
    assert.equal(parse({ date: '2026-10-04' }).success, true)
  })

  it('ne propose les deux formes que pour un produit transformable', () => {
    assert.deepEqual(getProductForms(product), ['CARTON', 'SEAU'])
    assert.deepEqual(getProductForms(buildSimpleProduct()), [])
    assert.deepEqual(getProductForms(null), [])
  })

  it('détermine la destination comme l\'autre forme du produit', () => {
    assert.equal(getDestinationForm(product, 'CARTON'), 'SEAU')
    assert.equal(getDestinationForm(product, 'SEAU'), 'CARTON')
    assert.equal(getDestinationForm(product, 'BIDON'), null)
    assert.equal(getDestinationForm(buildSimpleProduct(), 'SAC'), null)

    // Source and destination can never be the same form.
    for (const sourceForm of getProductForms(product)) {
      assert.notEqual(getDestinationForm(product, sourceForm), sourceForm)
    }
  })

  it('affiche la règle de conversion', () => {
    assert.equal(formatConversionRule(product), '1 CARTON = 4 SEAUX')
    assert.equal(
      formatConversionRule(
        buildTransformableProduct({ primaryForm: 'SACHET', secondaryForm: 'PAQUET' }),
      ),
      '1 SACHET = 4 PAQUETS',
    )
    assert.equal(formatConversionRule(buildSimpleProduct()), null)
    assert.equal(formatConversionRule(buildTransformableProduct({ conversionQuantity: 0 })), null)
  })

  it('lit le ratio de conversion', () => {
    assert.equal(getConversionRatio(product), 4)
    assert.equal(getConversionRatio(buildSimpleProduct()), null)
    assert.equal(getConversionRatio(buildTransformableProduct({ conversionQuantity: null })), null)
    assert.equal(getConversionRatio(buildTransformableProduct({ conversionQuantity: 0 })), null)
  })

  it('calcule la quantité destination de façon exacte', () => {
    assert.equal(computeDestinationQuantity(product, 'CARTON', 1), 4)
    assert.equal(computeDestinationQuantity(product, 'CARTON', 2), 8)
    assert.equal(computeDestinationQuantity(product, 'CARTON', 3), 12)
    assert.equal(computeDestinationQuantity(product, 'SEAU', 4), 1)
    assert.equal(computeDestinationQuantity(product, 'SEAU', 8), 2)
  })

  it('refuse toute conversion fractionnaire', () => {
    // 1 SEAU = 0.25 CARTON and 5 SEAUX = 1.25 CARTONS: no rounding, no loss.
    assert.equal(computeDestinationQuantity(product, 'SEAU', 1), null)
    assert.equal(computeDestinationQuantity(product, 'SEAU', 5), null)
    assert.equal(computeDestinationQuantity(product, 'SEAU', 6), null)
    assert.equal(computeDestinationQuantity(product, 'SEAU', 7), null)
  })

  it('refuse un produit inexistant, simple, inactif ou sans conversion', () => {
    assert.equal(validateTransformationDraft(2, 'CARTON', products), null)
    assert.equal(validateTransformationDraft(2, 'SEAU', products), null)
    assert.equal(
      validateTransformationDraft(4242, 'CARTON', products),
      TRANSFORMATION_MESSAGES.productNotFound,
    )
    assert.equal(
      validateTransformationDraft(1, 'SAC', products),
      TRANSFORMATION_MESSAGES.productNotTransformable,
    )
    assert.equal(
      validateTransformationDraft(2, 'BIDON', products),
      TRANSFORMATION_MESSAGES.formInvalid,
    )
    assert.equal(
      validateTransformationDraft(2, 'CARTON', [
        buildTransformableProduct({ isActive: false }),
      ]),
      TRANSFORMATION_MESSAGES.productInactive,
    )
    assert.equal(
      validateTransformationDraft(2, 'CARTON', [
        buildTransformableProduct({ conversionQuantity: 0 }),
      ]),
      TRANSFORMATION_MESSAGES.productNotTransformable,
    )
  })

  it('formate les phrases de la confirmation et de l\'historique', () => {
    assert.equal(formatFormQuantity('CARTON', 1), '1 CARTON')
    assert.equal(formatFormQuantity('CARTON', 2), '2 CARTONS')
    assert.equal(formatFormQuantity('SEAU', 8), '8 SEAUX')
    assert.equal(
      formatTransformationSentence('CARTON', 2, 'SEAU', 8),
      '2 CARTONS → 8 SEAUX',
    )
    assert.equal(
      formatTransformationSentence('SEAU', 4, 'CARTON', 1),
      '4 SEAUX → 1 CARTON',
    )
    assert.equal(formatTransformationDate(new Date(2026, 9, 4)), '04/10/2026')
  })

  it('garde les champs numériques vides en undefined', () => {
    assert.equal(parseNumberField(''), undefined)
    assert.equal(parseNumberField(' 12 '), 12)
  })
})