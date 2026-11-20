import { useEffect, useMemo, useState } from 'react';
import { api, subscribe } from '../lib/api';
import { useApp, isAdminRole, isStaffRole } from '../lib/app';
import { Badge, Button, Card, DateRange, Empty, Field, Input, Modal, Select, Textarea, cx, daysAgo, fmtDate, today } from '../components/ui';

export const itemLabel = (i: any) =>
  `${i.qty} × ${i.name}${
    i.serve_type === 'peg'
      ? i.peg_ml === 30
        ? ' (Small 30 ml)'
        : i.peg_ml === 60
          ? ' (Large 60 ml)'
          : ` (${i.peg_ml} ml)`
      : i.serve_type === 'bottle'
        ? ' (Full Bottle)'
        : ''
  }`;

function statusDisplay(o: any) {
  if (o.status === 'closed') return { badge: 'approved', label: '✔ Auto-Billed' };
  if (o.status === 'served' && o.customer_role === 'guest') return { badge: 'pending', label: '💳 Pending Cash/UPI' };
  if (o.status === 'draft') return { badge: 'draft', label: o.type === 'prebooked' ? '📅 Pre-Order' : 'Draft' };
  if (o.status === 'cancelled') return { badge: 'cancelled', label: 'Cancelled' };
  if (o.status === 'disputed') return { badge: 'disputed', label: 'Disputed' };
  return { badge: o.status, label: o.status };
}

export function OrderDetail({ id, onClose, onChanged, onEdit }: { id: number | null; onClose: () => void; onChanged?: () => void; onEdit?: (o: any) => void }) {
  const { user, money, toast } = useApp();
  const [o, setO] = useState<any>(null);
  const [note, setNote] = useState('');
  const [payMode, setPayMode] = useState<'cash' | 'upi' | ''>('');
  const [payRef, setPayRef] = useState('');

  useEffect(() => {
    setO(null); setNote(''); setPayMode(''); setPayRef('');
    if (id) api(`/orders/${id}`, { cache: false }).then((d) => { setO(d); if (d.payment_mode) setPayMode(d.payment_mode); if (d.payment_ref) setPayRef(d.payment_ref); }).catch((e) => toast(e.message, 'error'));
  }, [id]);

  const act = async (status: string) => {
    if (status === 'closed' && o?.customer_role === 'guest' && o?.status !== 'disputed' && !payMode) {
      return toast('Select payment mode (Cash or UPI) for Guest checkout', 'error');
    }
    try {
      await api(`/orders/${id}/status`, {
        method: 'POST',
        body: { status, note, ...(payMode ? { payment_mode: payMode, payment_ref: payRef || undefined } : {}) },
      });
      toast(status === 'cancelled' ? 'Order cancelled & stock restored' : 'Order updated');
      onChanged?.();
      onClose();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const isGuestOrder = o?.customer_role === 'guest';
  const sd = o ? statusDisplay(o) : null;

  return (
    <Modal open={!!id} onClose={onClose} title={o ? `Order ${o.order_no}` : 'Order'}>
      {!o ? <div>Loading…</div> : (
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap gap-2">
            {sd && <Badge s={sd.badge}>{sd.label}</Badge>}
            {isGuestOrder && <Badge s="placed">Guest</Badge>}
            {o.payment_mode && <Badge s="approved">{o.payment_mode === 'cash' ? '💵 Paid Cash' : '📱 Paid UPI'}</Badge>}
            {o.approval_status !== 'na' && <Badge s={o.approval_status}>approval: {o.approval_status}</Badge>}
            {o.type === 'prebooked' && <Badge s="accepted">Pre-Order {fmtDate(o.scheduled_at)}</Badge>}
          </div>
          <div className="grid grid-cols-2 gap-1 text-[#707EAE] dark:text-[#94A3B8]">
            <span>Customer: <b className="text-[#1B2559] dark:text-[#E6EDF3]">{o.customer_rank ? `${o.customer_rank} ` : ''}{o.customer_name || 'Walk-in'}</b></span>
            <span>Table: <b className="text-[#1B2559] dark:text-[#E6EDF3]">{o.table_name || '—'}</b></span>
            <span>Created: {fmtDate(o.created_at)}</span>
            <span>By: {o.created_by_name || '—'}</span>
          </div>
          <table className="w-full">
            <tbody>
              {o.items.map((i: any) => <tr key={i.id} className="border-b border-[#E9EDF7] dark:border-[#2A3346]"><td className="py-1.5">{itemLabel(i)}</td><td className="text-right font-semibold">{money(i.line_total)}</td></tr>)}
              <tr className="font-extrabold"><td className="py-1.5">Total</td><td className="text-right text-[#422AFB] dark:text-[#818CF8]">{money(o.total)}</td></tr>
            </tbody>
          </table>
          {o.notes && <div className="rounded-xl bg-[#FBBF24]/15 p-2.5 text-xs font-semibold">📝 {o.notes}</div>}
          {o.payment_ref && <div className="rounded-xl bg-[#10B981]/15 p-2.5 text-xs font-semibold">💳 Payment Ref: {o.payment_ref}</div>}
          {o.dispute_note && <div className="rounded-xl bg-fuchsia-500/15 p-2.5 text-xs font-semibold">⚠️ Dispute: {o.dispute_note}</div>}
          {o.resolution_note && <div className="rounded-xl bg-emerald-500/15 p-2.5 text-xs font-semibold">✔ Resolution: {o.resolution_note}</div>}
          <div>
            <div className="mb-1 font-bold">Audit trail</div>
            <ul className="space-y-1 text-xs text-[#707EAE] dark:text-[#94A3B8]">
              {o.events?.map((e: any) => <li key={e.id}>{fmtDate(e.at)} · {e.from_status ? `${e.from_status} → ` : ''}<b>{e.to_status}</b> · {e.user_name || 'system'}{e.note ? ` · ${e.note}` : ''}</li>)}
            </ul>
          </div>
          {isStaffRole(user?.role) && o.status !== 'cancelled' && (
            <div className="space-y-3 border-t border-[#E9EDF7] pt-3 dark:border-[#2A3346]">
              {isGuestOrder && o.status === 'served' && (
                <div className="space-y-2 rounded-2xl bg-[#F4F7FE] p-3 dark:bg-[#252D3D]">
                  <div className="text-xs font-bold uppercase tracking-wider text-[#94A3B8]">Guest Checkout — Record Payment Mode</div>
                  <div className="grid grid-cols-2 gap-2">
                    <Button type="button" variant={payMode === 'cash' ? 'success' : 'ghost'} onClick={() => setPayMode('cash')}>💵 Cash</Button>
                    <Button type="button" variant={payMode === 'upi' ? 'primary' : 'ghost'} onClick={() => setPayMode('upi')}>📱 UPI</Button>
                  </div>
                  <Input placeholder="Payment ref / UPI ID (optional)" value={payRef} onChange={(e) => setPayRef(e.target.value)} />
                </div>
              )}
              <Input placeholder="Reason / note (e.g. item out of stock)" value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="flex flex-wrap gap-2">
                {o.status === 'draft' && <Button variant="success" onClick={() => act('closed')}>✔ Accept &amp; Bill</Button>}
                {isGuestOrder && o.status === 'served' && <Button variant="success" onClick={() => act('closed')}>Confirm Cash / UPI &amp; Bill</Button>}
                {o.status === 'disputed' && isAdminRole(user?.role) && <Button variant="success" onClick={() => act('closed')}>Resolve dispute</Button>}
                {onEdit && <Button variant="subtle" onClick={() => { onClose(); onEdit(o); }}>✏️ Edit Items</Button>}
                {(o.status !== 'disputed' || isAdminRole(user?.role)) && (
                  <Button variant="danger" onClick={() => act('cancelled')}>✕ Cancel &amp; Restore Stock</Button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

export default function OrdersBoard() {
  const { money, toast } = useApp();
  const [tab, setTab] = useState<'today' | 'guest_pay' | 'preorders' | 'history'>('today');
  const [todayOrders, setTodayOrders] = useState<any[]>([]);
  const [preorders, setPreorders] = useState<any[]>([]);
  const [hist, setHist] = useState<any[]>([]);
  const [guestReqs, setGuestReqs] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [range, setRange] = useState([daysAgo(6), today()]);
  const [hstatus, setHstatus] = useState('');
  const [search, setSearch] = useState('');
  const [todaySearch, setTodaySearch] = useState('');
  const [sel, setSel] = useState<number | null>(null);

  // Guest Checkout Modal
  const [checkoutOrder, setCheckoutOrder] = useState<any>(null);
  const [checkoutPayMode, setCheckoutPayMode] = useState<'cash' | 'upi'>('upi');
  const [checkoutPayRef, setCheckoutPayRef] = useState('');

  // Edit Order Items Modal (Bartender / Admin)
  const [editOrder, setEditOrder] = useState<any>(null);
  const [editItems, setEditItems] = useState<any[]>([]);
  const [editNotes, setEditNotes] = useState('');
  const [editReason, setEditReason] = useState('');
  const [addProdId, setAddProdId] = useState('');
  const [addServe, setAddServe] = useState<'peg30' | 'peg60' | 'bottle' | 'unit'>('peg30');

  // Cancel Order Modal
  const [cancelTarget, setCancelTarget] = useState<any>(null);
  const [cancelReason, setCancelReason] = useState('');

  const load = () => {
    const td = today();
    api(`/orders?from=${td}&to=${td}&limit=200`, { cache: false }).then(setTodayOrders).catch(() => {});
    api('/orders?status=draft&limit=100', { cache: false }).then(setPreorders).catch(() => {});
  };
  const loadGuests = () => api('/users/guest-requests?status=pending', { cache: false }).then(setGuestReqs).catch(() => {});
  const loadHist = () => api(`/orders?from=${range[0]}&to=${range[1]}${hstatus ? `&status=${hstatus}` : ''}${search ? `&search=${encodeURIComponent(search)}` : ''}`).then(setHist).catch(() => {});

  useEffect(() => {
    load();
    loadGuests();
    api('/products?all=1').then(setProducts).catch(() => {});
    const t = setInterval(() => { load(); loadGuests(); }, 15000);
    const un = subscribe((ev, d) => {
      if (ev === 'order') {
        load();
        if (d.action === 'created') {
          toast('🔔 New order auto-accepted & billed!');
          try { new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=').play(); } catch { /* */ }
        }
      }
      if (ev === 'guest_request') {
        loadGuests();
        if (d.approval_status === 'pending') toast('🪪 New Guest registration awaiting approval!');
      }
    });
    return () => { clearInterval(t); un(); };
  }, []);
  useEffect(() => { if (tab === 'history') loadHist(); }, [tab, range, hstatus, search]);

  const openEditModal = (o: any) => {
    setEditOrder(o);
    setEditItems(o.items.map((i: any) => ({
      product_id: i.product_id,
      name: i.name,
      serve_type: i.serve_type,
      peg_ml: i.peg_ml,
      qty: i.qty,
      unit_price: i.unit_price,
    })));
    setEditNotes(o.notes || '');
    setEditReason('');
    setAddProdId('');
  };

  const addEditLine = () => {
    const p = products.find((x) => x.id === Number(addProdId));
    if (!p) return;
    let serve_type = 'unit';
    let peg_ml: number | null = null;
    let unit_price = p.selling_price;
    if (p.is_peg) {
      if (addServe === 'bottle') { serve_type = 'bottle'; unit_price = p.selling_price; }
      else if (addServe === 'peg60') { serve_type = 'peg'; peg_ml = 60; unit_price = Math.round(p.peg_price * 2 * 100) / 100; }
      else { serve_type = 'peg'; peg_ml = 30; unit_price = p.peg_price; }
    }
    setEditItems((prev) => {
      const idx = prev.findIndex((l) => l.product_id === p.id && l.serve_type === serve_type && (l.peg_ml || null) === peg_ml);
      if (idx >= 0) return prev.map((l, i) => (i === idx ? { ...l, qty: l.qty + 1 } : l));
      return [...prev, { product_id: p.id, name: p.name, serve_type, peg_ml, qty: 1, unit_price }];
    });
    setAddProdId('');
  };

  const saveEditOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editOrder) return;
    if (!editItems.length) return toast('Keep at least 1 item, or cancel the order instead', 'error');
    try {
      await api(`/orders/${editOrder.id}/items`, {
        method: 'PUT',
        body: {
          items: editItems.map((l) => ({ product_id: l.product_id, serve_type: l.serve_type, peg_ml: l.peg_ml, qty: l.qty })),
          notes: editNotes,
          reason: editReason.trim() || 'Item availability adjustment',
        },
      });
      toast(`✔ Order #${editOrder.order_no.split('-')[1]} updated & inventory adjusted`);
      setEditOrder(null);
      load();
      if (tab === 'history') loadHist();
    } catch (err: any) { toast(err.message, 'error'); }
  };

  const confirmCancel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cancelTarget) return;
    try {
      await api(`/orders/${cancelTarget.id}/status`, {
        method: 'POST',
        body: { status: 'cancelled', note: cancelReason.trim() || 'Cancelled by bartender (item unavailable)' },
      });
      toast(`Order #${cancelTarget.order_no.split('-')[1]} cancelled & stock restored`);
      setCancelTarget(null);
      setCancelReason('');
      load();
      if (tab === 'history') loadHist();
    } catch (err: any) { toast(err.message, 'error'); }
  };

  const quickGuestPay = async (o: any, mode: 'cash' | 'upi') => {
    if (mode === 'upi') {
      setCheckoutOrder(o);
      setCheckoutPayMode('upi');
      setCheckoutPayRef('');
      return;
    }
    try {
      await api(`/orders/${o.id}/status`, { method: 'POST', body: { status: 'closed', payment_mode: 'cash' } });
      toast(`✔ Guest order #${o.order_no.split('-')[1]} settled via CASH`);
      load();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const confirmGuestCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!checkoutOrder) return;
    try {
      await api(`/orders/${checkoutOrder.id}/status`, {
        method: 'POST',
        body: { status: 'closed', payment_mode: checkoutPayMode, payment_ref: checkoutPayRef.trim() || undefined },
      });
      toast(`✔ Guest order billed · Paid via ${checkoutPayMode.toUpperCase()}`);
      setCheckoutOrder(null);
      load();
      if (tab === 'history') loadHist();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const billPreorder = async (o: any) => {
    if (o.customer_role === 'guest') {
      setCheckoutOrder(o);
      setCheckoutPayMode('upi');
      setCheckoutPayRef('');
      return;
    }
    try {
      await api(`/orders/${o.id}/status`, { method: 'POST', body: { status: 'closed', note: 'Pre-order accepted & billed' } });
      toast(`✔ Pre-order #${o.order_no.split('-')[1]} accepted & billed!`);
      load();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const handleGuestApproval = async (g: any, action: 'approve' | 'reject') => {
    try {
      await api(`/users/${g.id}/approve-guest`, { method: 'POST', body: { action } });
      toast(action === 'approve' ? `✔ Approved guest ${g.rank} ${g.name} (Admin notified)` : `Declined guest ${g.name}`);
      loadGuests();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const pendingGuestPayments = useMemo(
    () => todayOrders.filter((o) => o.status === 'served' && o.customer_role === 'guest'),
    [todayOrders],
  );

  const visibleToday = useMemo(() => {
    const q = todaySearch.trim().toLowerCase();
    return todayOrders.filter((o) => {
      if (o.status === 'draft') return false;
      if (!q) return true;
      return `${o.order_no} ${o.customer_name || ''} ${o.customer_service_no || ''} ${o.table_name || ''} ${o.items.map((i: any) => i.name).join(' ')}`.toLowerCase().includes(q);
    });
  }, [todayOrders, todaySearch]);

  const activeList = tab === 'guest_pay' ? pendingGuestPayments : tab === 'preorders' ? preorders : visibleToday;
  const selAddProd = products.find((p) => p.id === Number(addProdId));
  const editTotal = editItems.reduce((s, i) => s + i.qty * i.unit_price, 0);

  return (
    <div className="flex flex-col gap-3 p-2 sm:p-3 lg:h-full">
      {/* Live Pending Guest Approvals Panel */}
      {guestReqs.length > 0 && (
        <Card className="!border-[#FBBF24] !bg-[#FBBF24]/10 !p-3.5">
          <div className="mb-2 text-sm font-extrabold text-[#B86E00] dark:text-[#FCD34D]">
            🪪 Pending Guest Registrations ({guestReqs.length}) — Bartender Approval Required
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {guestReqs.map((g) => (
              <div key={g.id} className="flex items-center justify-between gap-3 rounded-2xl bg-white p-3 shadow-xs dark:bg-[#1C2230]">
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold text-[#1B2559] dark:text-[#E6EDF3]">{g.rank} {g.name}</div>
                  <div className="text-xs text-[#94A3B8]">Service No: <b>{g.service_no}</b> · {fmtDate(g.created_at)}</div>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <Button size="sm" variant="success" onClick={() => handleGuestApproval(g, 'approve')}>✔ Approve</Button>
                  <Button size="sm" variant="danger" onClick={() => handleGuestApproval(g, 'reject')}>✕</Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Auto-Bill Info Banner + Tab Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant={tab === 'today' ? 'primary' : 'subtle'} onClick={() => setTab('today')}>
            ⚡ Live / Today ({visibleToday.length})
          </Button>
          <Button variant={tab === 'guest_pay' ? 'primary' : 'subtle'} onClick={() => setTab('guest_pay')}>
            💳 Guest Cash/UPI ({pendingGuestPayments.length})
          </Button>
          <Button variant={tab === 'preorders' ? 'primary' : 'subtle'} onClick={() => setTab('preorders')}>
            📅 Pre-Orders ({preorders.length})
          </Button>
          <Button variant={tab === 'history' ? 'primary' : 'subtle'} onClick={() => setTab('history')}>
            Order History
          </Button>
        </div>
        {tab === 'today' && (
          <Input
            placeholder="🔍 Filter today's orders by officer, item or order #…"
            value={todaySearch}
            onChange={(e) => setTodaySearch(e.target.value)}
            className="!max-w-xs"
          />
        )}
      </div>

      {tab !== 'history' ? (
        <div className="lg:min-h-0 lg:flex-1 lg:overflow-auto">
          <div className="mb-3 rounded-2xl bg-[#10B981]/10 px-4 py-2 text-xs font-semibold text-[#059669] dark:text-[#34D399]">
            ⚡ <b>Auto-Accept &amp; Auto-Bill Active:</b> Customer &amp; bar orders are automatically accepted, billed, and deducted from stock — no status clicks needed! Use <b>Edit Items</b> or <b>Cancel</b> only if an item is unavailable or needs changes.
          </div>

          {activeList.length === 0 ? (
            <Empty>
              {tab === 'guest_pay' ? 'No guest orders waiting for Cash/UPI payment' : tab === 'preorders' ? 'No upcoming pre-orders' : 'No orders placed today yet'}
            </Empty>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {activeList.map((o) => {
                const sd = statusDisplay(o);
                const isCancelled = o.status === 'cancelled';
                return (
                  <div
                    key={o.id}
                    className={cx(
                      'horizon-shadow flex flex-col justify-between rounded-[20px] border bg-white p-4 dark:bg-[#1C2230]',
                      o.status === 'served' && o.customer_role === 'guest'
                        ? 'border-[#FBBF24] ring-1 ring-[#FBBF24]/50'
                        : isCancelled
                          ? 'border-[#E9EDF7] opacity-60 dark:border-[#2A3346]'
                          : 'border-[#E9EDF7] dark:border-[#2A3346]',
                    )}
                  >
                    <button className="w-full text-left" onClick={() => setSel(o.id)}>
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-sm font-extrabold text-[#1B2559] dark:text-[#E6EDF3]">
                            #{o.order_no.split('-')[1]} {o.table_name && `· ${o.table_name}`}
                          </div>
                          <div className="mt-0.5 text-xs font-medium text-[#707EAE] dark:text-[#94A3B8]">
                            {o.customer_rank ? `${o.customer_rank} ` : ''}{o.customer_name || 'Walk-in'}
                            {o.customer_service_no ? ` (${o.customer_service_no})` : ''}
                          </div>
                        </div>
                        <span className="shrink-0 text-base font-extrabold text-[#422AFB] dark:text-[#818CF8]">
                          {money(o.total)}
                        </span>
                      </div>

                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <Badge s={sd.badge}>{sd.label}</Badge>
                        {o.customer_role === 'guest' && <Badge s="placed">Guest</Badge>}
                        {o.payment_mode && <Badge s="approved">{o.payment_mode === 'cash' ? '💵 Cash' : '📱 UPI'}</Badge>}
                        {o.source === 'favorite' && <Badge s="accepted">♥ Repeat</Badge>}
                        <span className="ml-auto text-[11px] text-[#94A3B8]">{fmtDate(o.created_at)}</span>
                      </div>

                      {o.type === 'prebooked' && o.scheduled_at && (
                        <div className="mt-2 rounded-xl bg-[#422AFB]/10 px-2.5 py-1 text-xs font-bold text-[#422AFB] dark:text-[#818CF8]">
                          🗓 Scheduled: {fmtDate(o.scheduled_at)}
                        </div>
                      )}

                      <ul className="mt-2.5 space-y-1 border-t border-[#E9EDF7] pt-2 text-xs font-semibold dark:border-[#2A3346]">
                        {o.items.map((i: any) => (
                          <li key={i.id} className="flex justify-between gap-2">
                            <span className="truncate">{itemLabel(i)}</span>
                            <span className="shrink-0 text-[#707EAE] dark:text-[#94A3B8]">{money(i.line_total)}</span>
                          </li>
                        ))}
                      </ul>
                      {o.notes && <div className="mt-2 rounded-xl bg-[#FBBF24]/15 px-2.5 py-1 text-xs font-semibold text-[#B86E00] dark:text-[#FCD34D]">📝 {o.notes}</div>}
                    </button>

                    {/* Streamlined Bartender Actions */}
                    {!isCancelled && (
                      <div className="mt-3 space-y-2 border-t border-[#E9EDF7] pt-3 dark:border-[#2A3346]">
                        {o.status === 'draft' && (
                          <Button size="sm" variant="success" className="w-full" onClick={() => billPreorder(o)}>
                            ✔ Accept &amp; Bill Pre-Order
                          </Button>
                        )}
                        {o.status === 'served' && o.customer_role === 'guest' && (
                          <div className="grid grid-cols-2 gap-1.5">
                            <Button size="sm" variant="success" onClick={() => quickGuestPay(o, 'cash')}>💵 Cash</Button>
                            <Button size="sm" variant="primary" onClick={() => quickGuestPay(o, 'upi')}>📱 UPI</Button>
                          </div>
                        )}
                        <div className="grid grid-cols-2 gap-1.5">
                          <Button size="sm" variant="subtle" onClick={() => openEditModal(o)}>✏️ Edit Items</Button>
                          <Button size="sm" variant="danger" onClick={() => { setCancelTarget(o); setCancelReason(''); }}>✕ Cancel</Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="lg:min-h-0 lg:flex-1 lg:overflow-auto">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <DateRange from={range[0]} to={range[1]} onChange={(f, t) => setRange([f, t])} />
            <select className="rounded-2xl border border-[#E0E5F2] bg-white px-3 py-2 text-sm dark:border-[#2E384D] dark:bg-[#151A25]" value={hstatus} onChange={(e) => setHstatus(e.target.value)}>
              <option value="">All statuses</option>
              {['closed', 'served', 'draft', 'cancelled', 'disputed'].map((s) => <option key={s}>{s}</option>)}
            </select>
            <Input placeholder="Search order / customer / table" className="!w-full sm:!w-64" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="w-full overflow-x-auto">
            <table className="w-full text-sm">
            <thead className="text-left text-xs font-bold uppercase tracking-wider text-[#94A3B8]">
              <tr><th className="p-2">Order</th><th>Date</th><th>Customer</th><th>Table</th><th>Items</th><th>Status</th><th>Payment</th><th>Approval</th><th className="text-right">Total</th></tr>
            </thead>
            <tbody>
              {hist.map((o) => {
                const sd = statusDisplay(o);
                return (
                  <tr key={o.id} onClick={() => setSel(o.id)} className="cursor-pointer border-t border-[#E9EDF7] hover:bg-white/60 dark:border-[#2A3346] dark:hover:bg-[#1C2230]">
                    <td className="p-2 font-bold">{o.order_no}</td>
                    <td>{fmtDate(o.created_at)}</td>
                    <td>{o.customer_name || 'Walk-in'} {o.customer_role === 'guest' && <Badge s="placed">Guest</Badge>}</td>
                    <td>{o.table_name || '—'}</td>
                    <td className="max-w-xs truncate">{o.items.map(itemLabel).join(', ')}</td>
                    <td><Badge s={sd.badge}>{sd.label}</Badge></td>
                    <td>{o.payment_mode ? <Badge s="approved">{o.payment_mode === 'cash' ? '💵 Cash' : '📱 UPI'}</Badge> : <span className="text-xs text-[#94A3B8]">Member Bill</span>}</td>
                    <td>{o.approval_status !== 'na' && <Badge s={o.approval_status} />}</td>
                    <td className="text-right font-bold">{money(o.total)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
          {hist.length === 0 && <Empty>No orders in range</Empty>}
        </div>
      )}

      {/* Edit Order Items Modal (Bartender / Admin) */}
      <Modal open={!!editOrder} onClose={() => setEditOrder(null)} title={editOrder ? `Edit Order #${editOrder.order_no.split('-')[1]} — ${editOrder.customer_name || 'Walk-in'}` : 'Edit Order'} wide>
        {editOrder && (
          <form onSubmit={saveEditOrder} className="space-y-4">
            <p className="text-xs text-[#707EAE] dark:text-[#94A3B8]">
              Remove unavailable items, adjust quantities, or add replacement items. Stock and bill total are recalculated automatically.
            </p>
            <div className="space-y-2">
              {editItems.map((l, idx) => (
                <div key={idx} className="flex items-center justify-between gap-2 rounded-2xl bg-[#F4F7FE] p-2.5 dark:bg-[#252D3D]">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-bold">{itemLabel(l)}</div>
                    <div className="text-xs text-[#94A3B8]">{money(l.unit_price)} each</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setEditItems((prev) => prev.map((x, i) => (i === idx ? { ...x, qty: x.qty - 1 } : x)).filter((x) => x.qty > 0))}
                      className="h-8 w-8 rounded-lg bg-white font-bold dark:bg-[#1C2230]"
                    >−</button>
                    <span className="w-6 text-center text-sm font-bold">{l.qty}</span>
                    <button
                      type="button"
                      onClick={() => setEditItems((prev) => prev.map((x, i) => (i === idx ? { ...x, qty: x.qty + 1 } : x)))}
                      className="h-8 w-8 rounded-lg bg-white font-bold dark:bg-[#1C2230]"
                    >+</button>
                    <button
                      type="button"
                      onClick={() => setEditItems((prev) => prev.filter((_, i) => i !== idx))}
                      className="ml-1 rounded-lg px-2 py-1 text-xs font-bold text-[#EE5D50] hover:bg-[#EE5D50]/10"
                      title="Remove item"
                    >Remove</button>
                  </div>
                </div>
              ))}
              {editItems.length === 0 && (
                <div className="rounded-2xl border border-dashed border-[#EE5D50] p-4 text-center text-xs font-semibold text-[#EE5D50]">
                  All items removed. Either add a replacement item below or cancel the order.
                </div>
              )}
            </div>

            {/* Quick Add Replacement Item */}
            <div className="flex flex-wrap items-end gap-2 rounded-2xl border border-[#E9EDF7] p-3 dark:border-[#2A3346]">
              <div className="min-w-[200px] flex-1">
                <Field label="Add / Substitute Item">
                  <Select value={addProdId} onChange={(e) => { setAddProdId(e.target.value); setAddServe('peg30'); }}>
                    <option value="">Choose product…</option>
                    {products.filter((p) => p.active).map((p) => (
                      <option key={p.id} value={p.id}>{p.name} ({p.is_peg ? `${money(p.peg_price)}/30ml` : money(p.selling_price)})</option>
                    ))}
                  </Select>
                </Field>
              </div>
              {selAddProd?.is_peg && (
                <div className="w-40">
                  <Field label="Serve">
                    <Select value={addServe} onChange={(e) => setAddServe(e.target.value as any)}>
                      <option value="peg30">Small (30 ml)</option>
                      <option value="peg60">Large (60 ml)</option>
                      <option value="bottle">Full Bottle</option>
                    </Select>
                  </Field>
                </div>
              )}
              <Button type="button" variant="subtle" onClick={addEditLine} disabled={!addProdId}>+ Add</Button>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Order Notes"><Input value={editNotes} onChange={(e) => setEditNotes(e.target.value)} /></Field>
              <Field label="Edit Reason"><Input value={editReason} onChange={(e) => setEditReason(e.target.value)} placeholder="e.g. Brand unavailable, substituted" /></Field>
            </div>

            <div className="flex items-center justify-between border-t border-[#E9EDF7] pt-3 dark:border-[#2A3346]">
              <div className="text-base font-extrabold">Updated Total: <span className="text-[#422AFB] dark:text-[#818CF8]">{money(editTotal)}</span></div>
              <div className="flex gap-2">
                <Button type="button" variant="ghost" onClick={() => setEditOrder(null)}>Close</Button>
                <Button type="submit" disabled={!editItems.length}>Save Changes</Button>
              </div>
            </div>
          </form>
        )}
      </Modal>

      {/* Cancel Order Confirmation Modal */}
      <Modal open={!!cancelTarget} onClose={() => setCancelTarget(null)} title={cancelTarget ? `Cancel Order #${cancelTarget.order_no.split('-')[1]}` : 'Cancel Order'}>
        {cancelTarget && (
          <form onSubmit={confirmCancel} className="space-y-4">
            <p className="text-sm text-[#707EAE] dark:text-[#94A3B8]">
              Cancelling this order will void the bill (<b>{money(cancelTarget.total)}</b>) and automatically restore all deducted items back to inventory.
            </p>
            <Field label="Reason for cancellation">
              <Input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="e.g. Item out of stock / Customer cancelled" autoFocus />
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setCancelTarget(null)}>Keep Order</Button>
              <Button type="submit" variant="danger">Confirm Cancel &amp; Restore Stock</Button>
            </div>
          </form>
        )}
      </Modal>

      {/* Guest Checkout Payment Mode Modal */}
      <Modal open={!!checkoutOrder} onClose={() => setCheckoutOrder(null)} title={`Guest Checkout — ${checkoutOrder?.order_no || ''}`}>
        {checkoutOrder && (
          <form onSubmit={confirmGuestCheckout} className="space-y-4">
            <div className="rounded-2xl bg-[#F4F7FE] p-3.5 dark:bg-[#252D3D]">
              <div className="text-xs font-bold uppercase tracking-wider text-[#94A3B8]">Guest Details</div>
              <div className="mt-1 font-bold">{checkoutOrder.customer_rank} {checkoutOrder.customer_name} ({checkoutOrder.customer_service_no})</div>
              <div className="mt-2 flex items-center justify-between border-t border-[#E0E5F2] pt-2 text-lg font-extrabold dark:border-[#2E384D]">
                <span>Amount Payable</span>
                <span className="text-[#422AFB] dark:text-[#818CF8]">{money(checkoutOrder.total)}</span>
              </div>
            </div>
            <Field label="Select Payment Mode (Required for Accounting & Analytics)">
              <div className="grid grid-cols-2 gap-3">
                <Button type="button" size="lg" variant={checkoutPayMode === 'cash' ? 'success' : 'subtle'} onClick={() => setCheckoutPayMode('cash')}>
                  💵 Cash
                </Button>
                <Button type="button" size="lg" variant={checkoutPayMode === 'upi' ? 'primary' : 'subtle'} onClick={() => setCheckoutPayMode('upi')}>
                  📱 UPI
                </Button>
              </div>
            </Field>
            <Field label={checkoutPayMode === 'upi' ? 'UPI Transaction / UTR Reference (optional)' : 'Receipt / Cash Note (optional)'}>
              <Input placeholder={checkoutPayMode === 'upi' ? 'e.g. UTR / last 4 digits' : 'Optional note'} value={checkoutPayRef} onChange={(e) => setCheckoutPayRef(e.target.value)} />
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setCheckoutOrder(null)}>Cancel</Button>
              <Button type="submit">Confirm Payment &amp; Bill</Button>
            </div>
          </form>
        )}
      </Modal>

      <OrderDetail id={sel} onClose={() => setSel(null)} onEdit={openEditModal} onChanged={() => { load(); if (tab === 'history') loadHist(); }} />
    </div>
  );
}

export { Textarea };
