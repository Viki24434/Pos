import { useEffect, useState } from 'react';
import { HashRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import MainLayout from './components/MainLayout/MainLayout';
import Login from './pages/Login/Login';
import Activation from './pages/Activation/Activation';
import Dashboard from './pages/Dashboard/Dashboard';

import Orders from './pages/Orders/Orders';
import Receivables from './pages/Receivables/Receivables';
import IncomingStock from './pages/IncomingStock/IncomingStock';
import CreateOrder from './pages/Orders/Create';
import Products from './pages/Products/Products';
import Customers from './pages/Customers/Customers';
import Finance from './pages/Finance/Finance';
import Reports from './pages/Reports/Reports';
import Users from './pages/Users/Users';
import Settings from './pages/Settings/Settings';
import { can, homePath } from '../shared/permissions';

function PrivateRoute({ children }) {
  const { user, checking } = useAuth();
  if (checking) return <p>Memuat sesi...</p>;
  return user ? children : <Navigate to="/login" replace />;
}

function AccessRoute({ permission, children }) {
  const { user } = useAuth();
  const allowed = (Array.isArray(permission) ? permission : [permission]).some(key => can(user, key));
  return allowed ? children : <Navigate to={homePath(user)} replace />;
}

function AppRoutes() {
  const navigate = useNavigate();
  const location = useLocation();
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const status = await window.api.checkActivation();
        
        if (status !== true && location.pathname !== '/activation') {
          navigate('/activation', { replace: true });
        } else if (status === true && location.pathname === '/activation') {
          navigate('/login', { replace: true });
        }
      } catch (error) {
        console.error(error);
      } finally {
        setIsChecking(false);
      }
    })();
  }, [navigate, location.pathname]);

  if (isChecking) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#f8fafc', color: 'var(--primary)', fontWeight: 'bold' }}>
        Memeriksa Lisensi Sistem...
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/activation" element={<Activation />} />
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <PrivateRoute>
            <MainLayout />
          </PrivateRoute>
        }
      >
        <Route index element={<AccessRoute permission="reports.view"><Dashboard /></AccessRoute>} />
        <Route path="orders" element={<AccessRoute permission="sales.view"><Orders /></AccessRoute>} />
        <Route path="receivables" element={<AccessRoute permission="receivables.manage"><Receivables /></AccessRoute>} />
        <Route path="incoming-stock" element={<AccessRoute permission="stock.manage"><IncomingStock /></AccessRoute>} />
        <Route path="orders/create" element={<AccessRoute permission="sales.create"><CreateOrder /></AccessRoute>} />
        <Route path="products" element={<AccessRoute permission="products.manage"><Products /></AccessRoute>} />
        <Route path="customers" element={<AccessRoute permission="customers.manage"><Customers /></AccessRoute>} />
        <Route path="finance" element={<AccessRoute permission="finance.view"><Finance /></AccessRoute>} />
        <Route path="reports" element={<AccessRoute permission="reports.view"><Reports /></AccessRoute>} />
        <Route path="users" element={<AccessRoute permission="users.manage"><Users /></AccessRoute>} />
        <Route path="settings" element={<AccessRoute permission={['settings.manage','backup.manage']}><Settings /></AccessRoute>} />
        <Route path="no-access" element={<p>Akun ini belum memiliki hak akses. Hubungi Super Admin.</p>} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <HashRouter>
        <AppRoutes />
      </HashRouter>
    </AuthProvider>
  );
}
