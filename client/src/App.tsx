import { Navigate, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useApp, type Role } from './lib/app';
import Layout from './components/Layout';
import Login from './pages/Login';
import POS from './pages/POS';
import OrdersBoard from './pages/OrdersBoard';
import MyOrders from './pages/MyOrders';
import Dashboard from './pages/Dashboard';
import Inventory from './pages/Inventory';
import Products from './pages/Products';
import Users from './pages/Users';
import Tables from './pages/Tables';
import Reports from './pages/Reports';
import Settings from './pages/Settings';
import Account from './pages/Account';
import QRMenu from './pages/QRMenu';

function Guard({ roles, children }: { roles?: Role[]; children: ReactNode }) {
  const { user, ready } = useApp();
  if (!ready) return <div className="p-10 text-center">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export const homeFor = (r?: Role) => (r === 'admin' ? '/dashboard' : r === 'bartender' ? '/pos' : '/order');

export default function App() {
  const { user } = useApp();
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/menu/:code" element={<QRMenu />} />
      <Route element={<Guard><Layout /></Guard>}>
        <Route path="/" element={<Navigate to={homeFor(user?.role)} replace />} />
        <Route path="/pos" element={<Guard roles={['admin', 'bartender']}><POS mode="staff" /></Guard>} />
        <Route path="/orders" element={<Guard roles={['admin', 'bartender']}><OrdersBoard /></Guard>} />
        <Route path="/order" element={<Guard roles={['member', 'customer']}><POS mode="self" /></Guard>} />
        <Route path="/my-orders" element={<MyOrders />} />
        <Route path="/account" element={<Account />} />
        <Route path="/dashboard" element={<Guard roles={['admin']}><Dashboard /></Guard>} />
        <Route path="/inventory" element={<Guard roles={['admin', 'bartender']}><Inventory /></Guard>} />
        <Route path="/products" element={<Guard roles={['admin']}><Products /></Guard>} />
        <Route path="/users" element={<Guard roles={['admin']}><Users /></Guard>} />
        <Route path="/tables" element={<Guard roles={['admin']}><Tables /></Guard>} />
        <Route path="/reports" element={<Guard roles={['admin']}><Reports /></Guard>} />
        <Route path="/settings" element={<Guard roles={['admin']}><Settings /></Guard>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
