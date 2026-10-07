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
  { to: '/clients', label: 'Clients' },
  { to: '/factures', label: 'Facturation' },
  { to: '/products', label: 'Produits' },
  { to: '/stock', label: 'Stock' },
  { to: '/approvisionnements', label: 'Approvisionnements' },
  { to: '/transformations', label: 'Transformations' },
  { to: '/parametres', label: 'Paramètres' },
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
    <div className="flex min-h-screen bg-gray-100">
      {/* Sidebar fixe à gauche */}
      <aside className="fixed inset-y-0 left-0 z-30 flex w-64 flex-col bg-gray-900 text-gray-100">
        <div className="flex h-16 items-center border-b border-gray-700 px-6">
          <div>
            <p className="text-xs text-gray-400">Gestion Boutique</p>
            <h2 className="text-lg font-semibold leading-tight">{shopName ?? 'Ma boutique'}</h2>
          </div>
        </div>

        <div className="border-b border-gray-700 p-4">
          <button
            type="button"
            onClick={() => navigate('/factures/nouveau')}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-900"
            aria-label="Créer une nouvelle facture"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="h-4 w-4"
              aria-hidden="true"
            >
              <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
            </svg>
            Nouvelle facture
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto py-4">
          {NAV_LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                [
                  'flex items-center px-6 py-2.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-300 hover:bg-gray-800 hover:text-white',
                ].join(' ')
              }
            >
              {link.label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-gray-700 p-4">
          <p className="mb-2 truncate text-xs text-gray-400">{status?.user?.username}</p>
          <button
            type="button"
            onClick={handleLogout}
            className="w-full rounded-md border border-gray-600 px-3 py-1.5 text-sm font-medium text-gray-300 hover:bg-gray-800 hover:text-white"
          >
            Déconnexion
          </button>
        </div>
      </aside>

      {/* Contenu principal décalé par le sidebar fixe */}
      <div className="ml-64 flex flex-1 flex-col">
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  )
}

export default MainLayout