import { createContext } from 'react'
import type {
  AuthCredentials,
  AuthResult,
  AuthSetupInput,
  AuthStatus,
} from '../types'

export interface AuthContextValue {
  status: AuthStatus | null
  isLoading: boolean
  setup: (input: AuthSetupInput) => Promise<AuthResult>
  login: (credentials: AuthCredentials) => Promise<AuthResult>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export type { AuthCredentials, AuthSetupInput }