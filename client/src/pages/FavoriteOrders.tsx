import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useApp } from '../lib/app';
import { Badge, Button, Card, Empty, Field, Input, Modal, Select, cx } from '../components/ui';
import { itemLabel } from './OrdersBoard';

interface FavItemDraft {
  key: string;
  product_id: number;
  name: string;
  image?: string;
  serve_type: 'peg' | 'unit';
  peg_ml?: number | null;
  qty: number;
  unit_price: number;
}

export default function FavoriteOrders() {
  const { money, toast, reloadUser } = useApp();
  const [favs, setFavs] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);

  // Builder Modal (create or edit)
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<FavItemDraft[]>([]);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('ALL');
  const [pegPick, setPegPick] = useState<any>(null);

  const load = () => {
    api('/orders/favorites', { cache: false }).then(setFavs).catch(() => {});
  };

  useEffect(() => {
    load();
    api('/products').then(setProducts).catch(() => {});
  }, []);

  const cats = useMemo(() => [...new Set(products.map((p) => p.category).filter(Boolean))], [products]);

  const openCreate = () => {
    setEditId(null);
    setName('');
    setNotes('');
    setItems([]);
    setSearch('');
    setCatFilter('ALL');
    setOpen(true);
  };

  const openEdit = (f: any) => {
    setEditId(f.id);
    setName(f.name);
    setNotes(f.notes || '');
    setItems(
      (f.items || []).map((it: any) => ({
        key: `${it.product_id}-${it.serve_type}-${it.peg_ml || ''}`,
        product_id: it.product_id,
        name: it.name,
        image: it.image,
        serve_type: it.serve_type === 'peg' ? 'peg' : 'unit',
        peg_ml: it.serve_type === 'peg' ? Number(it.peg_ml || 30) : null,
        qty: Number(it.qty) || 1,
        unit_price: Number(it.unit_price) || 0,
      })),
    );
    setSearch('');
    setCatFilter('ALL');
    setOpen(true);
  };

  const addItem = (p: any, serve: 'peg' | 'unit', pegMl?: number) => {
    const ml = serve === 'peg' ? (pegMl || 30) : null;
    const key = `${p.id}-${serve}-${ml || ''}`;
    const unitPrice = serve === 'peg' ? Math.round((p.peg_price * (ml || 30)) / 30 * 100) / 100 : p.selling_price;
    setItems((prev) =>
      prev.find((x) => x.key === key)
        ? prev.map((x) => (x.key === key ? { ...x, qty: x.qty + 1 } : x))
        : [...prev, { key, product_id: p.id, name: p.name, image: p.image, serve_type: serve, peg_ml: ml, qty: 1, unit_price: unitPrice }],
    );
    setPegPick(null);
  };

  const setQty = (key: string, qty: number) => {
    setItems((prev) => (qty <= 0 ? prev.filter((x) => x.key !== key) : prev.map((x) => (x.key === key ? { ...x, qty } : x))));
  };

  const saveFav = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return toast('Enter a name for this favorite order', 'error');
    if (!items.length) return toast('Add at least one item', 'error');
    try {
      const body = {
        name: name.trim(),
        notes: notes.trim(),
        items: items.map((i) => ({ product_id: i.product_id, serve_type: i.serve_type, peg_ml: i.peg_ml, qty: i.qty })),
      };
      await api(editId ? `/orders/favorites/${editId}` : '/orders/favorites', { method: editId ? 'PUT' : 'POST', body });
      toast(editId ? 'Favorite order updated' : 'Favorite order saved!');
      setOpen(false);
      load();
    } catch (err: any) { toast(err.message, 'error'); }
  };

  const removeFav = async (f: any) => {
    if (!confirm(`Delete favorite order "${f.name}"?`)) return;
    try {
      await api(`/orders/favorites/${f.id}`, { method: 'DELETE' });
      toast('Deleted');
      load();
    } catch (err: any) { toast(err.message, 'error'); }
  };

  const repeatOrder = async (f: any) => {
    setBusyId(f.id);
    try {
      const o = await api<any>(`/orders/favorites/${f.id}/reorder`, { method: 'POST', body: {} });
      toast(`✔ Repeat order #${o.order_no.split('-')[1]} placed & billed!`);
      reloadUser();
    } catch (err: any) { toast(err.message, 'error'); }
    finally { setBusyId(null); }
  };

  const filteredProds = useMemo(() => {
    const s = search.trim().toLowerCase();
    return products.filter((p) => {
      if (catFilter !== 'ALL' && p.category !== catFilter) return false;
      if (!s) return true;
      return `${p.name} ${p.category} ${p.sub_category || ''}`.toLowerCase().includes(s);
    });
  }, [products, search, catFilter]);

  const draftTotal = items.reduce((s, i) => s + i.qty * i.unit_price, 0);

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <Card
        title={`⭐ My Favorite Orders (${favs.length})`}
        actions={<Button onClick={openCreate}>+ Create Favorite Order</Button>}
      >
        <p className="mb-4 text-xs text-[#707EAE] dark:text-[#94A3B8]">
          Save the drinks, snacks, or combinations you order regularly. Next time, tap <b>Repeat Order</b> to place your usual order in one tap without picking items again.
        </p>

        {favs.length === 0 ? (
          <Empty>No favorite orders saved yet. Click "+ Create Favorite Order" to set up your usual order!</Empty>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {favs.map((f) => (
              <div key={f.id} className="horizon-shadow flex flex-col justify-between rounded-[20px] border border-[#E9EDF7] bg-white p-4 dark:border-[#2A3346] dark:bg-[#1C2230]">
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="truncate text-base font-extrabold text-[#1B2559] dark:text-[#E6EDF3]">{f.name}</h3>
                      {f.notes && <div className="mt-0.5 text-xs text-[#94A3B8]">📝 {f.notes}</div>}
                    </div>
                    <span className="shrink-0 text-base font-extrabold text-[#422AFB] dark:text-[#818CF8]">
                      {money(f.live_total)}
                    </span>
                  </div>
                  <ul className="mt-3 space-y-1.5 text-sm">
                    {f.items.map((it: any, idx: number) => (
                      <li key={idx} className="flex items-center justify-between gap-2 rounded-xl bg-[#F4F7FE] px-3 py-1.5 dark:bg-[#252D3D]">
                        <div className="flex min-w-0 items-center gap-2">
                          {it.image && <img src={it.image} alt="" className="h-7 w-7 shrink-0 rounded-lg object-cover" />}
                          <span className={cx('truncate text-xs font-bold', !it.available && 'line-through opacity-50')}>
                            {itemLabel(it)}
                          </span>
                          {!it.available && <Badge s="cancelled">Out</Badge>}
                        </div>
                        <span className="shrink-0 text-xs font-bold text-[#707EAE] dark:text-[#94A3B8]">{money(it.line_total)}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[#E9EDF7] pt-3 dark:border-[#2A3346]">
                  <Button
                    className="flex-1"
                    disabled={busyId === f.id || !f.all_available}
                    onClick={() => repeatOrder(f)}
                  >
                    {busyId === f.id ? 'Placing…' : '🔁 Repeat Order'}
                  </Button>
                  <Button size="sm" variant="subtle" onClick={() => openEdit(f)}>Edit</Button>
                  <Button size="sm" variant="ghost" onClick={() => removeFav(f)}>✕</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Create / Edit Favorite Order Modal */}
      <Modal open={open} onClose={() => setOpen(false)} title={editId ? 'Edit Favorite Order' : 'Create Favorite Order'} wide>
        <form onSubmit={saveFav} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Favorite Order Name">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. My Evening Usual, Teachers + Soda" required />
            </Field>
            <Field label="Default Notes (optional)">
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Less ice, chilled glass" />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Left: Item Picker */}
            <div className="space-y-2.5">
              <div className="text-xs font-bold uppercase tracking-wider text-[#94A3B8]">Add Items</div>
              <div className="flex gap-2">
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search drinks, snacks…" className="!min-h-9 !py-1 text-xs" />
                <Select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} className="!w-36 !min-h-9 !py-1 text-xs">
                  <option value="ALL">All</option>
                  {cats.map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>
              </div>
              <div className="max-h-64 space-y-1.5 overflow-auto rounded-2xl border border-[#E9EDF7] p-2 dark:border-[#2A3346]">
                {filteredProds.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-2 rounded-xl p-2 hover:bg-[#F4F7FE] dark:hover:bg-[#252D3D]">
                    <div className="flex min-w-0 items-center gap-2">
                      {p.image && <img src={p.image} alt="" className="h-8 w-8 shrink-0 rounded-lg object-cover" />}
                      <div className="min-w-0">
                        <div className="truncate text-xs font-bold">{p.name}</div>
                        <div className="text-[11px] text-[#94A3B8]">
                          {p.is_peg ? `${money(p.peg_price)} / 30ml` : money(p.selling_price)}
                          {p.sub_category ? ` · ${p.sub_category}` : ''}
                        </div>
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="subtle"
                      onClick={() => (p.is_peg ? setPegPick(p) : addItem(p, 'unit'))}
                    >
                      + Add
                    </Button>
                  </div>
                ))}
                {filteredProds.length === 0 && <div className="py-6 text-center text-xs text-[#94A3B8]">No matching items</div>}
              </div>
            </div>

            {/* Right: Selected Items */}
            <div className="flex flex-col justify-between rounded-2xl bg-[#F4F7FE] p-3 dark:bg-[#252D3D]">
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-[#94A3B8]">Selected Items ({items.length})</span>
                  <span className="text-sm font-extrabold text-[#422AFB] dark:text-[#818CF8]">{money(draftTotal)}</span>
                </div>
                {items.length === 0 ? (
                  <div className="py-12 text-center text-xs text-[#94A3B8]">Pick items on the left to build your regular order</div>
                ) : (
                  <div className="max-h-56 space-y-2 overflow-auto">
                    {items.map((l) => (
                      <div key={l.key} className="flex items-center justify-between gap-2 rounded-xl bg-white p-2 dark:bg-[#1C2230]">
                        <div className="min-w-0">
                          <div className="truncate text-xs font-bold">{l.name}</div>
                          <div className="text-[11px] text-[#94A3B8]">
                            {l.serve_type === 'peg' ? (l.peg_ml === 30 ? 'Small 30 ml' : 'Large 60 ml') : 'Unit'} · {money(l.unit_price)}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <button type="button" onClick={() => setQty(l.key, l.qty - 1)} className="h-7 w-7 rounded-lg bg-[#F4F7FE] font-bold dark:bg-[#252D3D]">−</button>
                          <span className="w-5 text-center text-xs font-bold">{l.qty}</span>
                          <button type="button" onClick={() => setQty(l.key, l.qty + 1)} className="h-7 w-7 rounded-lg bg-[#F4F7FE] font-bold dark:bg-[#252D3D]">+</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit">Save Favorite Order</Button>
          </div>
        </form>
      </Modal>

      {/* Peg Size Sub-Modal */}
      <Modal open={!!pegPick} onClose={() => setPegPick(null)} title={pegPick ? `Choose Peg Size — ${pegPick.name}` : ''}>
        {pegPick && (
          <div className="grid grid-cols-2 gap-3">
            <Button size="lg" variant="subtle" onClick={() => addItem(pegPick, 'peg', 30)}>
              Small (30 ml)<br />{money(pegPick.peg_price)}
            </Button>
            <Button size="lg" variant="primary" onClick={() => addItem(pegPick, 'peg', 60)}>
              Large (60 ml)<br />{money(Math.round(pegPick.peg_price * 2 * 100) / 100)}
            </Button>
          </div>
        )}
      </Modal>
    </div>
  );
}
