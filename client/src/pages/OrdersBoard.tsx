import { useEffect, useState } from 'react';
import { api, subscribe } from '../lib/api';
import { useApp, isAdminRole, isStaffRole } from '../lib/app';
import { Badge, Button, Card, DateRange, Empty, Field, Input, Modal, Textarea, cx, daysAgo, fmtDate, today } from '../components/ui';

const ACTIVE = ['draft', 'placed', 'accepted', 'preparing', 'served'];
const NEXT: Record<string, [string, string]> = {
  draft: ['preparing', 'Move to Preparing'],
  placed: ['preparing', 'Accept'],
  accepted: ['preparing', 'Move to Preparing'],
  preparing: ['served', 'Serve'],
  served: ['closed', 'Close'],
};

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

export function OrderDetail({ id, onClose, onChanged }: { id: number | null; onClose: () => void; onChanged?: () => void }) {
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
      toast('Updated');
      onChanged?.();
      onClose();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const isGuestOrder = o?.customer_role === 'guest';

  return (
    <Modal open={!!id} onClose={onClose} title={o ? `Order ${o.order_no}` : 'Order'}>
      {!o ? <div>Loading…</div> : (
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap gap-2">
            <Badge s={o.status} />
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
          {isStaffRole(user?.role) && (
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
              <Input placeholder="Note (optional / reason)" value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="flex flex-wrap gap-2">
                {NEXT[o.status] && <Button onClick={() => act(NEXT[o.status][0])}>{isGuestOrder && o.status === 'served' ? 'Checkout & Close' : NEXT[o.status][1]}</Button>}
                {ACTIVE.includes(o.status) && o.status !== 'served' && o.status !== 'preparing' && <Button variant="success" onClick={() => act('served')}>Serve now</Button>}
                {o.status === 'disputed' && isAdminRole(user?.role) && <Button variant="success" onClick={() => act('closed')}>Resolve dispute</Button>}
                {(ACTIVE.includes(o.status) && (o.status !== 'served' || isAdminRole(user?.role))) && <Button variant="danger" onClick={() => act('cancelled')}>Cancel order</Button>}
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
  const [tab, setTab] = useState<'live' | 'history'>('live');
  const [orders, setOrders] = useState<any[]>([]);
  const [hist, setHist] = useState<any[]>([]);
  const [guestReqs, setGuestReqs] = useState<any[]>([]);
  const [range, setRange] = useState([daysAgo(6), today()]);
  const [hstatus, setHstatus] = useState('');
  const [search, setSearch] = useState('');
  const [sel, setSel] = useState<number | null>(null);

  // Guest Checkout Payment Modal (triggered when closing a Guest order from the live board)
  const [checkoutOrder, setCheckoutOrder] = useState<any>(null);
  const [checkoutPayMode, setCheckoutPayMode] = useState<'cash' | 'upi'>('upi');
  const [checkoutPayRef, setCheckoutPayRef] = useState('');

  const load = () => api(`/orders?status=${ACTIVE.join(',')}`, { cache: false }).then(setOrders).catch(() => {});
  const loadGuests = () => api('/users/guest-requests?status=pending', { cache: false }).then(setGuestReqs).catch(() => {});
  const loadHist = () => api(`/orders?from=${range[0]}&to=${range[1]}${hstatus ? `&status=${hstatus}` : ''}${search ? `&search=${encodeURIComponent(search)}` : ''}`).then(setHist).catch(() => {});

  useEffect(() => {
    load();
    loadGuests();
    const t = setInterval(() => { load(); loadGuests(); }, 20000);
    const un = subscribe((ev, d) => {
      if (ev === 'order') {
        load();
        if (d.action === 'created') {
          toast('🔔 New order received');
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

  const advance = async (o: any, forceStatus?: string, note?: string) => {
    const nextStatus = forceStatus || NEXT[o.status][0];
    // Guest order closing requires recording payment mode (Cash / UPI)
    if (nextStatus === 'closed' && o.customer_role === 'guest') {
      setCheckoutOrder(o);
      setCheckoutPayMode('upi');
      setCheckoutPayRef('');
      return;
    }
    try {
      await api(`/orders/${o.id}/status`, { method: 'POST', body: { status: nextStatus, ...(note ? { note } : {}) } });
      if (nextStatus === 'preparing' && o.status === 'placed') toast(`Order #${o.order_no.split('-')[1]} accepted → moved to Preparing`);
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
      toast(`Guest order closed · Paid via ${checkoutPayMode.toUpperCase()}`);
      setCheckoutOrder(null);
      load();
      if (tab === 'history') loadHist();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const handleGuestApproval = async (g: any, action: 'approve' | 'reject') => {
    try {
      await api(`/users/${g.id}/approve-guest`, { method: 'POST', body: { action } });
      toast(action === 'approve' ? `✔ Approved guest ${g.rank} ${g.name} (Admin notified)` : `Declined guest ${g.name}`);
      loadGuests();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      {/* Live Pending Guest Approvals Panel */}
      {guestReqs.length > 0 && (
        <Card className="!border-[#FBBF24] !bg-[#FBBF24]/10 !p-3.5">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-extrabold text-[#B86E00] dark:text-[#FCD34D]">
              🪪 Pending Guest Registrations ({guestReqs.length}) — Bartender Approval Required
            </div>
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

      <div className="flex items-center gap-2">
        {(['live', 'history'] as const).map((t) => <Button key={t} variant={tab === t ? 'primary' : 'subtle'} onClick={() => setTab(t)}>{t === 'live' ? `Live orders (${orders.length})` : 'Order history'}</Button>)}
      </div>

      {tab === 'live' ? (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-auto sm:grid-cols-2 lg:grid-cols-4">
          {(() => {
            const nowMs = Date.now();
            const todayStr = new Date().toLocaleDateString('en-CA');
            const isDraftPreorder = (o: any) => o.status === 'draft' || (o.type === 'prebooked' && ['draft', 'placed', 'accepted'].includes(o.status));
            const cols = [
              {
                key: 'draft',
                badge: 'draft',
                title: 'Draft · Pre-Orders',
                list: orders.filter(isDraftPreorder).sort((a, b) => Date.parse(a.scheduled_at || a.created_at) - Date.parse(b.scheduled_at || b.created_at)),
              },
              {
                key: 'placed',
                badge: 'placed',
                title: 'Placed & Accepted',
                list: orders.filter((o) => !isDraftPreorder(o) && ['placed', 'accepted'].includes(o.status)).sort((a, b) => a.id - b.id),
              },
              {
                key: 'preparing',
                badge: 'preparing',
                title: 'Preparing',
                list: orders.filter((o) => o.status === 'preparing').sort((a, b) => a.id - b.id),
              },
              {
                key: 'served',
                badge: 'served',
                title: 'Served',
                list: orders.filter((o) => o.status === 'served').sort((a, b) => a.id - b.id),
              },
            ];
            return cols.map((col) => (
              <div key={col.key} className="flex min-h-0 flex-col rounded-[20px] border border-transparent bg-white/60 p-3 dark:border-[#2A3346] dark:bg-[#1C2230]/80">
                <div className="mb-2.5 flex items-center justify-between px-1">
                  <Badge s={col.badge}>{col.title}</Badge>
                  <span className="text-xs font-bold text-[#94A3B8]">{col.list.length}</span>
                </div>
                <div className="space-y-2.5 overflow-auto">
                  {col.list.length === 0 && <div className="py-8 text-center text-xs text-[#94A3B8]">No orders</div>}
                  {col.list.map((o) => {
                    const dueMs = o.scheduled_at ? Date.parse(o.scheduled_at) : NaN;
                    const minsToDue = !isNaN(dueMs) ? Math.round((dueMs - nowMs) / 60000) : null;
                    const isDueToday = !isNaN(dueMs) && new Date(dueMs).toLocaleDateString('en-CA') === todayStr;
                    const isDueSoon = minsToDue != null && minsToDue <= 60;

                    return (
                      <div
                        key={o.id}
                        className={cx(
                          'horizon-shadow rounded-2xl bg-white p-3.5 dark:bg-[#252D3D]',
                          col.key === 'draft' && isDueSoon && 'ring-2 ring-[#FBBF24]',
                          col.key === 'draft' && !isDueSoon && o.type === 'prebooked' && 'ring-1 ring-[#422AFB]/50 dark:ring-[#818CF8]/50',
                        )}
                      >
                        <button className="w-full text-left" onClick={() => setSel(o.id)}>
                          <div className="flex justify-between text-sm font-extrabold text-[#1B2559] dark:text-[#E6EDF3]">
                            <span>#{o.order_no.split('-')[1]} {o.table_name && `· ${o.table_name}`}</span>
                            <span className="text-[#422AFB] dark:text-[#818CF8]">{money(o.total)}</span>
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs font-medium text-[#94A3B8]">
                            <span>{o.customer_rank ? `${o.customer_rank} ` : ''}{o.customer_name || 'Walk-in'}</span>
                            {o.customer_role === 'guest' && <Badge s="placed">Guest</Badge>}
                            <span>· {fmtDate(o.created_at)} {o.source === 'qr' && '· QR'}</span>
                          </div>
                          {o.type === 'prebooked' && o.scheduled_at && (
                            <div className={cx('mt-1.5 rounded-xl px-2.5 py-1 text-xs font-bold', isDueSoon ? 'bg-[#EE5D50]/15 text-[#EE5D50]' : isDueToday ? 'bg-[#FBBF24]/20 text-[#B86E00] dark:text-[#FCD34D]' : 'bg-[#422AFB]/10 text-[#422AFB] dark:text-[#818CF8]')}>
                              {isDueSoon
                                ? minsToDue! <= 0
                                  ? `⏰ Due NOW (${fmtDate(o.scheduled_at)}) — Move to Preparing!`
                                  : `⏰ Due in ${minsToDue} min (${fmtDate(o.scheduled_at)}) — Prepare now!`
                                : isDueToday
                                  ? `📅 Due Today · ${fmtDate(o.scheduled_at)}`
                                  : `🗓 Pre-Order · ${fmtDate(o.scheduled_at)}`}
                            </div>
                          )}
                          <ul className="mt-1.5 text-sm font-medium">{o.items.map((i: any) => <li key={i.id}>{itemLabel(i)}</li>)}</ul>
                          {o.notes && <div className="mt-1.5 rounded-xl bg-[#FBBF24]/15 px-2.5 py-1 text-xs font-semibold text-[#B86E00] dark:text-[#FCD34D]">📝 {o.notes}</div>}
                        </button>

                        {/* Column-specific action buttons */}
                        {col.key === 'draft' && (
                          <Button
                            size="sm"
                            variant={isDueSoon ? 'primary' : 'subtle'}
                            className={cx('mt-2.5 w-full', isDueSoon && 'animate-pulse shadow-[0_0_16px_rgba(66,42,251,0.55)]')}
                            onClick={() => advance(o, 'preparing', 'Pre-Order moved to Preparing')}
                          >
                            Move to Preparing →
                          </Button>
                        )}

                        {col.key === 'placed' && (
                          <div className="mt-2.5 grid grid-cols-2 gap-2">
                            <span className="inline-flex min-h-9 items-center justify-center gap-1 rounded-xl bg-[#01B574] px-3 py-1.5 text-xs font-extrabold text-white shadow-xs">
                              ✓ Placed
                            </span>
                            <button
                              type="button"
                              onClick={() => advance(o, 'preparing', 'Accepted & moved to Preparing')}
                              className="inline-flex min-h-9 animate-pulse items-center justify-center gap-1 rounded-xl bg-[#422AFB] px-3 py-1.5 text-xs font-extrabold text-white shadow-[0_0_18px_rgba(66,42,251,0.75)] ring-2 ring-[#818CF8]/70 transition hover:brightness-110 active:scale-95 dark:bg-[#6366F1] dark:shadow-[0_0_18px_rgba(99,102,241,0.8)]"
                            >
                              Accept →
                            </button>
                          </div>
                        )}

                        {col.key === 'preparing' && (
                          <Button size="sm" variant="success" className="mt-2.5 w-full" onClick={() => advance(o, 'served', 'Served to customer')}>
                            🍽 Serve →
                          </Button>
                        )}

                        {col.key === 'served' && (
                          <Button size="sm" className="mt-2.5 w-full" onClick={() => advance(o, 'closed')}>
                            {o.customer_role === 'guest' ? 'Checkout (Cash / UPI) →' : 'Close →'}
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ));
          })()}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <DateRange from={range[0]} to={range[1]} onChange={(f, t) => setRange([f, t])} />
            <select className="rounded-2xl border border-[#E0E5F2] bg-white px-3 py-2 text-sm dark:border-[#2E384D] dark:bg-[#151A25]" value={hstatus} onChange={(e) => setHstatus(e.target.value)}>
              <option value="">All statuses</option>{['closed', 'cancelled', 'disputed', ...ACTIVE].map((s) => <option key={s}>{s}</option>)}
            </select>
            <Input placeholder="Search order / customer / table" className="!w-64" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <table className="w-full text-sm">
            <thead className="text-left text-xs font-bold uppercase tracking-wider text-[#94A3B8]">
              <tr><th className="p-2">Order</th><th>Date</th><th>Customer</th><th>Table</th><th>Items</th><th>Status</th><th>Payment</th><th>Approval</th><th className="text-right">Total</th></tr>
            </thead>
            <tbody>
              {hist.map((o) => (
                <tr key={o.id} onClick={() => setSel(o.id)} className="cursor-pointer border-t border-[#E9EDF7] hover:bg-white/60 dark:border-[#2A3346] dark:hover:bg-[#1C2230]">
                  <td className="p-2 font-bold">{o.order_no}</td>
                  <td>{fmtDate(o.created_at)}</td>
                  <td>{o.customer_name || 'Walk-in'} {o.customer_role === 'guest' && <Badge s="placed">Guest</Badge>}</td>
                  <td>{o.table_name || '—'}</td>
                  <td className="max-w-xs truncate">{o.items.map(itemLabel).join(', ')}</td>
                  <td><Badge s={o.status} /></td>
                  <td>{o.payment_mode ? <Badge s="approved">{o.payment_mode === 'cash' ? '💵 Cash' : '📱 UPI'}</Badge> : <span className="text-xs text-[#94A3B8]">Member Bill</span>}</td>
                  <td>{o.approval_status !== 'na' && <Badge s={o.approval_status} />}</td>
                  <td className="text-right font-bold">{money(o.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {hist.length === 0 && <Empty>No orders in range</Empty>}
        </div>
      )}

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
              <Button type="submit">Confirm Payment & Close Order</Button>
            </div>
          </form>
        )}
      </Modal>

      <OrderDetail id={sel} onClose={() => setSel(null)} onChanged={() => { load(); if (tab === 'history') loadHist(); }} />
    </div>
  );
}

export { Textarea };
