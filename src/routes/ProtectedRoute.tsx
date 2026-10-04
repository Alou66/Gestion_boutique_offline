import { Navigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from '@/hooks/useAuth'

function FullPageLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <p className="text-sm text-gray-600">Chargement…</p>
    </div>
  )
}

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { status, isLoading } = useAuth()

  if (isLoading || !status) {
    return <FullPageLoader />
  }

  if (!status.isConfigured) {
    return <Navigate to="/setup" replace />
  }

  if (!status.isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}

export function GuestRoute({ children }: { children: ReactNode }) {
  const { status, isLoading } = useAuth()

  if (isLoading || !status) {
    return <FullPageLoader />
  }

  if (!status.isConfigured) {
    return <Navigate to="/setup" replace />
  }

  if (status.isAuthenticated) {
    return <Navigate to="/dashboard" replace />
  }

  return <>{children}</>
}

export function SetupRoute({ children }: { children: ReactNode }) {
  const { status, isLoading } = useAuth()

  if (isLoading || !status) {
    return <FullPageLoader />
  }

  if (status.isConfigured) {
    return (
      <Navigate
        to={status.isAuthenticated ? '/dashboard' : '/login'}
        replace
      />
    )
  }

  return <>{children}</>
}

export function RootRedirect() {
  const { status, isLoading } = useAuth()

  if (isLoading || !status) {
    return <FullPageLoader />
  }

  if (!status.isConfigured) {
    return <Navigate to="/setup" replace />
  }

  return <Navigate to={status.isAuthenticated ? '/dashboard' : '/login'} replace />
}