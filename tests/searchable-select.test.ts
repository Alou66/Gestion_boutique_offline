import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  filterSelectOptions,
  normalizeSearchText,
} from '../src/components/searchable-select'
import type { SearchableSelectOption } from '../src/components/searchable-select'

/**
 * Le champ de recherche ne retient que la logique de filtrage :
 * insensible à la casse et aux accents, sur le libellé et
 * l'indice (téléphone, catégorie). Le choix rendu est toujours
 * la valeur d'une option.
 */

function buildOption(overrides: Partial<SearchableSelectOption> = {}): SearchableSelectOption {
  return {
    value: '1',
    label: 'SUCRE 1 KG',
    ...overrides,
  }
}

describe('recherche du champ à choix', () => {
  it('normalise la casse, les accents et les espaces', () => {
    assert.equal(normalizeSearchText('  ÉCOUTEURS  '), 'ecouteurs')
    assert.equal(normalizeSearchText('Lait concentré'), 'lait concentre')
    assert.equal(normalizeSearchText('ÀÉÎÕÜ'), 'aeiou')
    assert.equal(normalizeSearchText(''), '')
  })

  it('retourne toutes les options sans recherche', () => {
    const options = [buildOption(), buildOption({ value: '2', label: 'HUILE' })]

    assert.deepEqual(filterSelectOptions(options, ''), options)
    assert.deepEqual(filterSelectOptions(options, '   '), options)
  })

  it('cherche sans tenir compte de la casse', () => {
    const options = [buildOption()]

    assert.deepEqual(filterSelectOptions(options, 'sucre'), options)
    assert.deepEqual(filterSelectOptions(options, 'SUCRE'), options)
    assert.deepEqual(filterSelectOptions(options, 'SuCre 1'), options)
    assert.deepEqual(filterSelectOptions(options, 'KG'), options)
  })

  it('cherche dans l’indice, pas seulement le libellé', () => {
    const options = [
      buildOption({ hint: 'BOISSONS — 771234567' }),
      buildOption({ value: '2', label: 'RIZ', hint: 'EPICERIE' }),
    ]

    assert.deepEqual(filterSelectOptions(options, 'boissons'), [options[0]])
    assert.deepEqual(filterSelectOptions(options, '77123'), [options[0]])
    assert.deepEqual(filterSelectOptions(options, 'epicerie'), [options[1]])
  })

  it('ignore les accents de part et d’autre', () => {
    const options = [buildOption({ label: 'LAIT CONCENTRÉ' })]

    assert.deepEqual(filterSelectOptions(options, 'concentre'), options)
    assert.deepEqual(filterSelectOptions(options, 'CONCENTRÉ'), options)
  })

  it('écarte les options qui ne correspondent pas', () => {
    const options = [buildOption(), buildOption({ value: '2', label: 'HUILE' })]

    assert.deepEqual(filterSelectOptions(options, 'sel'), [])
    assert.deepEqual(filterSelectOptions(options, 'sucre huile'), [])
  })

  it('garde l’ordre et les options sans indice', () => {
    const options = [
      buildOption(),
      buildOption({ value: '2', label: 'SUCRE 2 KG' }),
      buildOption({ value: '3', label: 'HUILE', hint: undefined }),
    ]

    assert.deepEqual(filterSelectOptions(options, 'sucre'), [
      options[0],
      options[1],
    ])
  })
})
