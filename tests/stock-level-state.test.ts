import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  formatRowForms,
  formatRowQuantities,
  getEmptyForms,
  getStockLevelState,
} from '../src/pages/stock/schemas/stock.schema'
import type { StockProductRow } from '../src/pages/stock/schemas/stock.schema'

/**
 * The stock row rules of the page: one row per product, the two forms side by
 * side, and a single state for the product.
 *
 * Business rules: a product without any movement has a logical stock of 0, and a
 * product is in Rupture only when EVERY form is empty.
 */
function buildRow(quantities: number[]): StockProductRow {
  const forms = ['CARTON', 'GROSSE']

  return {
    levels: quantities.map((quantity, index) => ({
      form: forms[index] ?? `FORME ${index + 1}`,
      quantity,
      hasMovements: quantity > 0,
      isLegacyForm: false,
      isProductActive: true,
    })),
  }
}

describe('état du stock affiché', () => {
  it('affiche les deux formes et les deux quantités sur une seule ligne', () => {
    const row = buildRow([20, 2])

    assert.equal(formatRowForms(row), 'CARTON / GROSSE')
    assert.equal(formatRowQuantities(row), '20 / 2')
  })

  it('est Normal tant qu’une forme est disponible', () => {
    assert.equal(getStockLevelState(buildRow([20, 2])), 'NORMAL')
    assert.equal(getStockLevelState(buildRow([1, 1])), 'NORMAL')
    // Une forme vide n’est pas une rupture si l’autre forme est servie.
    assert.equal(getStockLevelState(buildRow([3, 0])), 'NORMAL')
    assert.equal(getStockLevelState(buildRow([0, 2])), 'NORMAL')
  })

  it('est en Rupture seulement quand toutes les formes sont à zéro', () => {
    assert.equal(getStockLevelState(buildRow([0, 0])), 'RUPTURE')
  })

  it('est en Rupture pour un produit simple à zéro', () => {
    assert.equal(getStockLevelState(buildRow([0])), 'RUPTURE')
    assert.equal(getStockLevelState(buildRow([1])), 'NORMAL')
  })

  it('affiche un produit sans mouvement comme un stock à zéro', () => {
    const row = buildRow([0, 0])

    assert.equal(getStockLevelState(row), 'RUPTURE')
    assert.equal(formatRowQuantities(row), '0 / 0')
  })

  it('affiche un produit simple sans mouvement comme un stock à zéro', () => {
    const row = buildRow([0])

    assert.equal(getStockLevelState(row), 'RUPTURE')
    assert.equal(formatRowQuantities(row), '0')
  })

  it('montre 0 et non une valeur vide pour une forme à zéro', () => {
    assert.equal(formatRowQuantities(buildRow([3, 0])), '3 / 0')
    assert.equal(formatRowQuantities(buildRow([0, 0])), '0 / 0')
    assert.equal(buildRow([3, 0]).levels[1]?.quantity, 0)
  })

  it('signale les formes vides d’un produit Normal', () => {
    assert.deepEqual(getEmptyForms(buildRow([3, 0])), ['GROSSE'])
    assert.deepEqual(getEmptyForms(buildRow([0, 2])), ['CARTON'])
    assert.deepEqual(getEmptyForms(buildRow([20, 2])), [])
    assert.deepEqual(getEmptyForms(buildRow([0, 0])), ['CARTON', 'GROSSE'])
  })

  it('conserve l’état Normal et ses formes sans stock après une réception', () => {
    const row = buildRow([5, 0])

    assert.equal(getStockLevelState(row), 'NORMAL')
    assert.equal(formatRowQuantities(row), '5 / 0')
    assert.deepEqual(getEmptyForms(row), ['GROSSE'])
  })
})