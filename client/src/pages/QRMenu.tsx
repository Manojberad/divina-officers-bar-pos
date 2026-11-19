import { useEffect, useState } from 'react';
import { api, subscribe } from '../lib/api';
import { useApp } from '../lib/app';
import { Badge, Button, Card, Field, Input, Modal, fmtDate } from '../components/ui';
import POS from './POS';
import { itemLabel } from './OrdersBoard';
import { useParams } from 'react-router-dom';

export default function QRMenu() {
  const { code } = useParams();
  const { user, login, logout, money, toast } = useApp();
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState<'menu' | 'orders'>('menu');
  const [orders, setOrders] = useState<any[]>([]);

  // Auth / Guest Registration Modal
  const [authOpen, setAuthOpen] = useState(false);
  const [authTab, setAuthTab] = useState<'login' | 'guest'>('login');
  const [sn, setSn] = useState('');
  const [pin, setPin] = useState('');
  const [lerr, setLerr] = useState('');
  const [busy, setBusy] = useState(false);

  // Guest registration form
  const [gForm, setGForm] = useState({ service_no: '', rank: '', name: '', mobile: '', pin: '' });
  const [pendingGuest, setPendingGuest] = useState<{ service_no: string; rank: string; name: string; pin: string; status: 'pending' | 'approved' | 'rejected' } | null>(() => {
    try { return JSON.parse(localStorage.getItem('pending-guest') || 'null'); } catch { return null; }
  });

  useEffect(() => { api(`/menu/${code}`).then(setData).catch((e) => setErr(e.message)); }, [code]);
  const loadOrders = () => user && api('/orders?limit=20', { cache: false }).then(setOrders).catch(() => {});
  useEffect(() => { loadOrders(); if (user) return subscribe((ev) => ev === 'order' && loadOrders()); }, [user]);

  // Poll + SSE listen while a guest is awaiting bartender approval
  useEffect(() => {
    if (!pendingGuest || pendingGuest.status !== 'pending' || user) return;
    const check = async () => {
      try {
        const s = await api(`/auth/guest-status/${encodeURIComponent(pendingGuest.service_no)}`, { cache: false });
        if (s.approval_status === 'approved' && s.active) {
          const updated = { ...pendingGuest, status: 'approved' as const };
          setPendingGuest(updated);
          localStorage.setItem('pending-guest', JSON.stringify(updated));
          toast('✔ Your guest pass was approved by the bartender!');
          // Auto-login guest so they can immediately start ordering
          try {
            await login(pendingGuest.service_no, pendingGuest.pin, 'guest');
            localStorage.removeItem('pending-guest');
            setPendingGuest(null);
            setAuthOpen(false);
          } catch { /* fallback to manual login button */ }
        } else if (s.approval_status === 'rejected') {
          const updated = { ...pendingGuest, status: 'rejected' as const };
          setPendingGuest(updated);
          localStorage.setItem('pending-guest', JSON.stringify(updated));
          toast('Your guest registration request was declined.', 'error');
        }
      } catch { /* ignore */ }
    };
    check();
    const timer = setInterval(check, 5000);
    const unsub = subscribe((ev, d) => {
      if (ev === 'guest_request' && String(d?.service_no || '').toLowerCase() === pendingGuest.service_no.toLowerCase()) check();
    });
    return () => { clearInterval(timer); unsub(); };
  }, [pendingGuest, user]);

  if (err) return <div className="p-10 text-center text-red-500">{err}</div>;
  if (!data) return <div className="p-10 text-center text-[#94A3B8]">Loading menu…</div>;

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault(); setLerr(''); setBusy(true);
    try {
      await login(sn.trim(), pin.trim(), 'member');
      localStorage.removeItem('pending-guest');
      setPendingGuest(null);
      setAuthOpen(false); setSn(''); setPin('');
    } catch (e: any) { setLerr(e.message); } finally { setBusy(false); }
  };

  const registerGuest = async (e: React.FormEvent) => {
    e.preventDefault(); setLerr(''); setBusy(true);
    try {
      const chosenPin = gForm.pin.trim() || gForm.service_no.trim();
      const r = await api('/auth/guest-register', {
        method: 'POST',
        body: { ...gForm, pin: chosenPin, table_code: code },
      });
      if (r.status === 'approved') {
        toast('Already approved! Signing you in…');
        await login(gForm.service_no.trim(), chosenPin, 'guest');
        setAuthOpen(false);
      } else {
        const pg = { service_no: gForm.service_no.trim(), rank: gForm.rank.trim(), name: gForm.name.trim(), pin: chosenPin, status: 'pending' as const };
        setPendingGuest(pg);
        localStorage.setItem('pending-guest', JSON.stringify(pg));
        toast('Guest registration sent to bartender for approval');
      }
    } catch (e: any) { setLerr(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="flex h-full flex-col bg-[#F4F7FE] dark:bg-[#131722]">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E9EDF7] bg-white px-4 py-3 dark:border-[#2A3346] dark:bg-[#1C2230]">
        <div className="flex items-center gap-2.5">
          {data.bar.logo ? <img src={data.bar.logo} className="h-9 w-9 rounded-lg object-contain" alt="" /> : <span className="text-2xl">🍸</span>}
          <div>
            <div className="font-ubuntu font-bold leading-tight text-[#1B2559] dark:text-[#E6EDF3]">{data.bar.name}</div>
            <div className="text-xs font-bold text-[#422AFB] dark:text-[#818CF8]">📍 {data.table.name}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {user && (
            <Button size="sm" variant={tab === 'orders' ? 'primary' : 'subtle'} onClick={() => setTab(tab === 'menu' ? 'orders' : 'menu')}>
              {tab === 'menu' ? 'My Orders' : 'Menu'}
            </Button>
          )}
          {user ? (
            <div className="flex items-center gap-2">
              {user.role === 'guest' && <Badge s="placed">Guest</Badge>}
              <Button size="sm" variant="ghost" onClick={logout}>{user.rank ? `${user.rank} ` : ''}{user.name.split(' ')[0]} · Sign out</Button>
            </div>
          ) : (
            <>
              <Button size="sm" variant="subtle" onClick={() => { setAuthTab('guest'); setLerr(''); setAuthOpen(true); }}>Guest Register</Button>
              <Button size="sm" onClick={() => { setAuthTab('login'); setLerr(''); setAuthOpen(true); }}>Sign In</Button>
            </>
          )}
        </div>
      </header>

      {!user && pendingGuest?.status === 'pending' && (
        <div className="flex flex-wrap items-center justify-between gap-2 bg-amber-500/15 px-4 py-2.5 text-xs font-semibold text-amber-800 dark:text-amber-200">
          <span>⏳ Guest pass for <b>{pendingGuest.rank} {pendingGuest.name} ({pendingGuest.service_no})</b> is awaiting bartender approval… This page will sign you in automatically once approved.</span>
          <button className="underline" onClick={() => { localStorage.removeItem('pending-guest'); setPendingGuest(null); }}>Dismiss</button>
        </div>
      )}

      {!user && pendingGuest?.status !== 'pending' && (
        <div className="bg-[#422AFB]/10 px-4 py-2 text-center text-xs font-semibold text-[#1B2559] dark:bg-[#6366F1]/15 dark:text-[#E6EDF3]">
          Browse the menu below. <button className="font-extrabold text-[#422AFB] underline dark:text-[#818CF8]" onClick={() => { setAuthTab('login'); setAuthOpen(true); }}>Member / Guest Login</button> or <button className="font-extrabold text-[#422AFB] underline dark:text-[#818CF8]" onClick={() => { setAuthTab('guest'); setAuthOpen(true); }}>Register as a Guest</button> to order for {data.table.name}.
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {tab === 'menu' ? (
          <POS mode="qr" tableCode={code} preload={{ products: data.products, categories: data.categories }} onPlaced={() => { setTab('orders'); loadOrders(); }} />
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
                <div className="mt-2 text-right font-extrabold text-[#422AFB] dark:text-[#818CF8]">{money(o.total)}</div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Modal open={authOpen} onClose={() => setAuthOpen(false)} title={authTab === 'login' ? 'Member / Guest Sign In' : 'Guest Registration'}>
        <div className="mb-4 grid grid-cols-2 gap-2">
          <Button variant={authTab === 'login' ? 'primary' : 'subtle'} size="sm" onClick={() => { setAuthTab('login'); setLerr(''); }}>Sign In</Button>
          <Button variant={authTab === 'guest' ? 'primary' : 'subtle'} size="sm" onClick={() => { setAuthTab('guest'); setLerr(''); }}>New Guest Register</Button>
        </div>

        {authTab === 'login' ? (
          <form onSubmit={signIn} className="space-y-3">
            <Field label="Service Number">
              <Input placeholder="Enter Service No." value={sn} onChange={(e) => setSn(e.target.value)} required autoFocus autoCapitalize="characters" />
            </Field>
            <Field label="PIN">
              <Input placeholder="Enter your PIN" type="password" value={pin} onChange={(e) => setPin(e.target.value)} required />
            </Field>
            {lerr && <div className="rounded-xl bg-red-500/15 p-2.5 text-sm font-medium text-red-500">{lerr}</div>}
            <Button className="w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign In'}</Button>
          </form>
        ) : pendingGuest?.status === 'pending' ? (
          <div className="space-y-3 py-4 text-center">
            <div className="text-4xl">⏳</div>
            <div className="text-base font-bold">Awaiting Bartender Approval</div>
            <p className="text-sm text-[#94A3B8]">
              Request sent for <b>{pendingGuest.rank} {pendingGuest.name}</b> ({pendingGuest.service_no}). The bartender has been notified and you will be logged in automatically once approved.
            </p>
            <Button variant="ghost" size="sm" onClick={() => { localStorage.removeItem('pending-guest'); setPendingGuest(null); }}>
              Register a different guest
            </Button>
          </div>
        ) : (
          <form onSubmit={registerGuest} className="space-y-3">
            <p className="text-xs text-[#94A3B8]">
              Visiting guests can register below to scan & order. Your request will be approved by the bartender and notified to the Admin. Checkout is settled via <b>Cash</b> or <b>UPI</b>.
            </p>
            <Field label="Service Number">
              <Input placeholder="e.g. IC-90123 / G-101" value={gForm.service_no} onChange={(e) => setGForm({ ...gForm, service_no: e.target.value })} required autoCapitalize="characters" />
            </Field>
            <Field label="Rank">
              <Input placeholder="e.g. Maj, Capt, Wg Cdr, Mr/Ms" value={gForm.rank} onChange={(e) => setGForm({ ...gForm, rank: e.target.value })} required />
            </Field>
            <Field label="Full Name">
              <Input placeholder="Enter your full name" value={gForm.name} onChange={(e) => setGForm({ ...gForm, name: e.target.value })} required />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Mobile (optional)">
                <Input placeholder="10-digit mobile" value={gForm.mobile} onChange={(e) => setGForm({ ...gForm, mobile: e.target.value })} />
              </Field>
              <Field label="PIN (blank = Service No)">
                <Input type="password" placeholder="Optional PIN" value={gForm.pin} onChange={(e) => setGForm({ ...gForm, pin: e.target.value })} />
              </Field>
            </div>
            {lerr && <div className="rounded-xl bg-red-500/15 p-2.5 text-sm font-medium text-red-500">{lerr}</div>}
            <Button className="w-full" disabled={busy}>{busy ? 'Submitting…' : 'Submit Guest Registration'}</Button>
          </form>
        )}
      </Modal>
    </div>
  );
}
