import { useEffect, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from '@/hooks/useAuth'

interface MainLayoutProps {
  children: ReactNode
}

const NAV_LINKS = [
  { to: '/dashboard', label: 'Tableau de bord' },
  { to: '/categories', label: 'Catégories' },
  { to: '/products', label: 'Produits' },
  { to: '/stock', label: 'Stock' },
]

function MainLayout({ children }: MainLayoutProps) {
  const { status, logout } = useAuth()
  const navigate = useNavigate()
  const [shopName, setShopName] = useState<string | null>(null)

  useEffect(() => {
    let isActive = true

    window.api.settings.get().then((settings) => {
      if (isActive) {
        setShopName(settings?.shopName ?? null)
      }
    })

    return () => {
      isActive = false
    }
  }, [])

  const handleLogout = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-white shadow">
        <div className="container mx-auto flex items-center justify-between px-4 py-4">
          <div>
            <p className="text-sm text-gray-500">Gestion Boutique</p>
            <h1 className="text-xl font-semibold">{shopName ?? 'Ma boutique'}</h1>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600">
              {status?.user?.username}
            </span>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Déconnexion
            </button>
          </div>
        </div>
      </header>
      <nav className="border-b border-gray-200 bg-white">
        <div className="container mx-auto flex flex-wrap gap-6 px-4">
          {NAV_LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                [
                  'border-b-2 py-3 text-sm font-medium',
                  isActive
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-600 hover:text-gray-900',
                ].join(' ')
              }
            >
              {link.label}
            </NavLink>
          ))}
        </div>
      </nav>
      <main className="container mx-auto px-4 py-6">{children}</main>
    </div>
  )
}

export default MainLayout