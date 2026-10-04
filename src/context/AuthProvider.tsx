import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { AuthContext } from './authContext'
import type { AuthContextValue } from './authContext'
import { authService } from '@/services'
import type { AuthCredentials, AuthSetupInput, AuthResult, AuthStatus } from '@/types'

function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const refresh = useCallback(async () => {
    const next = await authService.status()
    setStatus(next)
  }, [])

  useEffect(() => {
    let isActive = true

    authService
      .status()
      .then((next) => {
        if (isActive) {
          setStatus(next)
        }
      })
      .finally(() => {
        if (isActive) {
          setIsLoading(false)
        }
      })

    return () => {
      isActive = false
    }
  }, [])

  const setup = useCallback(
    async (input: AuthSetupInput): Promise<AuthResult> => {
      const result = await authService.setup(input)
      await refresh()
      return result
    },
    [refresh],
  )

  const login = useCallback(
    async (credentials: AuthCredentials): Promise<AuthResult> => {
      const result = await authService.login(credentials)
      await refresh()
      return result
    },
    [refresh],
  )

  const logout = useCallback(async () => {
    await authService.logout()
    await refresh()
  }, [refresh])

  const value = useMemo<AuthContextValue>(
    () => ({ status, isLoading, setup, login, logout, refresh }),
    [status, isLoading, setup, login, logout, refresh],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export default AuthProvider