import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import { registerIpcHandlers } from '../electron/ipc'
import { SUPPLIER_ERRORS, SupplierError } from '../electron/services/supplierService'
import { SYSTEM_SUPPLIER_NAME, SYSTEM_SUPPLIER_PHONE } from '../electron/services/supplierService'
import type { Supplier, SupplierResult } from '../electron/types'
import {
  closeTestDatabase,
  resetTestDatabase,
  seedSystemSupplier,
  seedSimpleSupplier,
} from './helpers/database'
import { invokeHandler, registeredChannels } from './stubs/electron'

function invokeSupplier<T>(channel: string, ...args: unknown[]): SupplierResult<T> {
  return invokeHandler(channel, ...args) as SupplierResult<T>
}

function expectFailure(channel: string, ...args: unknown[]): string {
  const result = invokeSupplier<unknown>(channel, ...args)

  assert.equal(
    result.success,
    false,
    `${channel} must answer with an explicit business error, not a thrown error`,
  )

  return result.success ? '' : result.error
}

function isAvailable(channel: string, ...args: unknown[]): boolean {
  const result = invokeSupplier<boolean>(channel, ...args)

  assert.equal(result.success, true)

  return result.success ? result.data : true
}

describe('canaux IPC des fournisseurs', () => {
  before(() => {
    registerIpcHandlers()
  })

  beforeEach(() => {
    resetTestDatabase()
    seedSystemSupplier()
  })

  after(() => {
    closeTestDatabase()
  })

  it('expose les canaux attendus', () => {
    const channels = registeredChannels()

    for (const channel of [
      'suppliers:list',
      'suppliers:get',
      'suppliers:create',
      'suppliers:update',
      'suppliers:set-active',
      'suppliers:is-name-available',
      'suppliers:is-phone-available',
      'suppliers:ensure-system',
    ]) {
      assert.ok(channels.includes(channel), `missing channel ${channel}`)
    }
  })

  it('crée, liste et lit un fournisseur', () => {
    const created = invokeSupplier<Supplier>('suppliers:create', {
      name: 'Grossiste Sokna',
      phone: '771234567',
      address: 'Dakar',
    })

    assert.equal(created.success, true)

    const supplier = created.success ? created.data : ({} as Supplier)

    assert.equal(supplier.name, 'GROSSISTE SOKNA')
    assert.equal(supplier.phone, '+221771234567')
    assert.equal(supplier.isActive, true)
    assert.equal(supplier.isSystem, false)

    const listed = invokeSupplier<Supplier[]>('suppliers:list')

    assert.equal(listed.success, true)
    assert.equal(listed.success ? listed.data.length : 0, 2)

    const fetched = invokeSupplier<Supplier>('suppliers:get', supplier.id)

    assert.equal(fetched.success, true)
    assert.equal(fetched.success ? fetched.data.name : '', 'GROSSISTE SOKNA')
  })

  it('crée le fournisseur système automatiquement', () => {
    const ensured = invokeSupplier<Supplier>('suppliers:ensure-system')

    assert.equal(ensured.success, true)
    assert.equal(ensured.success ? ensured.data.name : '', SYSTEM_SUPPLIER_NAME)
    assert.equal(ensured.success ? ensured.data.isSystem : false, true)
    assert.equal(ensured.success ? ensured.data.isActive : false, true)
    assert.equal(ensured.success ? ensured.data.phone : '', SYSTEM_SUPPLIER_PHONE)
  })

  it('normalise le nom (majuscules, espaces) et le téléphone', () => {
    const created = invokeSupplier<Supplier>('suppliers:create', {
      name: '  grossiste  sokna  ',
      phone: '77 123 45 67',
    })

    assert.equal(created.success, true)
    assert.equal(created.success ? created.data.name : '', 'GROSSISTE SOKNA')
    assert.equal(created.success ? created.data.phone : '', '+221771234567')
  })

  it('détecte un doublon de nom à la création', () => {
    seedSimpleSupplier('Grossiste Sokna')

    assert.equal(
      expectFailure('suppliers:create', { name: 'grossiste sokna', phone: '770000001' }),
      SUPPLIER_ERRORS.duplicateName,
    )

    assert.equal(
      expectFailure('suppliers:create', { name: '  GROSSISTE  SOKNA ', phone: '770000002' }),
      SUPPLIER_ERRORS.duplicateName,
    )
  })

  it('détecte un doublon de téléphone à la création', () => {
    seedSimpleSupplier('Grossiste Sokna', '771234567')

    assert.equal(
      expectFailure('suppliers:create', { name: 'Autre Fournisseur', phone: '+221771234567' }),
      SUPPLIER_ERRORS.duplicatePhone,
    )
  })

  it('valide les champs obligatoires et le format de téléphone', () => {
    assert.equal(
      expectFailure('suppliers:create', { name: '', phone: '771234567' }),
      SUPPLIER_ERRORS.nameRequired,
    )

    assert.equal(
      expectFailure('suppliers:create', { name: 'AB', phone: '' }),
      SUPPLIER_ERRORS.phoneRequired,
    )

    assert.equal(
      expectFailure('suppliers:create', { name: 'ABC', phone: '123' }),
      SUPPLIER_ERRORS.phoneInvalid,
    )
  })

  it('refuse de créer un fournisseur nommé comme le fournisseur système', () => {
    assert.equal(
      expectFailure('suppliers:create', { name: SYSTEM_SUPPLIER_NAME, phone: '770000003' }),
      SUPPLIER_ERRORS.duplicateName,
    )
  })

  it('active et désactive un fournisseur', () => {
    const supplier = seedSimpleSupplier()

    const deactivated = invokeSupplier<Supplier>('suppliers:set-active', supplier.id, false)

    assert.equal(deactivated.success, true)
    assert.equal(deactivated.success ? deactivated.data.isActive : true, false)

    const inactive = invokeSupplier<Supplier[]>('suppliers:list', { isActive: false })

    assert.equal(inactive.success, true)
    assert.equal(inactive.success ? inactive.data.length : 0, 1)
    assert.equal(inactive.success ? inactive.data[0].id : 0, supplier.id)

    const reactivated = invokeSupplier<Supplier>('suppliers:set-active', supplier.id, true)

    assert.equal(reactivated.success, true)
    assert.equal(reactivated.success ? reactivated.data.isActive : false, true)
  })

  it('filtre la liste par statut et par recherche', () => {
    seedSimpleSupplier('Grossiste Sokna', '771112233')
    const other = seedSimpleSupplier('Dépôt Lat Dior', '772223344')

    const active = invokeSupplier<Supplier[]>('suppliers:list', { isActive: true })

    assert.equal(active.success, true)
    assert.equal(active.success ? active.data.length : 0, 3)

    const found = invokeSupplier<Supplier[]>('suppliers:list', { search: 'lat dior' })

    assert.equal(found.success, true)
    assert.deepEqual(
      found.success ? found.data.map((s) => s.id) : [],
      [other.id],
    )

    const phoneSearch = invokeSupplier<Supplier[]>('suppliers:list', { phoneSearch: '7711' })

    assert.equal(phoneSearch.success, true)
    assert.equal(phoneSearch.success ? phoneSearch.data.length : 0, 1)
  })

  it('modifie un fournisseur existant', () => {
    const supplier = seedSimpleSupplier('Grossiste Sokna', '771112233')

    const updated = invokeSupplier<Supplier>('suppliers:update', supplier.id, {
      name: 'Grossiste Sokna SARL',
      phone: '771234567',
      address: 'Pikine',
    })

    assert.equal(updated.success, true)
    assert.equal(updated.success ? updated.data.name : '', 'GROSSISTE SOKNA SARL')
    assert.equal(updated.success ? updated.data.phone : '', '+221771234567')
    assert.equal(updated.success ? updated.data.address : '', 'Pikine')
  })

  it('conserve son nom propre lors d’une modification sans conflit', () => {
    const supplier = seedSimpleSupplier('Grossiste Sokna')

    assert.equal(isAvailable('suppliers:is-name-available', 'GROSSISTE SOKNA', supplier.id), true)
    assert.equal(isAvailable('suppliers:is-name-available', 'Autre Nom', supplier.id), true)

    assert.equal(isAvailable('suppliers:is-name-available', 'autre nom'), true)
    assert.equal(isAvailable('suppliers:is-name-available', 'grossiste sokna'), false)
    assert.equal(
      isAvailable('suppliers:is-name-available', 'grossiste sokna', supplier.id),
      true,
    )
  })

  it('vérifie la disponibilité du téléphone', () => {
    assert.equal(isAvailable('suppliers:is-phone-available', '771234567'), true)
    assert.equal(isAvailable('suppliers:is-phone-available', '77 123 45 67'), true)
    assert.equal(isAvailable('suppliers:is-phone-available', '+221771234567'), true)

    const supplier = seedSimpleSupplier('Grossiste Sokna', '771234567')

    assert.equal(isAvailable('suppliers:is-phone-available', '771234567'), false)
    assert.equal(
      isAvailable('suppliers:is-phone-available', '771234567', supplier.id),
      true,
    )
  })

  it('refuse de modifier ou désactiver le fournisseur système', () => {
    const system = seedSystemSupplier()

    assert.equal(
      expectFailure('suppliers:update', system.id, { name: 'Autre', phone: '7700000001' }),
      SUPPLIER_ERRORS.systemSupplierImmutable,
    )

    assert.equal(
      expectFailure('suppliers:set-active', system.id, false),
      SUPPLIER_ERRORS.systemSupplierCannotDeactivate,
    )
  })

  it('ne casse pas les canaux existants', () => {
    const suppliers = invokeSupplier<unknown[]>('suppliers:list')
    const supplies = invokeSupplier<unknown[]>('supplies:list')

    assert.equal(suppliers.success, true)
    assert.equal(supplies.success, true)
  })
})

describe('service supplier backend', () => {
  it('SupplierError porte le code et le message métier', () => {
    const error = new SupplierError('duplicateName')

    assert.equal(error.code, 'duplicateName')
    assert.equal(error.message, SUPPLIER_ERRORS.duplicateName)
    assert.equal(error.name, 'SupplierError')
  })
})
