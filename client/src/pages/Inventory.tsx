import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useApp, isAdminRole } from '../lib/app';
import { Button, Card, DateRange, Field, Input, Modal, Select, StockDot, daysAgo, fmtDate, today } from '../components/ui';

export default function Inventory() {
  const { user, money, toast } = useApp();
  const admin = isAdminRole(user?.role);
  const [tab, setTab] = useState<'stock' | 'purchase' | 'wastage' | 'reconcile' | 'history'>('stock');
  const [products, setProducts] = useState<any[]>([]);
  const [cats, setCats] = useState<any[]>([]);
  const [movements, setMovements] = useState<any[]>([]);
  const [recons, setRecons] = useState<any[]>([]);
  const [range, setRange] = useState([daysAgo(29), today()]);
  const [prodFilter, setProdFilter] = useState('');
  const [movModal, setMovModal] = useState<any>(null);
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [reconNote, setReconNote] = useState('');

  // Search & Filters for Current Stock & Reconciliation
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('ALL');
  const [subFilter, setSubFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState<'all' | 'instock' | 'low' | 'out'>('all');

  const load = () => {
    api('/products?all=1', { cache: false }).then(setProducts).catch(() => {});
    api('/categories', { cache: false }).then(setCats).catch(() => {});
    api(`/inventory/movements?from=${range[0]}&to=${range[1]}${prodFilter ? `&product_id=${prodFilter}` : ''}`, { cache: false }).then(setMovements).catch(() => {});
    api(`/inventory/reconciliations?from=${range[0]}&to=${range[1]}`, { cache: false }).then(setRecons).catch(() => {});
  };
  useEffect(load, [range, prodFilter]);

  const submitMov = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await api('/inventory/movement', { method: 'POST', body: movModal }); toast('Stock updated'); setMovModal(null); load(); } catch (e: any) { toast(e.message, 'error'); }
  };

  const submitRecon = async () => {
    const items = Object.entries(counts).filter(([, v]) => v !== '').map(([k, v]) => ({ product_id: Number(k), physical_qty: Number(v) }));
    if (!items.length) return toast('Enter at least one physical count', 'error');
    try { await api('/inventory/reconcile', { method: 'POST', body: { items, note: reconNote } }); toast('Reconciled'); setCounts({}); setReconNote(''); load(); } catch (e: any) { toast(e.message, 'error'); }
  };

  const availableSubs = useMemo(() => {
    const list = catFilter === 'ALL' ? products : products.filter((p) => String(p.category_id) === catFilter);
    return [...new Set(list.map((p) => p.sub_category).filter(Boolean))].sort();
  }, [products, catFilter]);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (catFilter !== 'ALL' && String(p.category_id) !== catFilter) return false;
      if (subFilter !== 'ALL' && (p.sub_category || '') !== subFilter) return false;
      if (statusFilter === 'instock' && p.stock_status === 'out') return false;
      if (statusFilter === 'low' && !['low', 'critical'].includes(p.stock_status)) return false;
      if (statusFilter === 'out' && p.stock_status !== 'out') return false;
      if (!q) return true;
      return `${p.name} ${p.category || ''} ${p.sub_category || ''} ${p.brand || ''}`.toLowerCase().includes(q);
    });
  }, [products, search, catFilter, subFilter, statusFilter]);

  const filteredValue = useMemo(
    () => filteredProducts.reduce((s, p) => s + (Number(p.stock_value) || 0), 0),
    [filteredProducts],
  );

  const physicalProducts = useMemo(() => products.filter((p) => !p.is_recipe && !p.is_local_purchase), [products]);
  const selProd = products.find((p) => p.id === Number(movModal?.product_id));

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {(['stock', 'purchase', 'wastage', ...(admin ? ['reconcile'] : []), 'history'] as any[]).map((t) => (
            <Button key={t} variant={tab === t ? 'primary' : 'subtle'} onClick={() => setTab(t)} className="capitalize">
              {t === 'purchase' ? 'Purchase register' : t === 'wastage' ? 'Wastage & complimentary' : t}
            </Button>
          ))}
        </div>
        <div className="flex gap-2">
          {admin && <Button onClick={() => setMovModal({ type: 'purchase', product_id: physicalProducts[0]?.id || '', qty: '', unit_cost: '', supplier: '', invoice: '', note: '' })}>+ Add Purchase</Button>}
          <Button variant="ghost" onClick={() => setMovModal({ type: 'wastage', product_id: physicalProducts[0]?.id || '', qty: '', ml: '', note: '' })}>Record Wastage / Comp</Button>
          {admin && <Button variant="ghost" onClick={() => setMovModal({ type: 'adjustment', product_id: physicalProducts[0]?.id || '', qty: '', note: '' })}>Manual Adjustment</Button>}
        </div>
      </div>

      {tab === 'stock' && (
        <Card
          title={`Current Stock (${filteredProducts.length} of ${products.length} items${admin ? ` · Value: ${money(filteredValue)}` : ''})`}
        >
          {/* Search & Relevant Filters */}
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Input
              placeholder="🔍 Search product, sub-category, brand…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="!max-w-xs"
            />
            <Select
              value={catFilter}
              onChange={(e) => { setCatFilter(e.target.value); setSubFilter('ALL'); }}
              className="!w-44 !min-h-10 !py-1.5 text-sm"
            >
              <option value="ALL">All Categories</option>
              {cats.map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
            </Select>
            {availableSubs.length > 0 && (
              <Select
                value={subFilter}
                onChange={(e) => setSubFilter(e.target.value)}
                className="!w-40 !min-h-10 !py-1.5 text-sm"
              >
                <option value="ALL">All Sub-Categories</option>
                {availableSubs.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            )}
            <div className="flex flex-wrap gap-1.5">
              {([
                ['all', 'All'],
                ['instock', 'In Stock'],
                ['low', 'Low / Critical'],
                ['out', 'Out of Stock'],
              ] as const).map(([k, lbl]) => (
                <Button key={k} size="sm" variant={statusFilter === k ? 'primary' : 'subtle'} onClick={() => setStatusFilter(k)}>
                  {lbl}
                </Button>
              ))}
            </div>
            {(search || catFilter !== 'ALL' || subFilter !== 'ALL' || statusFilter !== 'all') && (
              <Button size="sm" variant="ghost" onClick={() => { setSearch(''); setCatFilter('ALL'); setSubFilter('ALL'); setStatusFilter('all'); }}>
                Clear
              </Button>
            )}
          </div>

          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs font-bold uppercase tracking-wider text-[#94A3B8]">
                <tr>
                  <th className="p-2">Product</th>
                  <th>Category / Sub</th>
                  <th>Size / Unit</th>
                  <th>Stock</th>
                  <th>Status</th>
                  {admin && <th>Purchase</th>}
                  <th>Selling</th>
                  {admin && <th className="text-right">Value @Cost</th>}
                </tr>
              </thead>
              <tbody>
                {filteredProducts.map((p) => (
                  <tr key={p.id} className="border-t border-[#E9EDF7] dark:border-[#2A3346]">
                    <td className="p-2 font-semibold">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span>{p.name}</span>
                        {p.party_only && (
                          <span className="rounded-full bg-[#D97706]/15 px-2 py-0.5 text-[10px] font-extrabold text-[#B45309] dark:bg-[#FBBF24]/20 dark:text-[#FCD34D]">
                            🎉 Party Only
                          </span>
                        )}
                        {p.is_local_purchase && (
                          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-extrabold text-emerald-700 dark:text-emerald-300">
                            🛒 Local Purchase
                          </span>
                        )}
                        {p.is_recipe && (
                          <span className="rounded-full bg-[#422AFB]/12 px-2 py-0.5 text-[10px] font-extrabold text-[#422AFB] dark:bg-[#6366F1]/20 dark:text-[#A5B4FC]">
                            🍹 Recipe
                          </span>
                        )}
                      </div>
                    </td>
                    <td>
                      <div>{p.category}</div>
                      {p.sub_category && <div className="text-xs text-[#94A3B8]">{p.sub_category}</div>}
                    </td>
                    <td>{p.size_ml ? `${p.size_ml} ml` : p.unit}</td>
                    <td>
                      {p.is_local_purchase ? (
                        <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">On-demand (no stock)</span>
                      ) : (
                        <>
                          <b>{p.stock_display}</b> {p.stock_unit}
                          {p.is_recipe && (
                            <div className="text-xs text-[#94A3B8]">
                              makeable from ingredients{p.limiting_ingredient ? ` (min: ${p.limiting_ingredient})` : ''}
                            </div>
                          )}
                          {p.is_peg && (
                            <div className="text-xs text-[#94A3B8]">
                              {p.full_bottles ?? 0} btl · {p.loose_pegs_30ml ?? 0} loose pegs ({Math.round(p.stock)} ml)
                            </div>
                          )}
                        </>
                      )}
                    </td>
                    <td>{p.is_local_purchase ? <span className="text-xs font-bold text-[#94A3B8]">—</span> : <StockDot s={p.stock_status} />}</td>
                    {admin && <td>{p.is_local_purchase ? 'Entered at sale' : p.is_recipe ? `${money(p.recipe_cost ?? 0)} (recipe)` : money(p.purchase_price)}</td>}
                    <td>{p.is_local_purchase ? `Cost + ${p.local_margin_pct ?? 10}%` : `${money(p.selling_price)}${p.is_peg ? ` · 30ml ${money(p.peg_price)}` : ''}`}</td>
                    {admin && <td className="text-right font-semibold">{p.is_local_purchase ? <span className="text-xs text-[#94A3B8]">on-demand</span> : p.is_recipe ? <span className="text-xs text-[#94A3B8]">on ingredients</span> : money(p.stock_value)}</td>}
                  </tr>
                ))}
                {filteredProducts.length === 0 && (
                  <tr><td colSpan={admin ? 8 : 6} className="py-8 text-center text-sm text-[#94A3B8]">No matching stock items</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {(tab === 'purchase' || tab === 'wastage' || tab === 'history') && (
        <Card title={tab === 'purchase' ? 'Purchase register' : tab === 'wastage' ? 'Wastage & complimentary register' : 'Product-wise consumption & movement history'}
          actions={<div className="flex flex-wrap gap-2"><Select value={prodFilter} onChange={(e) => setProdFilter(e.target.value)} className="!w-full sm:!w-52 !min-h-9 !py-1"><option value="">All products</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select><DateRange from={range[0]} to={range[1]} onChange={(f, t) => setRange([f, t])} /></div>}>
          <div className="w-full overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-gray-500"><tr><th className="p-2">Date</th><th>Product</th><th>Type</th><th>Qty</th><th>Details</th><th>By</th><th className="text-right">Value</th></tr></thead>
              <tbody>
                {movements.filter((m) => (tab === 'purchase' ? ['purchase', 'opening'].includes(m.type) : tab === 'wastage' ? ['wastage', 'complimentary'].includes(m.type) : true)).map((m) => (
                  <tr key={m.id} className="border-t dark:border-gray-700">
                    <td className="p-2">{fmtDate(m.at)}</td><td>{m.product}</td><td className="capitalize">{m.type}</td>
                    <td className={m.qty < 0 ? 'text-red-500' : 'text-emerald-600'}>{m.qty > 0 ? '+' : ''}{m.qty_display} {m.is_peg ? `btl (${m.qty} ml)` : m.unit}</td>
                    <td>{[m.supplier, m.invoice && `Inv ${m.invoice}`, m.order_no && `#${m.order_no}`, m.note].filter(Boolean).join(' · ')}</td>
                    <td>{m.user_name || '—'}</td><td className="text-right">{m.value ? money(m.value) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'reconcile' && admin && (
        <Card title="Physical stock reconciliation" actions={<div className="flex flex-wrap gap-2"><Input placeholder="🔍 Filter items…" value={search} onChange={(e) => setSearch(e.target.value)} className="!w-full sm:!w-48 !min-h-9" /><Input placeholder="Reconciliation note" value={reconNote} onChange={(e) => setReconNote(e.target.value)} className="!w-full sm:!w-56 !min-h-9" /><Button onClick={submitRecon}>Apply reconciliation</Button></div>}>
          <div className="w-full overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-gray-500"><tr><th className="p-2">Product</th><th>System stock</th><th>Physical count (bottles / units)</th><th>Difference</th></tr></thead>
              <tbody>
                {filteredProducts.filter((p) => !p.is_recipe && !p.is_local_purchase).map((p) => {
                  const v = counts[p.id] ?? '';
                  const diff = v === '' ? null : Math.round((Number(v) - p.stock_display) * 1000) / 1000;
                  return (
                    <tr key={p.id} className="border-t dark:border-gray-700">
                      <td className="p-2 font-semibold">{p.name}</td><td>{p.stock_display} {p.stock_unit}</td>
                      <td><Input type="number" step="0.01" className="!w-32 sm:!w-36 !min-h-9 !py-1" value={v} onChange={(e) => setCounts({ ...counts, [p.id]: e.target.value })} placeholder={String(p.stock_display)} /></td>
                      <td className={diff ? (diff < 0 ? 'font-bold text-red-500' : 'font-bold text-emerald-500') : ''}>{diff == null ? '—' : `${diff > 0 ? '+' : ''}${diff}`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {recons.length > 0 && (
            <div className="mt-6">
              <h4 className="mb-2 font-semibold">Previous reconciliations</h4>
              <div className="w-full overflow-x-auto">
                <table className="w-full text-sm"><thead className="text-left text-gray-500"><tr><th>Date</th><th>Product</th><th>System</th><th>Physical</th><th>Diff</th><th>Note</th><th>By</th></tr></thead>
                  <tbody>{recons.map((r) => <tr key={r.id} className="border-t dark:border-gray-700"><td className="py-1">{fmtDate(r.at)}</td><td>{r.product}</td><td>{r.system_qty}</td><td>{r.physical_qty}</td><td className={r.diff < 0 ? 'text-red-500' : 'text-emerald-500'}>{r.diff}</td><td>{r.note}</td><td>{r.user_name}</td></tr>)}</tbody>
                </table>
              </div>
            </div>
          )}
        </Card>
      )}

      <Modal open={!!movModal} onClose={() => setMovModal(null)} title="Record stock movement">
        {movModal && (
          <form onSubmit={submitMov} className="space-y-3">
            <Field label="Movement type">
              <Select value={movModal.type} onChange={(e) => setMovModal({ ...movModal, type: e.target.value })}>
                {admin && <option value="purchase">Purchase (stock addition)</option>}
                <option value="wastage">Wastage / breakage</option>
                <option value="complimentary">Complimentary drink</option>
                {admin && <option value="removal">Stock removal</option>}
                {admin && <option value="adjustment">Manual adjustment (+ or −)</option>}
              </Select>
            </Field>
            <Field label="Product">
              <Select value={movModal.product_id} onChange={(e) => setMovModal({ ...movModal, product_id: Number(e.target.value) })}>
                {physicalProducts.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.stock_display} {p.stock_unit})</option>)}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label={`Quantity (${selProd?.stock_unit || 'units'})`}><Input type="number" step="0.01" value={movModal.qty} onChange={(e) => setMovModal({ ...movModal, qty: e.target.value, ml: '' })} /></Field>
              {selProd?.is_peg && ['wastage', 'complimentary'].includes(movModal.type) && (
                <Field label="…or in ml (e.g. 30, 60)"><Input type="number" value={movModal.ml || ''} onChange={(e) => setMovModal({ ...movModal, ml: e.target.value, qty: '' })} /></Field>
              )}
            </div>
            {movModal.type === 'purchase' && (
              <div className="grid grid-cols-3 gap-2">
                <Field label="Unit cost"><Input type="number" step="0.01" placeholder={String(selProd?.purchase_price || '')} value={movModal.unit_cost} onChange={(e) => setMovModal({ ...movModal, unit_cost: e.target.value })} /></Field>
                <Field label="Supplier"><Input value={movModal.supplier} onChange={(e) => setMovModal({ ...movModal, supplier: e.target.value })} /></Field>
                <Field label="Invoice #"><Input value={movModal.invoice} onChange={(e) => setMovModal({ ...movModal, invoice: e.target.value })} /></Field>
              </div>
            )}
            <Field label="Reason / note"><Input value={movModal.note || ''} onChange={(e) => setMovModal({ ...movModal, note: e.target.value })} required={movModal.type !== 'purchase' && movModal.type !== 'complimentary'} /></Field>
            <div className="flex justify-end"><Button>Save</Button></div>
          </form>
        )}
      </Modal>
    </div>
  );
}
