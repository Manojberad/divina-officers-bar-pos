import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, subscribe } from '../lib/api';
import { useApp } from '../lib/app';
import { Badge, Button, Card, Input, Modal, fmtDate } from '../components/ui';
import POS from './POS';
import { itemLabel } from './OrdersBoard';

export default function QRMenu() {
  const { code } = useParams();
  const { user, login, logout, money } = useApp();
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState<'menu' | 'orders'>('menu');
  const [orders, setOrders] = useState<any[]>([]);
  const [authOpen, setAuthOpen] = useState(false);
  const [sn, setSn] = useState('');
  const [pin, setPin] = useState('');
  const [lerr, setLerr] = useState('');

  useEffect(() => { api(`/menu/${code}`).then(setData).catch((e) => setErr(e.message)); }, [code]);
  const loadOrders = () => user && api('/orders?limit=20', { cache: false }).then(setOrders).catch(() => {});
  useEffect(() => { loadOrders(); if (user) return subscribe((ev) => ev === 'order' && loadOrders()); }, [user]);

  if (err) return <div className="p-10 text-center text-red-500">{err}</div>;
  if (!data) return <div className="p-10 text-center">Loading menu…</div>;

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault(); setLerr('');
    try { await login(pin.trim(), sn.trim() ? pin.trim() : undefined, sn.trim() ? undefined : 'member'); setAuthOpen(false); setSn(''); setPin(''); } catch (e: any) { setLerr(e.message); }
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b bg-white px-4 py-2.5 dark:border-gray-800 dark:bg-gray-950">
        <div className="flex items-center gap-2">
          {data.bar.logo ? <img src={data.bar.logo} className="h-9 w-9 rounded-lg object-contain" alt="" /> : <span className="text-2xl">🍸</span>}
          <div><div className="font-bold leading-tight">{data.bar.name}</div><div className="text-xs text-[var(--accent)]">📍 {data.table.name}</div></div>
        </div>
        <div className="flex items-center gap-2">
          {user && <Button size="sm" variant={tab === 'orders' ? 'primary' : 'subtle'} onClick={() => setTab(tab === 'menu' ? 'orders' : 'menu')}>{tab === 'menu' ? 'My Orders' : 'Menu'}</Button>}
          {user ? <Button size="sm" variant="ghost" onClick={logout}>{user.name.split(' ')[0]} · Sign out</Button> : <Button size="sm" onClick={() => setAuthOpen(true)}>Member Login</Button>}
        </div>
      </header>
      {!user && <div className="bg-amber-100 px-4 py-2 text-center text-xs font-medium text-amber-900">Browse the menu below. <button className="underline" onClick={() => setAuthOpen(true)}>Sign in with your service number</button> to place an order for {data.table.name}.</div>}
      <div className="min-h-0 flex-1 overflow-auto">
        {tab === 'menu' ? (
          <POS mode="qr" tableCode={code} preload={{ products: data.products, categories: data.categories }} onPlaced={() => { setTab('orders'); loadOrders(); }} />
        ) : (
          <div className="mx-auto max-w-xl space-y-3 p-4">
            {orders.map((o) => (
              <Card key={o.id}>
                <div className="flex justify-between font-semibold"><span>{o.order_no}</span><Badge s={o.status} /></div>
                <div className="text-xs text-gray-500">{fmtDate(o.created_at)} · {o.table_name}</div>
                <ul className="mt-1 text-sm">{o.items.map((i: any) => <li key={i.id}>{itemLabel(i)} — {money(i.line_total)}</li>)}</ul>
                <div className="mt-1 text-right font-bold">{money(o.total)}</div>
              </Card>
            ))}
          </div>
        )}
      </div>
      <Modal open={authOpen} onClose={() => setAuthOpen(false)} title="Member Sign In">
        <form onSubmit={signIn} className="space-y-3">
          <Input placeholder="Enter your Member Pin" type="password" value={pin} onChange={(e) => setPin(e.target.value)} required autoFocus />
          {lerr && <div className="text-sm text-red-500">{lerr}</div>}
          <Button className="w-full">Login</Button>
        </form>
      </Modal>
    </div>
  );
}
