import type {
  AuthCredentials,
  AuthResult,
  AuthSetupInput,
  AuthStatus,
} from '../types'

export const authService = {
  status: (): Promise<AuthStatus> => window.api.auth.status(),
  setup: (input: AuthSetupInput): Promise<AuthResult> => window.api.auth.setup(input),
  login: (credentials: AuthCredentials): Promise<AuthResult> =>
    window.api.auth.login(credentials),
  logout: (): Promise<boolean> => window.api.auth.logout(),
}