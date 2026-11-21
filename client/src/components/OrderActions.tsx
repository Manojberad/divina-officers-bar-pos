import { useEffect, useMemo, useRef, useState } from 'react';
import { api, placeOrder, uuid } from '../lib/api';
import { isStaffRole, useApp } from '../lib/app';
import { Badge, Button, Field, Input, Modal, Select } from './ui';
import { itemLabel } from '../pages/OrdersBoard';

interface EditLine {
  product_id: number;
  name: string;
  serve_type: string;
  peg_ml: number | null;
  qty: number;
  unit_price: number;
  purchase_cost?: number | null;
}

export function EditOrderModal({
  order,
  onClose,
  onSaved,
}: {
  order: any | null;
  onClose: () => void;
  onSaved?: (updated: any) => void;
}) {
  const { user, money, toast, reloadUser } = useApp();
  const isStaff = isStaffRole(user?.role);

  const [products, setProducts] = useState<any[]>([]);
  const [items, setItems] = useState<EditLine[]>([]);
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');
  const [search, setSearch] = useState('');
  const [addProdId, setAddProdId] = useState('');
  const [addServe, setAddServe] = useState<'peg30' | 'peg60' | 'bottle' | 'unit'>('peg30');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!order) return;
    setItems(
      (order.items || []).map((i: any) => ({
        product_id: Number(i.product_id),
        name: i.name,
        serve_type: i.serve_type || 'unit',
        peg_ml: i.serve_type === 'peg' ? Number(i.peg_ml || 30) : null,
        qty: Number(i.qty) || 1,
        unit_price: Number(i.unit_price) || 0,
        ...(i.purchase_cost != null ? { purchase_cost: Number(i.purchase_cost) } : {}),
      })),
    );
    setNotes(order.notes || '');
    setReason('');
    setSearch('');
    setAddProdId('');
    setSaving(false);
    api('/products', { cache: false }).then(setProducts).catch(() => {});
  }, [order]);

  const selectableProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (!p.active) return false;
      if (!isStaff) {
        if (p.party_only) return false;
        if (p.is_local_purchase) return false;
      } else if (p.party_only && !order?.is_party) {
        return false;
      }
      if (p.is_local_purchase) return false; // local purchase items require cost entry at POS
      if (p.stock_status === 'out') return false;
      if (!q) return true;
      return `${p.name} ${p.category || ''} ${p.brand || ''}`.toLowerCase().includes(q);
    });
  }, [products, isStaff, order?.is_party, search]);

  const selProd = selectableProducts.find((p) => p.id === Number(addProdId));
  const total = Math.round(items.reduce((s, i) => s + i.qty * i.unit_price, 0) * 100) / 100;

  const addLine = () => {
    if (!selProd) return;
    let serve_type = 'unit';
    let peg_ml: number | null = null;
    let unit_price = Number(selProd.selling_price) || 0;
    if (selProd.is_peg) {
      if (isStaff && addServe === 'bottle') {
        serve_type = 'bottle';
        unit_price = Number(selProd.selling_price) || 0;
      } else if (addServe === 'peg60') {
        serve_type = 'peg';
        peg_ml = 60;
        unit_price = Math.round(Number(selProd.peg_price || 0) * 2 * 100) / 100;
      } else {
        serve_type = 'peg';
        peg_ml = 30;
        unit_price = Number(selProd.peg_price) || 0;
      }
    }
    setItems((prev) => {
      const idx = prev.findIndex((l) => l.product_id === selProd.id && l.serve_type === serve_type && (l.peg_ml || null) === peg_ml);
      if (idx >= 0) return prev.map((l, i) => (i === idx ? { ...l, qty: l.qty + 1 } : l));
      return [...prev, { product_id: selProd.id, name: selProd.name, serve_type, peg_ml, qty: 1, unit_price }];
    });
    setAddProdId('');
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!order || saving) return;
    if (!items.length) return toast('Keep at least 1 item, or cancel the order instead', 'error');
    setSaving(true);
    try {
      const updated = await api(`/orders/${order.id}/items`, {
        method: 'PUT',
        body: {
          items: items.map((l) => ({
            product_id: l.product_id,
            serve_type: l.serve_type,
            peg_ml: l.peg_ml,
            qty: l.qty,
            ...(l.purchase_cost != null ? { purchase_cost: l.purchase_cost } : {}),
          })),
          notes,
          reason: reason.trim() || undefined,
        },
      });
      toast(`✔ Order ${updated.order_no} updated (${money(updated.total)})`);
      reloadUser();
      onSaved?.(updated);
      onClose();
    } catch (err: any) {
      toast(err.message || 'Could not update order', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={!!order} onClose={onClose} title={order ? `✏️ Edit Order ${order.order_no}` : 'Edit Order'} wide>
      {order && (
        <form onSubmit={save} className="space-y-4">
          <p className="text-xs text-[#707EAE] dark:text-[#94A3B8]">
            Add drinks/products, adjust quantities, remove items, or update notes. Bill total and bar inventory update automatically.
          </p>

          <div className="space-y-2">
            {items.map((l, idx) => (
              <div key={`${l.product_id}-${l.serve_type}-${l.peg_ml}-${idx}`} className="flex items-center justify-between gap-2 rounded-2xl bg-[#F4F7FE] p-2.5 dark:bg-[#252D3D]">
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold text-[#1B2559] dark:text-[#E6EDF3]">{itemLabel(l)}</div>
                  <div className="text-xs text-[#707EAE] dark:text-[#94A3B8]">
                    {money(l.unit_price)} each · Line: <b>{money(l.unit_price * l.qty)}</b>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setItems((prev) => prev.map((x, i) => (i === idx ? { ...x, qty: x.qty - 1 } : x)).filter((x) => x.qty > 0))}
                    className="h-8 w-8 rounded-lg bg-white font-bold text-[#1B2559] shadow-xs dark:bg-[#1C2230] dark:text-[#E6EDF3]"
                    aria-label="Decrease quantity"
                  >
                    −
                  </button>
                  <span className="w-6 text-center text-sm font-bold">{l.qty}</span>
                  <button
                    type="button"
                    onClick={() => setItems((prev) => prev.map((x, i) => (i === idx ? { ...x, qty: x.qty + 1 } : x)))}
                    className="h-8 w-8 rounded-lg bg-white font-bold text-[#1B2559] shadow-xs dark:bg-[#1C2230] dark:text-[#E6EDF3]"
                    aria-label="Increase quantity"
                  >
                    +
                  </button>
                  <button
                    type="button"
                    onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                    className="ml-1 rounded-lg px-2 py-1 text-xs font-bold text-[#EE5D50] hover:bg-[#EE5D50]/10"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
            {items.length === 0 && (
              <div className="rounded-2xl border border-dashed border-[#EE5D50] p-4 text-center text-xs font-semibold text-[#EE5D50]">
                All items removed — add at least one item below to save, or cancel the order instead.
              </div>
            )}
          </div>

          {/* Add New Product / Drink */}
          <div className="space-y-2 rounded-2xl border border-[#E9EDF7] p-3 dark:border-[#2A3346]">
            <div className="text-xs font-bold uppercase tracking-wider text-[#94A3B8]">Add Product / Drink</div>
            <Input
              placeholder="🔍 Search drinks, mocktails, soft drinks, food…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[190px] flex-1">
                <Select value={addProdId} onChange={(e) => { setAddProdId(e.target.value); setAddServe('peg30'); }}>
                  <option value="">Choose product ({selectableProducts.length} available)…</option>
                  {selectableProducts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {p.is_peg ? `${money(p.peg_price)}/30ml` : money(p.selling_price)}
                    </option>
                  ))}
                </Select>
              </div>
              {selProd?.is_peg && (
                <div className="w-40">
                  <Select value={addServe} onChange={(e) => setAddServe(e.target.value as any)}>
                    <option value="peg30">Small (30 ml)</option>
                    <option value="peg60">Large (60 ml)</option>
                    {isStaff && <option value="bottle">Full Bottle</option>}
                  </Select>
                </div>
              )}
              <Button type="button" variant="subtle" onClick={addLine} disabled={!addProdId}>
                + Add
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Order Notes">
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. less ice, on the rocks" />
            </Field>
            <Field label="Reason for Change (optional)">
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Added one more drink" />
            </Field>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#E9EDF7] pt-3 dark:border-[#2A3346]">
            <div>
              <div className="text-xs text-[#94A3B8]">Previous: {money(order.total)}</div>
              <div className="text-base font-extrabold text-[#1B2559] dark:text-[#E6EDF3]">
                Updated Total: <span className="text-[#422AFB] dark:text-[#818CF8]">{money(total)}</span>
              </div>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={!items.length || saving}>
                {saving ? 'Saving…' : 'Save Changes'}
              </Button>
            </div>
          </div>
        </form>
      )}
    </Modal>
  );
}

export function RepeatOrderModal({
  order,
  tableCode,
  onClose,
  onPlaced,
}: {
  order: any | null;
  tableCode?: string;
  onClose: () => void;
  onPlaced?: (newOrder: any) => void;
}) {
  const { money, toast, reloadUser } = useApp();
  const [step, setStep] = useState<'choose' | 'review'>('choose');
  const [mode, setMode] = useState<'drinks' | 'full'>('drinks');
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<any>(null);
  const [draftItems, setDraftItems] = useState<any[]>([]);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const clientUuidRef = useRef<string>(uuid());

  useEffect(() => {
    if (!order) return;
    setStep('choose');
    setPreview(null);
    setDraftItems([]);
    setNotes(order.notes || '');
    setSubmitting(false);
    clientUuidRef.current = uuid();
  }, [order]);

  const chooseMode = async (m: 'drinks' | 'full') => {
    if (!order) return;
    setMode(m);
    setStep('review');
    setLoading(true);
    setPreview(null);
    clientUuidRef.current = uuid();
    try {
      const data = await api(`/orders/${order.id}/repeat-preview?mode=${m}`, { cache: false });
      setPreview(data);
      setDraftItems((data.items || []).filter((i: any) => i.available).map((i: any) => ({ ...i })));
      setNotes(data.notes || '');
    } catch (e: any) {
      toast(e.message || 'Could not load repeat preview', 'error');
      setStep('choose');
    } finally {
      setLoading(false);
    }
  };

  const unavailableItems = useMemo(
    () => (preview?.items || []).filter((i: any) => !i.available),
    [preview],
  );

  const liveTotal = useMemo(
    () => Math.round(draftItems.reduce((s, i) => s + Number(i.current_unit_price || 0) * Number(i.qty || 0), 0) * 100) / 100,
    [draftItems],
  );

  const submitRepeat = async () => {
    if (!order || submitting || draftItems.length === 0) return;
    setSubmitting(true);
    try {
      const r = await placeOrder({
        client_uuid: clientUuidRef.current,
        items: draftItems.map((i) => ({
          product_id: i.product_id,
          serve_type: i.serve_type,
          peg_ml: i.serve_type === 'peg' ? i.peg_ml : null,
          qty: i.qty,
          ...(i.purchase_cost != null ? { purchase_cost: i.purchase_cost } : {}),
        })),
        notes: notes.trim() || `Repeat ${mode === 'drinks' ? 'drinks' : 'order'} from ${order.order_no}`,
        source: mode === 'drinks' ? 'repeat_drinks' : 'repeat_order',
        ...(tableCode ? { table_code: tableCode } : order.table_id ? { table_id: order.table_id } : {}),
      });
      if (r.queued) {
        toast('Offline — repeat order queued and will sync automatically');
      } else {
        toast(`✔ New order ${r.order?.order_no || ''} placed (${money(r.order?.total ?? liveTotal)})!`);
      }
      reloadUser();
      onPlaced?.(r.order);
      onClose();
    } catch (e: any) {
      toast(e.message || 'Could not place repeat order', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={!!order}
      onClose={onClose}
      title={order ? `🔁 Repeat Order ${order.order_no}` : 'Repeat Order'}
      wide={step === 'review'}
    >
      {order && step === 'choose' && (
        <div className="space-y-4">
          <p className="text-xs text-[#707EAE] dark:text-[#94A3B8]">
            Choose what you would like to repeat. A brand-new order will be created using <b>current live prices</b> — your previous order will not be changed.
          </p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => chooseMode('drinks')}
              className="flex flex-col items-start rounded-2xl border border-[#422AFB]/30 bg-[#422AFB]/5 p-4 text-left transition hover:-translate-y-0.5 hover:border-[#422AFB] hover:bg-[#422AFB]/10 dark:border-[#818CF8]/30 dark:bg-[#6366F1]/10 dark:hover:border-[#818CF8]"
            >
              <span className="text-2xl">🥃</span>
              <span className="mt-2 text-base font-extrabold text-[#1B2559] dark:text-[#E6EDF3]">Repeat Drinks</span>
              <span className="mt-1 text-xs text-[#707EAE] dark:text-[#94A3B8]">
                Re-add only drinks &amp; beverages (Alcohol, Mocktails, Soft Drinks) with their variants and quantities. Food &amp; snacks excluded.
              </span>
            </button>

            <button
              type="button"
              onClick={() => chooseMode('full')}
              className="flex flex-col items-start rounded-2xl border border-[#E0E5F2] bg-[#F4F7FE] p-4 text-left transition hover:-translate-y-0.5 hover:border-[#422AFB] hover:bg-[#E9EDF7] dark:border-[#2E384D] dark:bg-[#252D3D] dark:hover:border-[#818CF8]"
            >
              <span className="text-2xl">🍽</span>
              <span className="mt-2 text-base font-extrabold text-[#1B2559] dark:text-[#E6EDF3]">Repeat Entire Order</span>
              <span className="mt-1 text-xs text-[#707EAE] dark:text-[#94A3B8]">
                Re-add every item from order {order.order_no}. You can review and edit quantities before submitting.
              </span>
            </button>
          </div>

          <div className="flex justify-end">
            <Button type="button" variant="ghost" onClick={onClose}>Close</Button>
          </div>
        </div>
      )}

      {order && step === 'review' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Badge s="accepted">{mode === 'drinks' ? '🥃 Repeat Drinks' : '🍽 Repeat Entire Order'}</Badge>
              <span className="text-xs text-[#94A3B8]">Creates a new order using live prices</span>
            </div>
            <button
              type="button"
              onClick={() => setStep('choose')}
              className="text-xs font-bold text-[#422AFB] hover:underline dark:text-[#818CF8]"
            >
              ← Change option
            </button>
          </div>

          {loading ? (
            <div className="py-8 text-center text-sm text-[#94A3B8]">Checking live prices &amp; stock availability…</div>
          ) : (
            <>
              {preview?.excluded_count > 0 && (
                <div className="rounded-2xl bg-[#422AFB]/10 px-3.5 py-2.5 text-xs font-semibold text-[#1B2559] dark:bg-[#6366F1]/15 dark:text-[#E6EDF3]">
                  ℹ️ {preview.excluded_count} non-drink item(s) excluded from Repeat Drinks:{' '}
                  <span className="font-normal text-[#707EAE] dark:text-[#94A3B8]">
                    {preview.excluded_items.map((x: any) => x.name).join(', ')}
                  </span>
                </div>
              )}

              {unavailableItems.length > 0 && (
                <div className="rounded-2xl border border-[#EE5D50]/40 bg-[#EE5D50]/10 p-3 text-xs text-[#B91C1C] dark:text-[#FCA5A5]">
                  <div className="font-bold">⚠️ Some items from your previous order are currently unavailable:</div>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    {unavailableItems.map((u: any, idx: number) => (
                      <li key={idx}>
                        <b>{itemLabel(u)}</b> — {u.unavailable_reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {preview?.has_price_changes && (
                <div className="rounded-2xl bg-amber-500/15 px-3.5 py-2 text-xs font-semibold text-amber-800 dark:text-amber-300">
                  💡 Current live menu prices are applied below where prices have updated since your previous order.
                </div>
              )}

              {draftItems.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[#E0E5F2] p-6 text-center text-sm text-[#707EAE] dark:border-[#2E384D] dark:text-[#94A3B8]">
                  {mode === 'drinks'
                    ? 'No available drinks were found in this previous order.'
                    : 'None of the items from this previous order are currently available.'}
                </div>
              ) : (
                <div className="space-y-2">
                  {draftItems.map((it, idx) => (
                    <div
                      key={`${it.product_id}-${it.serve_type}-${it.peg_ml}-${idx}`}
                      className="flex items-center justify-between gap-2 rounded-2xl bg-[#F4F7FE] p-2.5 dark:bg-[#252D3D]"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-bold text-[#1B2559] dark:text-[#E6EDF3]">
                          {itemLabel(it)}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 text-xs text-[#707EAE] dark:text-[#94A3B8]">
                          <span>Live price: <b>{money(it.current_unit_price)}</b></span>
                          {it.price_changed && (
                            <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300">
                              was {money(it.prev_unit_price)}
                            </span>
                          )}
                          <span>· Line: <b>{money(it.current_unit_price * it.qty)}</b></span>
                        </div>
                        {it.stock_warning && (
                          <div className="mt-0.5 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                            ⚠️ {it.stock_warning}
                          </div>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            setDraftItems((prev) =>
                              prev.map((x, i) => (i === idx ? { ...x, qty: x.qty - 1 } : x)).filter((x) => x.qty > 0),
                            )
                          }
                          className="h-8 w-8 rounded-lg bg-white font-bold text-[#1B2559] shadow-xs dark:bg-[#1C2230] dark:text-[#E6EDF3]"
                        >
                          −
                        </button>
                        <span className="w-6 text-center text-sm font-bold">{it.qty}</span>
                        <button
                          type="button"
                          onClick={() =>
                            setDraftItems((prev) =>
                              prev.map((x, i) => {
                                if (i !== idx) return x;
                                if (x.max_available != null && x.qty >= x.max_available) {
                                  toast(`Only ${x.max_available} available for ${x.name}`, 'error');
                                  return x;
                                }
                                return { ...x, qty: x.qty + 1 };
                              }),
                            )
                          }
                          className="h-8 w-8 rounded-lg bg-white font-bold text-[#1B2559] shadow-xs dark:bg-[#1C2230] dark:text-[#E6EDF3]"
                        >
                          +
                        </button>
                        <button
                          type="button"
                          onClick={() => setDraftItems((prev) => prev.filter((_, i) => i !== idx))}
                          className="ml-1 rounded-lg px-2 py-1 text-xs font-bold text-[#EE5D50] hover:bg-[#EE5D50]/10"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {draftItems.length > 0 && (
                <Field label="Order Notes (optional)">
                  <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. less ice, extra lime" />
                </Field>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#E9EDF7] pt-3 dark:border-[#2A3346]">
                <div className="text-base font-extrabold text-[#1B2559] dark:text-[#E6EDF3]">
                  New Order Total: <span className="text-[#422AFB] dark:text-[#818CF8]">{money(liveTotal)}</span>
                </div>
                <div className="flex gap-2">
                  <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
                  <Button type="button" disabled={draftItems.length === 0 || submitting} onClick={submitRepeat}>
                    {submitting ? 'Placing Order…' : `Place New Order (${money(liveTotal)})`}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
