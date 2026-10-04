import { useAuth } from '@/hooks/useAuth'

function Dashboard() {
  const { status } = useAuth()

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Tableau de bord</h1>
      <p className="text-sm text-gray-600">
        Connecté en tant que {status?.user?.username}
      </p>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border bg-white p-6 shadow">
          <h3 className="text-lg font-semibold">Ventes du jour</h3>
          <p className="text-2xl font-bold">0 FCFA</p>
        </div>
      </div>
    </div>
  )
}

export default Dashboard