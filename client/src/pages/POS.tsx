import { useEffect, useMemo, useState } from 'react';
import { api, placeOrder } from '../lib/api';
import { useApp } from '../lib/app';
import { Button, Field, Input, Modal, Select, StockDot, Textarea, cx } from '../components/ui';

export interface Product {
  id: number; name: string; category: string; category_id: number; brand?: string; description?: string; image?: string; size_ml: number; unit: string;
  is_peg: boolean; selling_price: number; peg_price: number; favourite: boolean; available?: boolean; stock_status?: string; stock_display?: number; stock_unit?: string;
}
interface Line { key: string; product_id: number; name: string; image?: string; serve_type: 'bottle' | 'peg' | 'unit'; peg_ml?: number; qty: number; unit_price: number; custom_price?: boolean }

const lineKey = (pid: number, serve: string, ml?: number) => `${pid}-${serve}-${ml || ''}`;

export default function POS({ mode, tableCode, preload, onPlaced }: { mode: 'staff' | 'self' | 'qr'; tableCode?: string; preload?: { products: Product[]; categories: any[] }; onPlaced?: () => void }) {
  const { user, money, toast, reloadUser } = useApp();
  const staff = mode === 'staff' || (user != null && ['admin', 'bartender'].includes(user.role));
  const [products, setProducts] = useState<Product[]>(preload?.products || []);
  const [categories, setCategories] = useState<any[]>(preload?.categories || []);
  const [cat, setCat] = useState<number | 'fav' | null>(null);
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<Line[]>(() => JSON.parse(localStorage.getItem(`cart-${mode}`) || '[]'));
  const [picker, setPicker] = useState<Product | null>(null);
  const [customers, setCustomers] = useState<any[]>([]);
  const [tables, setTables] = useState<any[]>([]);
  const [opts, setOpts] = useState({ user_id: '', table_id: '', notes: '', type: 'ondemand', scheduled_at: '' });
  const [busy, setBusy] = useState(false);
  const [showCart, setShowCart] = useState(false);

  const load = () => {
    if (preload) return;
    api<Product[]>('/products').then(setProducts).catch((e) => toast(e.message, 'error'));
    api('/categories').then(setCategories).catch(() => {});
  };
  useEffect(() => {
    load();
    if (staff) { api('/users/lookup').then(setCustomers).catch(() => {}); api('/tables').then((t) => setTables(t.filter((x: any) => x.active))).catch(() => {}); }
  }, []);
  useEffect(() => { if (preload) { setProducts(preload.products); setCategories(preload.categories); } }, [preload]);
  useEffect(() => { localStorage.setItem(`cart-${mode}`, JSON.stringify(cart)); }, [cart, mode]);

  const shown = useMemo(() => {
    const s = search.trim().toLowerCase();
    return products.filter((p) => (cat === 'fav' ? p.favourite : cat ? p.category_id === cat : true) && (!s || `${p.name} ${p.brand} ${p.category}`.toLowerCase().includes(s)));
  }, [products, cat, search]);

  const add = (p: Product, serve: Line['serve_type'], peg_ml?: number) => {
    const unit_price = serve === 'peg' ? Math.round((p.peg_price * (peg_ml || 30)) / 30 * 100) / 100 : p.selling_price;
    const key = lineKey(p.id, serve, peg_ml);
    setCart((c) => (c.find((l) => l.key === key) ? c.map((l) => (l.key === key ? { ...l, qty: l.qty + 1 } : l)) : [...c, { key, product_id: p.id, name: p.name, image: p.image, serve_type: serve, peg_ml, qty: 1, unit_price }]));
    setPicker(null);
  };
  const isOut = (p: Product) => p.stock_status === 'out' || p.available === false;
  const tap = (p: Product) => {
    if (isOut(p)) return toast(`${p.name} is out of stock`, 'error');
    if (p.is_peg) setPicker(p); else add(p, 'unit');
  };
  const setQty = (key: string, qty: number) => setCart((c) => (qty <= 0 ? c.filter((l) => l.key !== key) : c.map((l) => (l.key === key ? { ...l, qty } : l))));
  const total = cart.reduce((s, l) => s + l.qty * l.unit_price, 0);
  const count = cart.reduce((s, l) => s + l.qty, 0);

  const toggleFav = async (p: Product) => {
    const u = await api<Product>(`/products/${p.id}/favourite`, { method: 'POST' });
    setProducts((ps) => ps.map((x) => (x.id === p.id ? u : x)));
  };

  const submit = async (status: 'placed' | 'draft' = 'placed') => {
    if (!cart.length) return;
    if (opts.type === 'prebooked' && !opts.scheduled_at) return toast('Choose a date/time for the pre-booking', 'error');
    setBusy(true);
    try {
      const body: any = {
        items: cart.map((l) => ({ product_id: l.product_id, serve_type: l.serve_type, peg_ml: l.peg_ml, qty: l.qty, ...(staff && l.custom_price ? { unit_price: l.unit_price } : {}) })),
        notes: opts.notes || undefined, type: opts.type, scheduled_at: opts.type === 'prebooked' ? new Date(opts.scheduled_at).toISOString() : undefined, status,
        source: mode === 'qr' ? 'qr' : staff ? 'pos' : 'app',
      };
      if (staff) { body.user_id = opts.user_id || undefined; body.table_id = opts.table_id || undefined; }
      if (tableCode) body.table_code = tableCode;
      const r = await placeOrder(body);
      if (r.queued) toast('Server unreachable – order queued and will sync automatically');
      else toast(`Order ${r.order.order_no} ${status === 'draft' ? 'saved as draft' : 'placed'}`);
      setCart([]); setOpts({ ...opts, notes: '', type: 'ondemand', scheduled_at: '', user_id: '' }); setShowCart(false);
      load(); reloadUser(); onPlaced?.();
    } catch (e: any) { toast(e.message, 'error'); } finally { setBusy(false); }
  };

  const cartPanel = (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-[#E9EDF7] p-4 dark:border-[#2A3346]">
        <h2 className="text-lg font-extrabold text-[#1B2559] dark:text-[#E6EDF3]">
          Current Order <span className="text-sm font-semibold text-[#94A3B8]">({count})</span>
        </h2>
        {cart.length > 0 && <button className="text-xs font-bold text-[#F87171]" onClick={() => setCart([])}>Clear All</button>}
      </div>
      <div className="flex-1 space-y-2.5 overflow-auto p-3.5">
        {cart.length === 0 && <div className="py-16 text-center text-sm font-medium text-[#94A3B8]">Tap a product card to add it</div>}
        {cart.map((l) => (
          <div key={l.key} className="flex items-center gap-2.5 rounded-2xl bg-[#F4F7FE] p-3 dark:bg-[#252D3D]">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-bold text-[#1B2559] dark:text-[#E6EDF3]">{l.name}</div>
              <div className="mt-0.5 flex items-center gap-1 text-xs font-medium text-[#94A3B8]">
                {l.serve_type === 'peg'
                  ? l.peg_ml === 30
                    ? 'Small (30 ml)'
                    : l.peg_ml === 60
                      ? 'Large (60 ml)'
                      : `Peg ${l.peg_ml} ml`
                  : l.serve_type === 'bottle'
                    ? 'Full Bottle (750 ml)'
                    : 'Unit'} ·
                {staff ? (
                  <input type="number" className="w-20 rounded-lg border border-[#E0E5F2] bg-white px-1.5 py-0.5 text-xs font-bold text-[#1B2559] dark:border-[#2E384D] dark:bg-[#151A25] dark:text-[#E6EDF3]" value={l.unit_price}
                    onChange={(e) => setCart((c) => c.map((x) => (x.key === l.key ? { ...x, unit_price: Number(e.target.value), custom_price: true } : x)))} />
                ) : money(l.unit_price)}
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <button className="h-9 w-9 rounded-xl bg-white text-base font-extrabold text-[#1B2559] shadow-xs dark:bg-[#1C2230] dark:text-[#E6EDF3]" onClick={() => setQty(l.key, l.qty - 1)}>−</button>
              <span className="w-7 text-center text-sm font-extrabold">{l.qty}</span>
              <button className="h-9 w-9 rounded-xl bg-white text-base font-extrabold text-[#1B2559] shadow-xs dark:bg-[#1C2230] dark:text-[#E6EDF3]" onClick={() => setQty(l.key, l.qty + 1)}>+</button>
            </div>
            <div className="w-20 text-right text-sm font-extrabold text-[#422AFB] dark:text-[#818CF8]">{money(l.qty * l.unit_price)}</div>
          </div>
        ))}
      </div>
      <div className="space-y-2.5 border-t border-[#E9EDF7] p-4 dark:border-[#2A3346]">
        {staff && (
          <div className="grid grid-cols-2 gap-2">
            <Select value={opts.user_id} onChange={(e) => setOpts({ ...opts, user_id: e.target.value })}>
              <option value="">Walk-in / no member</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.rank ? `${c.rank} ` : ''}{c.name} ({c.service_no}){c.role === 'guest' ? ' [Guest]' : ''}</option>)}
            </Select>
            <Select value={opts.table_id} onChange={(e) => setOpts({ ...opts, table_id: e.target.value })}>
              <option value="">No table</option>
              {tables.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </div>
        )}
        {(staff || user?.role === 'member') && mode !== 'qr' && (
          <div className="flex gap-2">
            <Select value={opts.type} onChange={(e) => setOpts({ ...opts, type: e.target.value })} className="!w-40">
              <option value="ondemand">On-demand</option>
              <option value="prebooked">Pre-book</option>
            </Select>
            {opts.type === 'prebooked' && <Input type="datetime-local" value={opts.scheduled_at} onChange={(e) => setOpts({ ...opts, scheduled_at: e.target.value })} />}
          </div>
        )}
        <Input placeholder="Order notes (e.g. on the rocks)" value={opts.notes} onChange={(e) => setOpts({ ...opts, notes: e.target.value })} />
        <div className="flex items-center justify-between py-1 text-xl font-extrabold text-[#1B2559] dark:text-[#E6EDF3]">
          <span>Total</span>
          <span className="text-[#422AFB] dark:text-[#818CF8]">{money(total)}</span>
        </div>
        <div className="flex gap-2">
          {staff && <Button variant="ghost" disabled={!cart.length || busy} onClick={() => submit('draft')}>Draft</Button>}
          <Button size="lg" className="flex-1" disabled={!cart.length || busy} onClick={() => submit('placed')}>{busy ? 'Placing…' : 'Place Order'}</Button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 gap-4 p-2">
      <section className="flex min-w-0 flex-1 flex-col">
        {/* Live Alcohol Order Limit Bar for Guests & Limited Members */}
        {!staff && user?.alcohol_usage && user.alcohol_usage.limit > 0 && (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[#422AFB]/20 bg-[#422AFB]/10 px-4 py-2 text-xs font-bold text-[#1B2559] dark:border-[#818CF8]/25 dark:bg-[#6366F1]/15 dark:text-[#E6EDF3]">
            <span>
              🥃 Alcohol Order Limit: <b>{user.alcohol_usage.limit}</b> {user.alcohol_usage.unit === 'small_eq' ? 'Small (30 ml) equivalents' : 'Small/Large pegs'} {user.alcohol_usage.scope === 'order' ? 'per order' : 'per day'}
            </span>
            {user.alcohol_usage.scope === 'day' && (
              <span className={user.alcohol_usage.remaining === 0 ? 'text-[#EE5D50]' : 'text-[#10B981]'}>
                Used today: {user.alcohol_usage.used} · Remaining: {user.alcohol_usage.remaining}
              </span>
            )}
          </div>
        )}
        {/* Search & Pill Category Bar */}
        <div className="mb-3 space-y-3">
          <Input placeholder="🔍  Search drinks, brands or snacks…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="no-scrollbar flex gap-2.5 overflow-x-auto pb-1">
            {[{ id: null, name: 'All' }, ...categories].map((c: any) => (
              <button
                key={String(c.id)}
                onClick={() => setCat(c.id)}
                className={cx(
                  'whitespace-nowrap rounded-full px-5 py-2 text-sm font-bold transition-all',
                  cat === c.id
                    ? 'bg-[#422AFB] text-white shadow-[0_6px_16px_rgba(99,102,241,0.28)] dark:bg-[#6366F1]'
                    : 'bg-white text-[#1B2559] hover:bg-[#E9EDF7] dark:border dark:border-[#2A3346] dark:bg-[#1C2230] dark:text-[#94A3B8] dark:hover:text-[#E6EDF3]',
                )}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>

        {/* Product Cards Grid */}
        <div className="grid flex-1 auto-rows-max grid-cols-2 gap-3.5 overflow-auto pb-4 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {shown.map((p) => (
            <div
              key={p.id}
              onClick={() => tap(p)}
              role="button"
              className={cx(
                'horizon-shadow group relative cursor-pointer overflow-hidden rounded-[20px] border border-transparent bg-white p-3 text-left transition-all duration-150 hover:-translate-y-0.5 active:scale-[.98] dark:border-[#2A3346] dark:bg-[#1C2230]',
                isOut(p) && 'opacity-50',
              )}
            >
              <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-[#F4F7FE] dark:bg-[#252D3D]">
                {p.image ? <img src={p.image} alt={p.name} loading="lazy" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" /> : <div className="flex h-full items-center justify-center text-4xl">🍹</div>}
                {staff && (
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleFav(p); }}
                    className="absolute right-2.5 top-2.5 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-base text-[#422AFB] shadow-sm dark:bg-[#1C2230]/90 dark:text-[#818CF8]"
                  >
                    {p.favourite ? '★' : '☆'}
                  </button>
                )}
              </div>
              <div className="mt-3 px-0.5">
                <div className="truncate text-sm font-extrabold text-[#1B2559] dark:text-[#E6EDF3]">{p.name}</div>
                <div className="mt-0.5 truncate text-xs font-medium text-[#94A3B8]">
                  {p.is_peg ? `Small (30 ml) ${money(p.peg_price)} · Large (60 ml) ${money(p.peg_price * 2)}` : p.description || p.category}
                </div>
                <div className="mt-2.5 flex items-center justify-between">
                  <span className="text-sm font-extrabold text-[#422AFB] dark:text-[#818CF8]">
                    {p.is_peg && !staff ? `${money(p.peg_price)} / 30ml` : money(p.selling_price)}
                  </span>
                  {p.stock_status ? <StockDot s={p.stock_status} label={`${p.stock_display}`} /> : isOut(p) && <span className="text-xs font-bold text-[#F87171]">Out</span>}
                </div>
              </div>
            </div>
          ))}
          {shown.length === 0 && <div className="col-span-full py-10 text-center text-sm font-medium text-[#94A3B8]">No products found</div>}
        </div>
      </section>

      {/* Desktop Cart Sidebar Card */}
      <aside className="horizon-shadow hidden w-[380px] shrink-0 overflow-hidden rounded-[20px] border border-transparent bg-white dark:border-[#2A3346] dark:bg-[#1C2230] lg:block">
        {cartPanel}
      </aside>

      {/* Floating Cart Pill on Mobile & Tablet */}
      <button
        onClick={() => setShowCart(true)}
        className="horizon-gradient fixed bottom-20 right-4 z-30 rounded-full px-6 py-3.5 text-sm font-extrabold text-white shadow-xl lg:hidden"
      >
        🛒 {count} · {money(total)}
      </button>

      {showCart && (
        <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-xs lg:hidden" onClick={() => setShowCart(false)}>
          <div className="absolute bottom-0 right-0 top-0 w-full max-w-md bg-white dark:bg-[#1C2230]" onClick={(e) => e.stopPropagation()}>
            <button className="absolute right-4 top-3.5 text-2xl text-[#94A3B8]" onClick={() => setShowCart(false)}>×</button>
            {cartPanel}
          </div>
        </div>
      )}

      <Modal open={!!picker} onClose={() => setPicker(null)} title={picker?.name || ''}>
        {picker && <ServePicker p={picker} canIssueBottle={staff} onPick={(s, ml) => add(picker, s, ml)} money={money} />}
      </Modal>
    </div>
  );
}

function ServePicker({ p, canIssueBottle, onPick, money }: { p: Product; canIssueBottle: boolean; onPick: (s: Line['serve_type'], ml?: number) => void; money: (n: number) => string }) {
  return (
    <div className="space-y-3">
      <div className={cx('grid gap-3', canIssueBottle ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-2')}>
        <Button variant="subtle" size="lg" className="flex-col !gap-1 !py-5" onClick={() => onPick('peg', 30)}>
          <span className="text-base font-extrabold">Small</span>
          <span className="text-xs font-semibold text-[#94A3B8]">30 ml</span>
          <span className="text-sm font-extrabold text-[#422AFB] dark:text-[#818CF8]">{money(p.peg_price)}</span>
        </Button>
        <Button variant="subtle" size="lg" className="flex-col !gap-1 !py-5" onClick={() => onPick('peg', 60)}>
          <span className="text-base font-extrabold">Large</span>
          <span className="text-xs font-semibold text-[#94A3B8]">60 ml</span>
          <span className="text-sm font-extrabold text-[#422AFB] dark:text-[#818CF8]">{money(Math.round(p.peg_price * 2 * 100) / 100)}</span>
        </Button>
        {canIssueBottle && (
          <Button size="lg" className="flex-col !gap-1 !py-5" onClick={() => onPick('bottle')}>
            <span className="text-base font-extrabold">Full Bottle</span>
            <span className="text-xs opacity-80">{p.size_ml || 750} ml</span>
            <span className="text-sm font-extrabold">{money(p.selling_price)}</span>
          </Button>
        )}
      </div>
      {!canIssueBottle && (
        <p className="text-center text-xs text-[#94A3B8]">Full bottles ({p.size_ml || 750} ml) can only be issued by the Bartender or Admin.</p>
      )}
    </div>
  );
}

export { Textarea };
