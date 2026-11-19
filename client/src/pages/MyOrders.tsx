import { useEffect, useState } from 'react';
import { api, subscribe } from '../lib/api';
import { useApp } from '../lib/app';
import { Badge, Button, Card, Empty, Modal, Textarea, fmtDate } from '../components/ui';
import { itemLabel } from './OrdersBoard';

export default function MyOrders() {
  const { money, toast, settings } = useApp();
  const [orders, setOrders] = useState<any[]>([]);
  const [dispute, setDispute] = useState<any>(null);
  const [note, setNote] = useState('');
  const hours = Number(settings.approval_hours || 24);

  const load = () => api('/orders?limit=100').then(setOrders).catch(() => {});
  useEffect(() => { load(); return subscribe((ev) => ev === 'order' && load()); }, []);

  const approve = async (o: any) => {
    try { await api(`/orders/${o.id}/approve`, { method: 'POST' }); toast('Order approved'); load(); } catch (e: any) { toast(e.message, 'error'); }
  };
  const sendDispute = async () => {
    try { await api(`/orders/${dispute.id}/dispute`, { method: 'POST', body: { note } }); toast('Discrepancy reported to administrator'); setDispute(null); setNote(''); load(); } catch (e: any) { toast(e.message, 'error'); }
  };
  const cancel = async (o: any) => {
    try { await api(`/orders/${o.id}/status`, { method: 'POST', body: { status: 'cancelled', note: 'Cancelled by customer' } }); load(); } catch (e: any) { toast(e.message, 'error'); }
  };
  const remaining = (o: any) => Math.max(0, hours * 3600e3 - (Date.now() - Date.parse(o.closed_at)));
  const pending = orders.filter((o) => o.approval_status === 'pending' && remaining(o) > 0);
  const spent = orders.filter((o) => !['cancelled', 'draft'].includes(o.status)).reduce((s, o) => s + o.total, 0);

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <div className="grid grid-cols-3 gap-3">
        <Card><div className="text-sm text-gray-500">Orders</div><div className="text-2xl font-bold">{orders.length}</div></Card>
        <Card><div className="text-sm text-gray-500">Consumption value</div><div className="text-2xl font-bold">{money(spent)}</div></Card>
        <Card><div className="text-sm text-gray-500">Awaiting your approval</div><div className="text-2xl font-bold text-amber-500">{pending.length}</div></Card>
      </div>
      {pending.length > 0 && (
        <Card title="⏳ Please verify these orders" className="border-amber-400">
          <div className="space-y-3">
            {pending.map((o) => (
              <div key={o.id} className="rounded-xl bg-amber-50 p-3 dark:bg-amber-900/20">
                <div className="flex justify-between font-semibold"><span>{o.order_no} · {fmtDate(o.closed_at)}</span><span>{money(o.total)}</span></div>
                <ul className="text-sm">{o.items.map((i: any) => <li key={i.id}>{itemLabel(i)} — {money(i.line_total)}</li>)}</ul>
                <div className="mt-1 text-xs text-gray-500">Approval window closes in {Math.ceil(remaining(o) / 3600e3)} h</div>
                <div className="mt-2 flex gap-2"><Button variant="success" onClick={() => approve(o)}>✔ Approve</Button><Button variant="ghost" onClick={() => setDispute(o)}>Report discrepancy</Button></div>
              </div>
            ))}
          </div>
        </Card>
      )}
      <Card title="Order history">
        {orders.length === 0 && <Empty>No orders yet</Empty>}
        <div className="divide-y dark:divide-gray-700">
          {orders.map((o) => (
            <div key={o.id} className="py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{o.order_no}</span><Badge s={o.status} />
                {o.payment_mode && <Badge s="approved">{o.payment_mode === 'cash' ? '💵 Cash' : '📱 UPI'}</Badge>}
                {o.approval_status !== 'na' && <Badge s={o.approval_status}>{o.approval_status === 'expired' ? 'approval expired' : o.approval_status}</Badge>}
                {o.type === 'prebooked' && <Badge s="accepted">Pre-Order {fmtDate(o.scheduled_at)}</Badge>}
                <span className="ml-auto font-semibold">{money(o.total)}</span>
              </div>
              <div className="text-sm text-gray-500">{fmtDate(o.created_at)} {o.table_name && `· ${o.table_name}`} — {o.items.map(itemLabel).join(', ')}</div>
              {o.dispute_note && <div className="text-sm text-fuchsia-500">Dispute: {o.dispute_note}</div>}
              {o.resolution_note && <div className="text-sm text-emerald-500">Resolution: {o.resolution_note}</div>}
              {['draft', 'placed'].includes(o.status) && <Button size="sm" variant="ghost" className="mt-1" onClick={() => cancel(o)}>Cancel</Button>}
            </div>
          ))}
        </div>
      </Card>
      <Modal open={!!dispute} onClose={() => setDispute(null)} title={`Report discrepancy – ${dispute?.order_no}`}>
        <Textarea rows={4} placeholder="Describe what is wrong (e.g. I was charged for 2 pegs but had 1)" value={note} onChange={(e: any) => setNote(e.target.value)} />
        <div className="mt-3 flex justify-end"><Button variant="danger" disabled={!note.trim()} onClick={sendDispute}>Submit dispute</Button></div>
      </Modal>
    </div>
  );
}
