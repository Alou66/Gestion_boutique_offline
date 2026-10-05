import type {
  Client,
  ClientFilters,
  ClientInput,
  ClientResult,
  ClientUpdateInput,
} from '../types'

function unwrap<T>(result: ClientResult<T>): T {
  if (result.success) {
    return result.data
  }

  throw new Error(result.error)
}

export const clientService = {
  list: async (filters?: ClientFilters): Promise<Client[]> => {
    return unwrap(await window.api.clients.list(filters))
  },
  get: async (id: number): Promise<Client | null> => {
    return unwrap(await window.api.clients.get(id))
  },
  create: async (input: ClientInput): Promise<Client> => {
    return unwrap(await window.api.clients.create(input))
  },
  update: async (id: number, input: ClientUpdateInput): Promise<Client> => {
    return unwrap(await window.api.clients.update(id, input))
  },
  setActive: async (id: number, isActive: boolean): Promise<Client> => {
    return unwrap(await window.api.clients.setActive(id, isActive))
  },
  isNameAvailable: async (name: string, excludeClientId?: number): Promise<boolean> => {
    return unwrap(await window.api.clients.isNameAvailable(name, excludeClientId))
  },
  isPhoneAvailable: async (phone: string, excludeClientId?: number): Promise<boolean> => {
    return unwrap(await window.api.clients.isPhoneAvailable(phone, excludeClientId))
  },
  ensureSystem: async (): Promise<Client> => {
    return unwrap(await window.api.clients.ensureSystem())
  },
}