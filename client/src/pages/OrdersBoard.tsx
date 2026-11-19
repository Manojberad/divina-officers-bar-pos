import { useEffect, useState } from 'react';
import { api, subscribe } from '../lib/api';
import { useApp } from '../lib/app';
import { Badge, Button, DateRange, Empty, Input, Modal, Textarea, cx, daysAgo, fmtDate, today } from '../components/ui';

const ACTIVE = ['draft', 'placed', 'accepted', 'preparing', 'served'];
const NEXT: Record<string, [string, string]> = {
  draft: ['placed', 'Place'], placed: ['accepted', 'Accept'], accepted: ['preparing', 'Prepare'], preparing: ['served', 'Serve'], served: ['closed', 'Close'],
};

export const itemLabel = (i: any) => `${i.qty} × ${i.name}${i.serve_type === 'peg' ? ` (${i.peg_ml} ml)` : i.serve_type === 'bottle' ? ' (bottle)' : ''}`;

export function OrderDetail({ id, onClose, onChanged }: { id: number | null; onClose: () => void; onChanged?: () => void }) {
  const { user, money, toast } = useApp();
  const [o, setO] = useState<any>(null);
  const [note, setNote] = useState('');
  useEffect(() => { setO(null); if (id) api(`/orders/${id}`, { cache: false }).then(setO).catch((e) => toast(e.message, 'error')); }, [id]);
  const act = async (status: string) => {
    try { await api(`/orders/${id}/status`, { method: 'POST', body: { status, note } }); toast('Updated'); onChanged?.(); onClose(); } catch (e: any) { toast(e.message, 'error'); }
  };
  return (
    <Modal open={!!id} onClose={onClose} title={o ? `Order ${o.order_no}` : 'Order'}>
      {!o ? <div>Loading…</div> : (
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap gap-2"><Badge s={o.status} />{o.approval_status !== 'na' && <Badge s={o.approval_status}>approval: {o.approval_status}</Badge>}{o.type === 'prebooked' && <Badge s="accepted">pre-booked {fmtDate(o.scheduled_at)}</Badge>}</div>
          <div className="grid grid-cols-2 gap-1 text-gray-600 dark:text-gray-300">
            <span>Customer: <b>{o.customer_name || 'Walk-in'}</b></span><span>Table: <b>{o.table_name || '—'}</b></span>
            <span>Created: {fmtDate(o.created_at)}</span><span>By: {o.created_by_name || '—'}</span>
          </div>
          <table className="w-full"><tbody>
            {o.items.map((i: any) => <tr key={i.id} className="border-b dark:border-gray-700"><td className="py-1">{itemLabel(i)}</td><td className="text-right">{money(i.line_total)}</td></tr>)}
            <tr className="font-bold"><td className="py-1">Total</td><td className="text-right">{money(o.total)}</td></tr>
          </tbody></table>
          {o.notes && <div className="rounded-lg bg-amber-50 p-2 dark:bg-amber-900/30">📝 {o.notes}</div>}
          {o.dispute_note && <div className="rounded-lg bg-fuchsia-50 p-2 dark:bg-fuchsia-900/30">⚠️ Dispute: {o.dispute_note}</div>}
          {o.resolution_note && <div className="rounded-lg bg-emerald-50 p-2 dark:bg-emerald-900/30">✔ Resolution: {o.resolution_note}</div>}
          <div>
            <div className="mb-1 font-semibold">Audit trail</div>
            <ul className="space-y-1 text-xs">
              {o.events?.map((e: any) => <li key={e.id}>{fmtDate(e.at)} · {e.from_status ? `${e.from_status} → ` : ''}<b>{e.to_status}</b> · {e.user_name || 'system'}{e.note ? ` · ${e.note}` : ''}</li>)}
            </ul>
          </div>
          {['admin', 'bartender'].includes(user!.role) && (
            <div className="space-y-2 border-t pt-3 dark:border-gray-700">
              <Input placeholder="Note (optional / reason)" value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="flex flex-wrap gap-2">
                {NEXT[o.status] && <Button onClick={() => act(NEXT[o.status][0])}>{NEXT[o.status][1]}</Button>}
                {ACTIVE.includes(o.status) && o.status !== 'served' && o.status !== 'preparing' && <Button variant="success" onClick={() => act('served')}>Serve now</Button>}
                {o.status === 'disputed' && user!.role === 'admin' && <Button variant="success" onClick={() => act('closed')}>Resolve dispute</Button>}
                {(ACTIVE.includes(o.status) && (o.status !== 'served' || user!.role === 'admin')) && <Button variant="danger" onClick={() => act('cancelled')}>Cancel order</Button>}
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
  const [range, setRange] = useState([daysAgo(6), today()]);
  const [hstatus, setHstatus] = useState('');
  const [search, setSearch] = useState('');
  const [sel, setSel] = useState<number | null>(null);

  const load = () => api(`/orders?status=${ACTIVE.join(',')}`, { cache: false }).then(setOrders).catch(() => {});
  const loadHist = () => api(`/orders?from=${range[0]}&to=${range[1]}${hstatus ? `&status=${hstatus}` : ''}${search ? `&search=${encodeURIComponent(search)}` : ''}`).then(setHist).catch(() => {});
  useEffect(() => {
    load();
    const t = setInterval(load, 20000);
    const un = subscribe((ev, d) => { if (ev === 'order') { load(); if (d.action === 'created') { toast('🔔 New order received'); try { new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=').play(); } catch { /* */ } } } });
    return () => { clearInterval(t); un(); };
  }, []);
  useEffect(() => { if (tab === 'history') loadHist(); }, [tab, range, hstatus, search]);

  const advance = async (o: any) => {
    try { await api(`/orders/${o.id}/status`, { method: 'POST', body: { status: NEXT[o.status][0] } }); load(); } catch (e: any) { toast(e.message, 'error'); }
  };

  return (
    <div className="flex h-full flex-col p-3">
      <div className="mb-3 flex items-center gap-2">
        {(['live', 'history'] as const).map((t) => <Button key={t} variant={tab === t ? 'primary' : 'subtle'} onClick={() => setTab(t)}>{t === 'live' ? `Live orders (${orders.length})` : 'Order history'}</Button>)}
      </div>
      {tab === 'live' ? (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-auto sm:grid-cols-2 lg:grid-cols-5">
          {ACTIVE.map((s) => {
            const list = orders.filter((o) => o.status === s).sort((a, b) => (a.type === 'prebooked' ? 1 : 0) - (b.type === 'prebooked' ? 1 : 0) || a.id - b.id);
            return (
              <div key={s} className="flex min-h-0 flex-col rounded-[20px] border border-transparent bg-white/60 p-3 dark:border-[#2A3346] dark:bg-[#1C2230]/80">
                <div className="mb-2.5 flex items-center justify-between px-1"><Badge s={s} /><span className="text-xs font-bold text-[#94A3B8]">{list.length}</span></div>
                <div className="space-y-2.5 overflow-auto">
                  {list.map((o) => (
                    <div key={o.id} className={cx('horizon-shadow rounded-2xl bg-white p-3.5 dark:bg-[#252D3D]', o.type === 'prebooked' && 'ring-2 ring-[#422AFB] dark:ring-[#818CF8]')}>
                      <button className="w-full text-left" onClick={() => setSel(o.id)}>
                        <div className="flex justify-between text-sm font-extrabold text-[#1B2559] dark:text-[#E6EDF3]"><span>#{o.order_no.split('-')[1]} {o.table_name && `· ${o.table_name}`}</span><span className="text-[#422AFB] dark:text-[#818CF8]">{money(o.total)}</span></div>
                        <div className="text-xs font-medium text-[#94A3B8]">{o.customer_name || 'Walk-in'} · {fmtDate(o.created_at)} {o.source === 'qr' && '· QR'}</div>
                        {o.type === 'prebooked' && <div className="text-xs font-bold text-[#422AFB] dark:text-[#818CF8]">⏰ {fmtDate(o.scheduled_at)}</div>}
                        <ul className="mt-1.5 text-sm font-medium">{o.items.map((i: any) => <li key={i.id}>{itemLabel(i)}</li>)}</ul>
                        {o.notes && <div className="mt-1.5 rounded-xl bg-[#FBBF24]/15 px-2.5 py-1 text-xs font-semibold text-[#B86E00] dark:text-[#FCD34D]">📝 {o.notes}</div>}
                      </button>
                      <Button size="sm" className="mt-2.5 w-full" onClick={() => advance(o)}>{NEXT[s][1]} →</Button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <DateRange from={range[0]} to={range[1]} onChange={(f, t) => setRange([f, t])} />
            <select className="rounded-xl border px-3 py-2 dark:border-gray-600 dark:bg-gray-900" value={hstatus} onChange={(e) => setHstatus(e.target.value)}>
              <option value="">All statuses</option>{['closed', 'cancelled', 'disputed', ...ACTIVE].map((s) => <option key={s}>{s}</option>)}
            </select>
            <Input placeholder="Search order / customer / table" className="!w-64" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <table className="w-full text-sm">
            <thead className="text-left text-gray-500"><tr><th className="p-2">Order</th><th>Date</th><th>Customer</th><th>Table</th><th>Items</th><th>Status</th><th>Approval</th><th className="text-right">Total</th></tr></thead>
            <tbody>
              {hist.map((o) => (
                <tr key={o.id} onClick={() => setSel(o.id)} className="cursor-pointer border-t hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800">
                  <td className="p-2 font-semibold">{o.order_no}</td><td>{fmtDate(o.created_at)}</td><td>{o.customer_name || 'Walk-in'}</td><td>{o.table_name || '—'}</td>
                  <td className="max-w-xs truncate">{o.items.map(itemLabel).join(', ')}</td><td><Badge s={o.status} /></td><td>{o.approval_status !== 'na' && <Badge s={o.approval_status} />}</td>
                  <td className="text-right font-semibold">{money(o.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {hist.length === 0 && <Empty>No orders in range</Empty>}
        </div>
      )}
      <OrderDetail id={sel} onClose={() => setSel(null)} onChanged={() => { load(); if (tab === 'history') loadHist(); }} />
    </div>
  );
}

export { Textarea };
