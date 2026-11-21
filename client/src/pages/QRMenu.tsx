import { useEffect, useState } from 'react';
import { api, subscribe } from '../lib/api';
import { useApp } from '../lib/app';
import { Badge, Button, Card, fmtDate } from '../components/ui';
import { EditOrderModal, RepeatOrderModal } from '../components/OrderActions';
import POS from './POS';
import { itemLabel } from './OrdersBoard';
import { useNavigate, useParams } from 'react-router-dom';

export default function QRMenu() {
  const { code } = useParams();
  const nav = useNavigate();
  const { user, logout, money } = useApp();
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState('');
  const [viewMode, setViewMode] = useState<'choose' | 'view'>('choose');
  const [tab, setTab] = useState<'menu' | 'orders'>('menu');
  const [orders, setOrders] = useState<any[]>([]);
  const [editTarget, setEditTarget] = useState<any>(null);
  const [repeatTarget, setRepeatTarget] = useState<any>(null);

  useEffect(() => { api(`/menu/${code}`).then(setData).catch((e) => setErr(e.message)); }, [code]);
  const loadOrders = () => user && api('/orders?limit=20', { cache: false }).then(setOrders).catch(() => {});
  useEffect(() => { loadOrders(); if (user) return subscribe((ev) => ev === 'order' && loadOrders()); }, [user]);

  if (err) return <div className="p-10 text-center text-red-500">{err}</div>;
  if (!data) return <div className="flex h-[100dvh] items-center justify-center bg-[#F4F7FE] text-sm font-semibold text-[#94A3B8] dark:bg-[#131722]">Loading menu…</div>;

  const goLoginToOrder = () => nav('/login', { state: { from: `/menu/${code}` } });

  // QR Scan Landing Screen: strictly 2 options only (1. View Menu Only, 2. Login to Order)
  if (!user && viewMode === 'choose') {
    return (
      <div className="flex min-h-[100dvh] w-full max-w-full flex-col items-center justify-center overflow-x-hidden bg-[#F4F7FE] px-5 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))] dark:bg-[#131722]">
        <div className="horizon-shadow w-full max-w-sm rounded-[28px] border border-[#E9EDF7] bg-white p-7 text-center dark:border-[#2A3346] dark:bg-[#1C2230]">
          <img
            src={data.bar.logo || '/Login_logo.png'}
            alt={data.bar.name}
            className="mx-auto h-20 w-20 rounded-2xl object-contain"
          />
          <h1 className="font-ubuntu mt-4 text-xl font-extrabold tracking-tight text-[#1B2559] dark:text-[#E6EDF3]">
            {data.bar.name}
          </h1>
          <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-[#422AFB]/10 px-3.5 py-1 text-xs font-extrabold text-[#422AFB] dark:bg-[#6366F1]/20 dark:text-[#A5B4FC]">
            <span>📍</span>
            <span>{data.table.name}</span>
          </div>
          <p className="mt-3 text-xs font-medium text-[#707EAE] dark:text-[#94A3B8]">
            Choose how you would like to continue
          </p>

          <div className="mt-6 space-y-3">
            <button
              type="button"
              onClick={() => setViewMode('view')}
              className="flex w-full items-center justify-between rounded-2xl border border-[#E0E5F2] bg-[#F4F7FE] px-5 py-4 text-left transition active:scale-[0.98] hover:border-[#422AFB]/40 hover:bg-[#E9EDF7] dark:border-[#2E384D] dark:bg-[#252D3D] dark:hover:border-[#818CF8]/40 dark:hover:bg-[#2E384D]"
            >
              <div>
                <div className="text-base font-extrabold text-[#1B2559] dark:text-[#E6EDF3]">📖 View Menu Only</div>
                <div className="mt-0.5 text-xs font-medium text-[#707EAE] dark:text-[#94A3B8]">Browse drinks, food & prices</div>
              </div>
              <span className="text-lg font-bold text-[#94A3B8]">→</span>
            </button>

            <button
              type="button"
              onClick={goLoginToOrder}
              className="horizon-gradient flex w-full items-center justify-between rounded-2xl px-5 py-4 text-left text-white shadow-[0_10px_24px_rgba(99,102,241,0.32)] transition active:scale-[0.98] hover:brightness-105"
            >
              <div>
                <div className="text-base font-extrabold">🔐 Login to Order</div>
                <div className="mt-0.5 text-xs font-medium text-white/80">Sign in to order for {data.table.name}</div>
              </div>
              <span className="text-lg font-bold text-white/90">→</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[100dvh] w-full max-w-full flex-col overflow-hidden bg-[#F4F7FE] dark:bg-[#131722]">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[#E9EDF7] bg-white px-3 pb-2.5 pt-[max(0.65rem,env(safe-area-inset-top))] dark:border-[#2A3346] dark:bg-[#1C2230] sm:px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          {!user && (
            <button
              type="button"
              onClick={() => setViewMode('choose')}
              aria-label="Back to QR options"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#F4F7FE] text-base font-bold text-[#1B2559] dark:bg-[#252D3D] dark:text-[#E6EDF3]"
            >
              ←
            </button>
          )}
          <img src={data.bar.logo || '/Login_logo.png'} className="h-9 w-9 shrink-0 rounded-lg object-contain" alt="" />
          <div className="min-w-0">
            <div className="font-ubuntu truncate font-bold leading-tight text-[#1B2559] dark:text-[#E6EDF3]">{data.bar.name}</div>
            <div className="text-xs font-bold text-[#422AFB] dark:text-[#818CF8]">📍 {data.table.name}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {user ? (
            <>
              <Button size="sm" variant={tab === 'orders' ? 'primary' : 'subtle'} onClick={() => setTab(tab === 'menu' ? 'orders' : 'menu')}>
                {tab === 'menu' ? 'My Orders' : 'Menu'}
              </Button>
              {user.role === 'guest' && <Badge s="placed">Guest</Badge>}
              <Button size="sm" variant="ghost" onClick={logout}>{user.rank ? `${user.rank} ` : ''}{user.name.split(' ')[0]} · Sign out</Button>
            </>
          ) : (
            <Button size="sm" onClick={goLoginToOrder}>Login to Order</Button>
          )}
        </div>
      </header>

      {!user && (
        <div className="bg-[#422AFB]/10 px-4 py-2 text-center text-xs font-semibold text-[#1B2559] dark:bg-[#6366F1]/15 dark:text-[#E6EDF3]">
          Viewing Menu Only · <button type="button" className="font-extrabold text-[#422AFB] underline dark:text-[#818CF8]" onClick={goLoginToOrder}>Login to Order</button> for {data.table.name}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain">
        {tab === 'menu' ? (
          <POS
            mode="qr"
            readOnly={!user}
            tableCode={code}
            preload={{ products: data.products, categories: data.categories }}
            onPlaced={() => { setTab('orders'); loadOrders(); }}
          />
        ) : (
          <div className="mx-auto max-w-xl space-y-3 p-4">
            {orders.length === 0 && <Card><div className="py-6 text-center text-sm text-[#94A3B8]">No orders placed yet.</div></Card>}
            {orders.map((o) => (
              <Card key={o.id}>
                <div className="flex flex-wrap items-center justify-between gap-2 font-semibold">
                  <span>{o.order_no}</span>
                  <div className="flex items-center gap-1.5">
                    {o.payment_mode && <Badge s="approved">{o.payment_mode === 'cash' ? '💵 Cash' : '📱 UPI'}</Badge>}
                    <Badge s={o.status} />
                  </div>
                </div>
                <div className="text-xs text-[#94A3B8]">{fmtDate(o.created_at)} · {o.table_name}</div>
                <ul className="mt-2 text-sm">{o.items.map((i: any) => <li key={i.id}>{itemLabel(i)} — {money(i.line_total)}</li>)}</ul>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-[#E9EDF7] pt-2.5 dark:border-[#2A3346]">
                  <div className="flex flex-wrap gap-2">
                    {o.can_edit && (
                      <Button size="sm" variant="subtle" onClick={() => setEditTarget(o)}>✏️ Edit Order</Button>
                    )}
                    {o.items?.length > 0 && (
                      <Button size="sm" variant="primary" onClick={() => setRepeatTarget(o)}>🔁 Repeat</Button>
                    )}
                  </div>
                  <div className="font-extrabold text-[#422AFB] dark:text-[#818CF8]">{money(o.total)}</div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
      <EditOrderModal order={editTarget} onClose={() => setEditTarget(null)} onSaved={() => loadOrders()} />
      <RepeatOrderModal order={repeatTarget} tableCode={code} onClose={() => setRepeatTarget(null)} onPlaced={() => loadOrders()} />
    </div>
  );
}
