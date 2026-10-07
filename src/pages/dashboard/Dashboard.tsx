import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import type { Client, Product, Sale } from '@/types'
import { formatAmount } from '@/pages/invoices/schemas/invoice.schema'

function useTodayStats() {
  const [sales, setSales] = useState<Sale[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const [allSales, allProducts, allClients] = await Promise.all([
          window.api.invoices.list(),
          window.api.products.list(),
          window.api.clients.list(),
        ])

        if (cancelled) return

        setSales(unwrap(allSales))
        setProducts(unwrap(allProducts))
        setClients(unwrap(allClients))
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Erreur inattendue')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    load()

    return () => {
      cancelled = true
    }
  }, [])

  const today = useMemo(() => {
    const now = new Date()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const day = String(now.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }, [])

  const todaySales = useMemo(
    () => sales.filter((sale) => sale.saleDate.toISOString().startsWith(today)),
    [sales, today],
  )

  const stats = useMemo(
    () => ({
      dayRevenue: todaySales.reduce((sum, sale) => sum + sale.totalAmount, 0),
      dayOrders: todaySales.length,
      activeProducts: products.filter((p) => p.isActive).length,
      activeClients: clients.filter((c) => c.isActive && !c.isSystem).length,
    }),
    [todaySales, products, clients],
  )

  const recentSales = useMemo(
    () => [...sales].sort((a, b) => b.id - a.id).slice(0, 5),
    [sales],
  )

  return { loading, error, stats, recentSales }
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date)
}

function unwrap<T>(result: { success: true; data: T } | { success: false; error: string }): T {
  if (result.success) {
    return result.data
  }
  throw new Error(result.error)
}

function Dashboard() {
  const { status } = useAuth()
  const { loading, error, stats, recentSales } = useTodayStats()

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-sm text-gray-500">Chargement du tableau de bord...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-700">
        Impossible de charger les statistiques : {error}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Tableau de bord</h1>
        <p className="mt-1 text-sm text-gray-600">
          Connecté en tant que {status?.user?.username}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Ventes du jour"
          value={formatAmount(stats.dayRevenue)}
          subtext={`${stats.dayOrders} commande${stats.dayOrders > 1 ? 's' : ''}`}
          icon={<RevenueIcon />}
          color="emerald"
        />
        <StatCard
          label="Commandes du jour"
          value={String(stats.dayOrders)}
          subtext="Factures validées"
          icon={<OrdersIcon />}
          color="blue"
        />
        <StatCard
          label="Produits en stock"
          value={String(stats.activeProducts)}
          subtext="Articles actifs"
          icon={<ProductsIcon />}
          color="amber"
        />
        <StatCard
          label="Clients actifs"
          value={String(stats.activeClients)}
          subtext="Hors système"
          icon={<ClientsIcon />}
          color="violet"
        />
      </div>

      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 px-6 py-4">
          <h2 className="text-base font-semibold text-gray-900">Dernières factures</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 font-medium text-gray-600">Référence</th>
                <th className="px-6 py-3 font-medium text-gray-600">Client</th>
                <th className="px-6 py-3 font-medium text-gray-600">Date</th>
                <th className="px-6 py-3 font-medium text-gray-600">Montant</th>
                <th className="px-6 py-3 font-medium text-gray-600">Statut</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {recentSales.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-sm text-gray-500">
                    Aucune facture enregistrée pour le moment.
                  </td>
                </tr>
              ) : (
                recentSales.map((sale) => (
                  <tr key={sale.id} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap px-6 py-3 font-medium text-gray-900">
                      {sale.reference}
                    </td>
                    <td className="whitespace-nowrap px-6 py-3 text-gray-700">
                      {sale.clientName}
                    </td>
                    <td className="whitespace-nowrap px-6 py-3 text-gray-600">
                      {formatDate(sale.saleDate)}
                    </td>
                    <td className="whitespace-nowrap px-6 py-3 text-gray-900">
                      {formatAmount(sale.totalAmount)}
                    </td>
                    <td className="whitespace-nowrap px-6 py-3">
                      <StatusBadge status={sale.paymentStatus} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function StatCard({
  label,
  value,
  subtext,
  icon,
  color,
}: {
  label: string
  value: string
  subtext: string
  icon: React.ReactNode
  color: 'emerald' | 'blue' | 'amber' | 'violet'
}) {
  const colorMap = {
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    blue: 'bg-blue-50 text-blue-700 border-blue-100',
    amber: 'bg-amber-50 text-amber-700 border-amber-100',
    violet: 'bg-violet-50 text-violet-700 border-violet-100',
  }

  return (
    <div className={`rounded-xl border ${colorMap[color]} p-5`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-gray-600">
          {label}
        </span>
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/60">
          {icon}
        </span>
      </div>
      <p className="mt-3 text-2xl font-bold">{value}</p>
      <p className="mt-1 text-xs text-gray-600">{subtext}</p>
    </div>
  )
}

function StatusBadge({ status }: { status: 'NON_PAYEE' | 'PARTIELLEMENT_PAYEE' | 'PAYEE' }) {
  const styles: Record<string, string> = {
    PAYEE: 'bg-green-100 text-green-700',
    PARTIELLEMENT_PAYEE: 'bg-yellow-100 text-yellow-700',
    NON_PAYEE: 'bg-red-100 text-red-700',
  }

  const labels: Record<string, string> = {
    PAYEE: 'Payée',
    PARTIELLEMENT_PAYEE: 'Partielle',
    NON_PAYEE: 'Non payée',
  }

  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[status] ?? 'bg-gray-100 text-gray-700'}`}>
      {labels[status] ?? status}
    </span>
  )
}

function RevenueIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
      <path d="M10.75 10.818v2.614a3.13 3.13 0 0 0 1.286-.023 2.25 2.25 0 0 0 1.439-1.342 2.25 2.25 0 0 0-.712-2.42 2.25 2.25 0 0 0-1.439-.993 3.13 3.13 0 0 0-2.828 1.836l-.505 1.007a.75.75 0 0 1-1.324.004l-.505-1.007a3.13 3.13 0 0 0-2.828-1.836 2.25 2.25 0 0 0-1.439.993 2.25 2.25 0 0 0-.712 2.42 2.25 2.25 0 0 0 1.439 1.342c.476.194 1.022.18 1.286.023v-2.614a3.13 3.13 0 0 0-1.286.023 2.25 2.25 0 0 0-1.439 1.342 2.25 2.25 0 0 0 .712 2.42 2.25 2.25 0 0 0 1.439.993 3.13 3.13 0 0 0 2.828-1.836l.505-1.007a.75.75 0 0 1 1.324.004l.505 1.007a3.13 3.13 0 0 0 2.828 1.836 2.25 2.25 0 0 0 1.439-.993 2.25 2.25 0 0 0 .712-2.42 2.25 2.25 0 0 0-1.439-1.342 3.13 3.13 0 0 0-1.286-.023Z" />
    </svg>
  )
}

function OrdersIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
      <path d="M1 4.25A2.25 2.25 0 0 1 3.25 2h3.5A2.25 2.25 0 0 1 9 4.25v2.5A2.25 2.25 0 0 1 6.75 9h-3.5A2.25 2.25 0 0 1 1 6.75v-2.5ZM9 10.75A2.25 2.25 0 0 1 11.25 8h3.5A2.25 2.25 0 0 1 17 10.25v2.5A2.25 2.25 0 0 1 14.75 15h-3.5A2.25 2.25 0 0 1 9 12.75v-2ZM3.25 11a.75.75 0 0 1 .75-.75h3.5a.75.75 0 0 1 0 1.5h-3.5a.75.75 0 0 1-.75-.75Z" />
    </svg>
  )
}

function ProductsIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
      <path fillRule="evenodd" d="M10 1a4.5 4.5 0 0 0-4.5 4.5H9a5.5 5.5 0 0 1 5.5-5.5V1ZM3.5 6A1.5 1.5 0 0 0 2 7.5v8A1.5 1.5 0 0 0 3.5 17h8a1.5 1.5 0 0 0 1.5-1.5v-8A1.5 1.5 0 0 0 11.5 6h-8Z" clipRule="evenodd" />
    </svg>
  )
}

function ClientsIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
      <path d="M7 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM14.5 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM1.615 10.69a1.125 1.125 0 0 1 1.35-.53l4.5 2.1a1.125 1.125 0 0 1 .62 1.82l-1.35 2.625a1.125 1.125 0 0 1-1.82.62l-4.5-2.1a1.125 1.125 0 0 1-.53-1.35l.82-4.05Z" />
    </svg>
  )
}

export default Dashboard
