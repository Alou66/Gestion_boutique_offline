import { HashRouter, Routes, Route } from 'react-router-dom'
import { MainLayout } from '@/layouts'
import { Login, Setup } from '@/pages/auth'
import { Categories } from '@/pages/categories'
import { Clients } from '@/pages/clients'
import { Dashboard } from '@/pages/dashboard'
import { Products } from '@/pages/products'
import { Stock } from '@/pages/stock'
import { SupplyDetail, Supplies } from '@/pages/supplies'
import { TransformationDetail, Transformations } from '@/pages/transformations'
import AuthProvider from '@/context/AuthProvider'
import {
  GuestRoute,
  ProtectedRoute,
  RootRedirect,
  SetupRoute,
} from './ProtectedRoute'

function AppRoutes() {
  return (
    <HashRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<RootRedirect />} />
          <Route
            path="/setup"
            element={
              <SetupRoute>
                <Setup />
              </SetupRoute>
            }
          />
          <Route
            path="/login"
            element={
              <GuestRoute>
                <Login />
              </GuestRoute>
            }
          />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <Dashboard />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/categories"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <Categories />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/clients"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <Clients />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/products"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <Products />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/stock"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <Stock />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/approvisionnements"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <Supplies />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/approvisionnements/:id"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <SupplyDetail />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/transformations"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <Transformations />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/transformations/:id"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <TransformationDetail />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<RootRedirect />} />
        </Routes>
      </AuthProvider>
    </HashRouter>
  )
}

export default AppRoutes