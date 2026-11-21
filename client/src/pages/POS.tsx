import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, placeOrder } from '../lib/api';
import { useApp, isStaffRole } from '../lib/app';
import { Button, Field, Input, Modal, Select, StockDot, Textarea, cx } from '../components/ui';

export interface Product {
  id: number; name: string; category: string; category_id: number; sub_category?: string | null; brand?: string; description?: string; image?: string; size_ml: number; unit: string;
  is_peg: boolean; is_recipe?: boolean; party_only?: boolean; is_local_purchase?: boolean; local_margin_pct?: number;
  food_type?: 'veg' | 'nonveg' | null; selling_price: number; peg_price: number; favourite: boolean; available?: boolean; stock_status?: string; stock_display?: number; stock_unit?: string;
  full_bottles?: number; loose_pegs_30ml?: number;
}

const ALCOHOL_SUB_ORDER = ['Whisky', 'Rum', 'Vodka', 'Gin', 'Brandy', 'Wine', 'Beer'];
const SOFT_SUB_ORDER = ['Juices', 'Soda', 'Water'];
const FOOD_SUB_ORDER = ['Packed', 'Veg', 'Non-Veg'];

const VegMark = ({ type }: { type?: 'veg' | 'nonveg' | null }) =>
  type === 'veg' ? (
    <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-xs border-2 border-emerald-600 bg-white" title="Veg">
      <span className="h-2 w-2 rounded-full bg-emerald-600" />
    </span>
  ) : type === 'nonveg' ? (
    <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-xs border-2 border-red-600 bg-white" title="Non-Veg">
      <span className="h-2 w-2 rounded-full bg-red-600" />
    </span>
  ) : null;
interface Line {
  key: string; product_id: number; name: string; image?: string; serve_type: 'bottle' | 'peg' | 'unit'; peg_ml?: number;
  qty: number; unit_price: number; custom_price?: boolean; party_only?: boolean; is_local_purchase?: boolean; purchase_cost?: number; margin_pct?: number;
}

const lineKey = (pid: number, serve: string, ml?: number, purchaseCost?: number) =>
  purchaseCost != null ? `${pid}-local-${purchaseCost}` : `${pid}-${serve}-${ml || ''}`;

export default function POS({ mode, tableCode, preload, onPlaced, readOnly = false }: { mode: 'staff' | 'self' | 'qr'; tableCode?: string; preload?: { products: Product[]; categories: any[] }; onPlaced?: () => void; readOnly?: boolean }) {
  const { user, money, toast, reloadUser } = useApp();
  const staff = mode === 'staff' || (mode !== 'self' && isStaffRole(user?.role));
  const [products, setProducts] = useState<Product[]>(preload?.products || []);
  const [categories, setCategories] = useState<any[]>(preload?.categories || []);
  const [cat, setCat] = useState<number | 'fav'>('fav');
  const [subCat, setSubCat] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<Line[]>(() => JSON.parse(localStorage.getItem(`cart-${mode}`) || '[]'));
  const [picker, setPicker] = useState<Product | null>(null);
  const [localModal, setLocalModal] = useState<{ p: Product; qty: string; cost: string } | null>(null);
  const [isParty, setIsParty] = useState(false);
  const [customers, setCustomers] = useState<any[]>([]);
  const [tables, setTables] = useState<any[]>([]);
  const [opts, setOpts] = useState({ user_id: '', table_id: '', notes: '', type: 'ondemand', scheduled_at: '' });
  const [busy, setBusy] = useState(false);
  const [showCart, setShowCart] = useState(false);
  const [showQuickMenu, setShowQuickMenu] = useState(false);

  const togglePartyMode = (next: boolean) => {
    setIsParty(next);
    if (!next) {
      setCart((prev) => {
        const removed = prev.filter((l) => l.party_only);
        if (removed.length) toast(`Removed ${removed.length} Party-Only item(s) for Regular Order`);
        return prev.filter((l) => !l.party_only);
      });
    }
  };

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

  const activeCatObj = typeof cat === 'number' ? categories.find((c) => c.id === cat) : null;
  const activeCatName = (activeCatObj?.name || '').toLowerCase();
  const isAlcoholCat = activeCatName === 'alcohol';
  const isFoodCat = activeCatName === 'food' || /kitchen/i.test(activeCatName);
  const isSoftDrinksCat = /soft\s*drink/i.test(activeCatName);

  const resolveFoodSub = (p: Product) => {
    if (p.sub_category && FOOD_SUB_ORDER.includes(p.sub_category)) return p.sub_category;
    if (p.food_type === 'nonveg') return 'Non-Veg';
    if (p.food_type === 'veg') return 'Veg';
    return 'Packed';
  };

  // Hide Party-Use-Only variants (750 ml Coke/Sprite) during regular individual ordering
  const visibleProducts = useMemo(
    () => products.filter((p) => (!p.party_only || (staff && isParty)) && (!p.is_local_purchase || staff)),
    [products, staff, isParty],
  );

  // Dynamic Alcohol sub-categories present in inventory (ordered cleanly)
  const alcoholSubs = useMemo(() => {
    if (!isAlcoholCat) return [];
    const set = new Set<string>();
    visibleProducts.filter((p) => p.category_id === cat).forEach((p) => { if (p.sub_category) set.add(p.sub_category); });
    return [
      ...ALCOHOL_SUB_ORDER.filter((s) => set.has(s)),
      ...[...set].filter((s) => !ALCOHOL_SUB_ORDER.includes(s)).sort(),
    ];
  }, [visibleProducts, cat, isAlcoholCat]);

  const shown = useMemo(() => {
    const s = search.trim().toLowerCase();
    return visibleProducts.filter((p) => {
      if (s) {
        return `${p.name} ${p.brand || ''} ${p.category || ''} ${p.sub_category || ''}`.toLowerCase().includes(s);
      }
      if (cat === 'fav') return !!p.favourite;
      if (p.category_id !== cat) return false;
      if (isAlcoholCat && subCat !== 'all') {
        if ((p.sub_category || '') !== subCat) return false;
      }
      if (isSoftDrinksCat && subCat !== 'all') {
        if ((p.sub_category || '') !== subCat) return false;
      }
      if (isFoodCat && subCat !== 'all') {
        if (resolveFoodSub(p) !== subCat) return false;
      }
      return true;
    });
  }, [visibleProducts, cat, subCat, isAlcoholCat, isSoftDrinksCat, isFoodCat, search]);

  const add = (p: Product, serve: Line['serve_type'], peg_ml?: number) => {
    const unit_price = serve === 'peg' ? Math.round((p.peg_price * (peg_ml || 30)) / 30 * 100) / 100 : p.selling_price;
    const key = lineKey(p.id, serve, peg_ml);
    setCart((c) => (c.find((l) => l.key === key) ? c.map((l) => (l.key === key ? { ...l, qty: l.qty + 1 } : l)) : [...c, { key, product_id: p.id, name: p.name, image: p.image, serve_type: serve, peg_ml, qty: 1, unit_price, party_only: !!p.party_only }]));
    setPicker(null);
  };
  const addLocalMisc = (e: React.FormEvent) => {
    e.preventDefault();
    if (!localModal) return;
    const p = localModal.p;
    const qty = Math.floor(Number(localModal.qty));
    const cost = Math.round(Number(localModal.cost) * 100) / 100;
    if (!(qty > 0)) return toast('Enter a valid whole quantity', 'error');
    if (!(cost > 0)) return toast('Enter the purchase cost (₹)', 'error');
    const margin = Number(p.local_margin_pct ?? 10);
    const unit_price = Math.round(cost * (1 + margin / 100) * 100) / 100;
    const key = lineKey(p.id, 'unit', undefined, cost);
    setCart((c) => (
      c.find((l) => l.key === key)
        ? c.map((l) => (l.key === key ? { ...l, qty: l.qty + qty } : l))
        : [...c, { key, product_id: p.id, name: p.name, image: p.image, serve_type: 'unit', qty, unit_price, is_local_purchase: true, purchase_cost: cost, margin_pct: margin }]
    ));
    setLocalModal(null);
  };
  const isOut = (p: Product) => !p.is_local_purchase && (p.stock_status === 'out' || p.available === false);
  const tap = (p: Product) => {
    if (readOnly) return;
    if (p.is_local_purchase) {
      if (!staff) return toast('Locally purchased items are ordered by the bartender', 'error');
      setLocalModal({ p, qty: '1', cost: '' });
      return;
    }
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
        items: cart.map((l) => ({
          product_id: l.product_id,
          serve_type: l.serve_type,
          peg_ml: l.peg_ml,
          qty: l.qty,
          ...(l.is_local_purchase ? { purchase_cost: l.purchase_cost } : (staff && l.custom_price ? { unit_price: l.unit_price } : {})),
        })),
        notes: opts.notes || undefined,
        type: opts.type,
        is_party: staff && isParty,
        scheduled_at: opts.type === 'prebooked' ? new Date(opts.scheduled_at).toISOString() : undefined,
        status,
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

  const renderCartPanel = (onClose?: () => void) => (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[#E9EDF7] p-4 dark:border-[#2A3346]">
        <h2 className="text-lg font-extrabold text-[#1B2559] dark:text-[#E6EDF3]">
          Current Order <span className="text-sm font-semibold text-[#94A3B8]">({count})</span>
        </h2>
        <div className="flex items-center gap-2.5">
          {cart.length > 0 && <button type="button" className="text-xs font-bold text-[#F87171]" onClick={() => setCart([])}>Clear All</button>}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close cart"
              className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#F4F7FE] text-xl leading-none text-[#1B2559] dark:bg-[#252D3D] dark:text-[#E6EDF3]"
            >
              ×
            </button>
          )}
        </div>
      </div>
      <div
        className="min-h-0 flex-1 space-y-2.5 overflow-y-auto overscroll-contain p-3.5"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {cart.length === 0 && <div className="py-16 text-center text-sm font-medium text-[#94A3B8]">Tap a product card to add it</div>}
        {cart.map((l) => (
          <div key={l.key} className="flex items-center gap-2.5 rounded-2xl bg-[#F4F7FE] p-3 dark:bg-[#252D3D]">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-bold text-[#1B2559] dark:text-[#E6EDF3]">{l.name}</div>
              <div className="mt-0.5 flex flex-wrap items-center gap-1 text-xs font-medium text-[#94A3B8]">
                {l.is_local_purchase ? (
                  <>
                    <span className="rounded bg-[#422AFB]/12 px-1.5 py-0.5 text-[10px] font-bold text-[#422AFB] dark:bg-[#6366F1]/20 dark:text-[#A5B4FC]">
                      Cost {money(l.purchase_cost || 0)}
                    </span>
                    <span>→</span>
                    <span className="font-bold text-emerald-600 dark:text-emerald-400">
                      {money(l.unit_price)} (+{l.margin_pct ?? 10}%)
                    </span>
                  </>
                ) : (
                  <>
                    {l.serve_type === 'peg'
                      ? l.peg_ml === 30
                        ? 'Small (30 ml)'
                        : l.peg_ml === 60
                          ? 'Large (60 ml)'
                          : `Peg ${l.peg_ml} ml`
                      : l.serve_type === 'bottle'
                        ? 'Full Bottle (750 ml)'
                        : l.party_only
                          ? '🎉 Party 750 ml'
                          : 'Unit'} ·
                    {staff ? (
                      <input type="number" className="w-20 rounded-lg border border-[#E0E5F2] bg-white px-1.5 py-0.5 text-xs font-bold text-[#1B2559] dark:border-[#2E384D] dark:bg-[#151A25] dark:text-[#E6EDF3]" value={l.unit_price}
                        onChange={(e) => setCart((c) => c.map((x) => (x.key === l.key ? { ...x, unit_price: Number(e.target.value), custom_price: true } : x)))} />
                    ) : money(l.unit_price)}
                  </>
                )}
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
      <div className="shrink-0 space-y-2.5 border-t border-[#E9EDF7] p-4 pb-[max(2.25rem,calc(env(safe-area-inset-bottom)+1.5rem))] dark:border-[#2A3346] lg:pb-4">
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
        {(staff || user?.role === 'member') && (
          <div className="space-y-2">
            <Select value={opts.type} onChange={(e) => setOpts({ ...opts, type: e.target.value })}>
              <option value="ondemand">Order Now</option>
              <option value="prebooked">Pre-Order (Schedule Date & Time)</option>
            </Select>
            {opts.type === 'prebooked' && (
              <Input
                type="datetime-local"
                value={opts.scheduled_at}
                onChange={(e) => setOpts({ ...opts, scheduled_at: e.target.value })}
                aria-label="Pre-Order date and time"
              />
            )}
          </div>
        )}
        <Input placeholder="Order notes (e.g. on the rocks)" value={opts.notes} onChange={(e) => setOpts({ ...opts, notes: e.target.value })} />
        <div className="flex items-center justify-between py-1 text-xl font-extrabold text-[#1B2559] dark:text-[#E6EDF3]">
          <span>Total</span>
          <span className="text-[#422AFB] dark:text-[#818CF8]">{money(total)}</span>
        </div>
        <div className="flex gap-2">
          {staff && <Button variant="ghost" disabled={!cart.length || busy} onClick={() => submit('draft')}>Draft</Button>}
          {!staff && user && (
            <Button
              variant="subtle"
              disabled={!cart.length || busy}
              title="Save these items as a repeat Favorite Order"
              onClick={async () => {
                const favName = prompt('Name this Favorite Order (e.g. Evening Usual):');
                if (!favName?.trim()) return;
                try {
                  await api('/orders/favorites', {
                    method: 'POST',
                    body: {
                      name: favName.trim(),
                      notes: opts.notes || undefined,
                      items: cart.map((l) => ({ product_id: l.product_id, serve_type: l.serve_type, peg_ml: l.peg_ml, qty: l.qty })),
                    },
                  });
                  toast(`♥ Saved "${favName.trim()}" to Favorite Orders!`);
                } catch (e: any) { toast(e.message, 'error'); }
              }}
            >
              ♥ Save Fav
            </Button>
          )}
          <Button size="lg" className="flex-1" disabled={!cart.length || busy} onClick={() => submit('placed')}>{busy ? 'Placing…' : 'Place Order'}</Button>
        </div>
      </div>
    </div>
  );

  const jumpToCategory = (nextCat: number | 'fav', nextSub = 'all') => {
    setCat(nextCat);
    setSubCat(nextSub);
    setSearch('');
    setShowQuickMenu(false);
    document.querySelector('main')?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const fabBottom = mode === 'qr' ? 'bottom-[max(1.25rem,calc(env(safe-area-inset-bottom)+0.75rem))]' : 'bottom-[calc(4.9rem+env(safe-area-inset-bottom))]';

  return (
    <div className="flex flex-col gap-3 p-1.5 sm:p-2 lg:h-full lg:min-h-0 lg:flex-row lg:gap-4">
      <section className="flex min-w-0 flex-1 flex-col lg:min-h-0">
        {/* Live Alcohol Order Limit Bar for Guests & Limited Members */}
        {!staff && user?.alcohol_usage && user.alcohol_usage.limit > 0 && (
          <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[#422AFB]/20 bg-[#422AFB]/10 px-3.5 py-2 text-xs font-bold text-[#1B2559] dark:border-[#818CF8]/25 dark:bg-[#6366F1]/15 dark:text-[#E6EDF3]">
            <span>
              🥃 Limit: <b>{user.alcohol_usage.limit}</b> {user.alcohol_usage.unit === 'small_eq' ? 'Small (30 ml) eq' : 'pegs'} / {user.alcohol_usage.scope}
            </span>
            {user.alcohol_usage.scope === 'day' && (
              <span className={user.alcohol_usage.remaining === 0 ? 'text-[#EE5D50]' : 'text-[#10B981]'}>
                Used: {user.alcohol_usage.used} · Left: {user.alcohol_usage.remaining}
              </span>
            )}
          </div>
        )}

        {/* Search, Staff Party Order Toggle & Category Controls */}
        <div className="mb-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Input placeholder="🔍 Search whisky, rum, coke, mocktails, snacks…" value={search} onChange={(e) => setSearch(e.target.value)} className="min-w-0 flex-1" />
            {staff && !readOnly && (
              <div className="inline-flex shrink-0 rounded-2xl border border-[#E0E5F2] bg-white p-1 dark:border-[#2E384D] dark:bg-[#1C2230]">
                <button
                  type="button"
                  onClick={() => togglePartyMode(false)}
                  className={cx(
                    'rounded-xl px-3 py-1.5 text-xs font-extrabold transition',
                    !isParty ? 'bg-[#422AFB] text-white shadow-xs dark:bg-[#6366F1]' : 'text-[#707EAE] dark:text-[#94A3B8]',
                  )}
                >
                  Regular
                </button>
                <button
                  type="button"
                  onClick={() => togglePartyMode(true)}
                  className={cx(
                    'rounded-xl px-3 py-1.5 text-xs font-extrabold transition',
                    isParty ? 'bg-[#D97706] text-white shadow-xs' : 'text-[#707EAE] dark:text-[#94A3B8]',
                  )}
                >
                  🎉 Party Order
                </button>
              </div>
            )}
          </div>
          {staff && isParty && (
            <div className="rounded-xl border border-[#FBBF24]/40 bg-[#FBBF24]/15 px-3 py-1.5 text-xs font-bold text-[#92400E] dark:text-[#FCD34D]">
              🎉 Party Order Mode active — 750 ml Party Use Only Coke &amp; Sprite bottles are now unlocked for selection.
            </div>
          )}

          {/* MOBILE ONLY (< md): Favorites Button + Category Dropdown + Sub-Category Dropdown (ZERO horizontal scroll!) */}
          <div className="space-y-2 md:hidden">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => jumpToCategory('fav')}
                className={cx(
                  'shrink-0 whitespace-nowrap rounded-2xl px-3.5 py-2.5 text-sm font-extrabold transition-all',
                  cat === 'fav' && !search.trim()
                    ? 'bg-[#422AFB] text-white shadow-[0_6px_16px_rgba(99,102,241,0.28)] dark:bg-[#6366F1]'
                    : 'border border-[#E0E5F2] bg-white text-[#1B2559] dark:border-[#2E384D] dark:bg-[#1C2230] dark:text-[#E6EDF3]',
                )}
              >
                ⭐ Favorites
              </button>
              <Select
                value={typeof cat === 'number' ? String(cat) : ''}
                onChange={(e) => {
                  const v = e.target.value;
                  if (!v) jumpToCategory('fav');
                  else jumpToCategory(Number(v), 'all');
                }}
                aria-label="Select product category"
                className="min-w-0 flex-1 !font-bold"
              >
                <option value="">All Categories…</option>
                {categories.map((c: any) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.name} ({visibleProducts.filter((p) => p.category_id === c.id).length})
                  </option>
                ))}
              </Select>
            </div>

            {!search.trim() && isAlcoholCat && alcoholSubs.length > 0 && (
              <Select
                value={subCat}
                onChange={(e) => setSubCat(e.target.value)}
                aria-label="Select alcohol type"
                className="!min-h-10 !py-2 !font-semibold"
              >
                <option value="all">All Alcohol ({products.filter((p) => p.category_id === cat).length})</option>
                {alcoholSubs.map((sc) => (
                  <option key={sc} value={sc}>
                    {sc} ({products.filter((p) => p.category_id === cat && p.sub_category === sc).length})
                  </option>
                ))}
              </Select>
            )}

            {!search.trim() && isSoftDrinksCat && (
              <Select
                value={subCat}
                onChange={(e) => setSubCat(e.target.value)}
                aria-label="Select soft drink type"
                className="!min-h-10 !py-2 !font-semibold"
              >
                <option value="all">All Soft Drinks ({products.filter((p) => p.category_id === cat).length})</option>
                {SOFT_SUB_ORDER.map((sc) => (
                  <option key={sc} value={sc}>
                    {sc} ({products.filter((p) => p.category_id === cat && p.sub_category === sc).length})
                  </option>
                ))}
              </Select>
            )}

            {!search.trim() && isFoodCat && !isSoftDrinksCat && (
              <Select
                value={subCat}
                onChange={(e) => setSubCat(e.target.value)}
                aria-label="Select food type"
                className="!min-h-10 !py-2 !font-semibold"
              >
                <option value="all">All Food ({products.filter((p) => p.category_id === cat).length})</option>
                <option value="Packed">📦 Packed ({products.filter((p) => p.category_id === cat && resolveFoodSub(p) === 'Packed').length})</option>
                <option value="Veg">🟢 Veg ({products.filter((p) => p.category_id === cat && resolveFoodSub(p) === 'Veg').length})</option>
                <option value="Non-Veg">🔴 Non-Veg ({products.filter((p) => p.category_id === cat && resolveFoodSub(p) === 'Non-Veg').length})</option>
              </Select>
            )}
          </div>

          {/* TABLET & WEB ONLY (md+): Full Horizontal Category & Sub-Category Pill Bars */}
          <div className="hidden space-y-2.5 md:block">
            <div className="no-scrollbar flex flex-wrap gap-2 pb-0.5">
              {[{ id: 'fav' as const, name: '⭐ Favorites' }, ...categories].map((c: any) => (
                <button
                  key={String(c.id)}
                  onClick={() => { setCat(c.id); setSubCat('all'); setSearch(''); }}
                  className={cx(
                    'whitespace-nowrap rounded-full px-5 py-2 text-sm font-bold transition-all',
                    cat === c.id && !search.trim()
                      ? 'bg-[#422AFB] text-white shadow-[0_6px_16px_rgba(99,102,241,0.28)] dark:bg-[#6366F1]'
                      : 'bg-white text-[#1B2559] hover:bg-[#E9EDF7] dark:border dark:border-[#2A3346] dark:bg-[#1C2230] dark:text-[#94A3B8] dark:hover:text-[#E6EDF3]',
                  )}
                >
                  {c.name}
                </button>
              ))}
            </div>

            {/* Alcohol Sub-Categories (Whisky, Rum, Vodka, Gin, Brandy, Wine, Beer) */}
            {!search.trim() && isAlcoholCat && alcoholSubs.length > 0 && (
              <div className="no-scrollbar flex flex-wrap items-center gap-2">
                <button
                  onClick={() => setSubCat('all')}
                  className={cx(
                    'rounded-full px-4 py-1.5 text-xs font-bold transition',
                    subCat === 'all'
                      ? 'bg-[#1B2559] text-white dark:bg-[#E6EDF3] dark:text-[#131722]'
                      : 'bg-white text-[#1B2559] hover:bg-[#E9EDF7] dark:border dark:border-[#2A3346] dark:bg-[#1C2230] dark:text-[#94A3B8]',
                  )}
                >
                  All Alcohol ({products.filter((p) => p.category_id === cat).length})
                </button>
                {alcoholSubs.map((sc) => {
                  const cnt = products.filter((p) => p.category_id === cat && p.sub_category === sc).length;
                  return (
                    <button
                      key={sc}
                      onClick={() => setSubCat(sc)}
                      className={cx(
                        'rounded-full px-4 py-1.5 text-xs font-bold transition',
                        subCat === sc
                          ? 'bg-[#D97706] text-white shadow-sm'
                          : 'bg-white text-[#1B2559] hover:bg-[#E9EDF7] dark:border dark:border-[#2A3346] dark:bg-[#1C2230] dark:text-[#94A3B8]',
                      )}
                    >
                      {sc} ({cnt})
                    </button>
                  );
                })}
              </div>
            )}

            {/* Soft Drinks Sub-Categories (Juices, Soda, Water) */}
            {!search.trim() && isSoftDrinksCat && (
              <div className="no-scrollbar flex flex-wrap items-center gap-2">
                <button
                  onClick={() => setSubCat('all')}
                  className={cx(
                    'rounded-full px-4 py-1.5 text-xs font-bold transition',
                    subCat === 'all'
                      ? 'bg-[#1B2559] text-white dark:bg-[#E6EDF3] dark:text-[#131722]'
                      : 'bg-white text-[#1B2559] hover:bg-[#E9EDF7] dark:border dark:border-[#2A3346] dark:bg-[#1C2230] dark:text-[#94A3B8]',
                  )}
                >
                  All Soft Drinks ({products.filter((p) => p.category_id === cat).length})
                </button>
                {SOFT_SUB_ORDER.map((sc) => {
                  const cnt = products.filter((p) => p.category_id === cat && p.sub_category === sc).length;
                  return (
                    <button
                      key={sc}
                      onClick={() => setSubCat(sc)}
                      className={cx(
                        'rounded-full px-4 py-1.5 text-xs font-bold transition',
                        subCat === sc
                          ? 'bg-[#0EA5E9] text-white shadow-sm'
                          : 'bg-white text-[#1B2559] hover:bg-[#E9EDF7] dark:border dark:border-[#2A3346] dark:bg-[#1C2230] dark:text-[#94A3B8]',
                      )}
                    >
                      {sc} ({cnt})
                    </button>
                  );
                })}
              </div>
            )}

            {/* Food Sub-Categories (Packed, Veg, Non-Veg) */}
            {!search.trim() && isFoodCat && !isSoftDrinksCat && (
              <div className="flex flex-wrap items-center gap-2">
                {([['all', 'All Food'], ['Packed', '📦 Packed'], ['Veg', 'Veg'], ['Non-Veg', 'Non-Veg']] as const).map(([k, label]) => (
                  <button
                    key={k}
                    onClick={() => setSubCat(k)}
                    className={cx(
                      'inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-bold transition',
                      subCat === k
                        ? k === 'Veg'
                          ? 'bg-emerald-600 text-white shadow-sm'
                          : k === 'Non-Veg'
                            ? 'bg-red-600 text-white shadow-sm'
                            : k === 'Packed'
                              ? 'bg-[#D97706] text-white shadow-sm'
                              : 'bg-[#1B2559] text-white dark:bg-[#E6EDF3] dark:text-[#131722]'
                        : 'bg-white text-[#1B2559] hover:bg-[#E9EDF7] dark:border dark:border-[#2A3346] dark:bg-[#1C2230] dark:text-[#94A3B8]',
                    )}
                  >
                    {k === 'Veg' && <VegMark type="veg" />}
                    {k === 'Non-Veg' && <VegMark type="nonveg" />}
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Product Cards Grid (single scroll on mobile, inner scroll on lg+ desktop) */}
        <div className="pb-28 lg:min-h-0 lg:flex-1 lg:overflow-auto lg:pb-4">
          {(() => {
            const renderCard = (p: Product) => {
              const ft = p.sub_category === 'Non-Veg' || p.food_type === 'nonveg'
                ? 'nonveg'
                : p.sub_category === 'Veg' || p.food_type === 'veg'
                  ? 'veg'
                  : null;
              const stockTitle = p.is_peg && p.full_bottles != null
                ? `${p.full_bottles} full btl + ${p.loose_pegs_30ml ?? 0} loose 30ml pegs`
                : undefined;
              return (
                <div
                  key={p.id}
                  onClick={readOnly ? undefined : () => tap(p)}
                  role={readOnly ? undefined : 'button'}
                  title={stockTitle}
                  className={cx(
                    'horizon-shadow group relative min-w-0 overflow-hidden rounded-[18px] border border-transparent bg-white p-2.5 text-left transition-all duration-150 dark:border-[#2A3346] dark:bg-[#1C2230] sm:rounded-[20px] sm:p-3',
                    !readOnly && 'cursor-pointer hover:-translate-y-0.5 active:scale-[.98]',
                    isOut(p) && 'opacity-50',
                  )}
                >
                  <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-[#F4F7FE] dark:bg-[#252D3D]">
                    {p.image ? <img src={p.image} alt={p.name} loading="lazy" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" /> : <div className="flex h-full items-center justify-center text-4xl">🍹</div>}
                    <div className="absolute left-2.5 top-2.5 flex flex-wrap items-center gap-1">
                      {ft && <span className="shadow-sm"><VegMark type={ft} /></span>}
                      {p.party_only && (
                        <span className="rounded-full bg-[#D97706] px-2 py-0.5 text-[10px] font-extrabold text-white shadow-xs">
                          🎉 Party Only
                        </span>
                      )}
                      {p.is_local_purchase && (
                        <span className="rounded-full bg-[#422AFB] px-2 py-0.5 text-[10px] font-extrabold text-white shadow-xs">
                          Local Purchase
                        </span>
                      )}
                      {p.sub_category && !ft && !p.party_only && !p.is_local_purchase && (
                        <span className="rounded-full bg-black/65 px-2 py-0.5 text-[10px] font-bold text-white backdrop-blur-xs">
                          {p.sub_category}
                        </span>
                      )}
                    </div>
                    {staff && (
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleFav(p); }}
                        className="absolute right-2.5 top-2.5 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-base text-[#422AFB] shadow-sm dark:bg-[#1C2230]/90 dark:text-[#818CF8]"
                      >
                        {p.favourite ? '★' : '☆'}
                      </button>
                    )}
                  </div>
                  <div className="mt-2.5 px-0.5">
                    <div className="line-clamp-2 min-h-[2rem] text-xs font-extrabold leading-snug text-[#1B2559] dark:text-[#E6EDF3]" title={p.name}>
                      {p.name}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] font-medium text-[#94A3B8]">
                      {p.is_local_purchase
                        ? `Enter purchase cost (+${p.local_margin_pct ?? 10}%)`
                        : p.is_peg
                          ? `30 ml ${money(p.peg_price)} · 60 ml ${money(Math.round(p.peg_price * 2 * 100) / 100)}`
                          : p.description || p.category}
                    </div>
                    <div className="mt-2.5 flex items-center justify-between gap-1">
                      <div className="min-w-0">
                        {p.is_local_purchase ? (
                          <span className="inline-flex items-center rounded-lg bg-[#422AFB]/10 px-2 py-0.5 text-xs font-extrabold text-[#422AFB] dark:bg-[#6366F1]/20 dark:text-[#A5B4FC]">
                            Tap to Enter Cost
                          </span>
                        ) : (
                          <>
                            <span className="text-sm font-extrabold text-[#422AFB] dark:text-[#818CF8]">
                              {p.is_peg ? `${money(p.peg_price)} / 30ml` : money(p.selling_price)}
                            </span>
                            {p.is_peg && staff && (
                              <div className="text-[10px] font-semibold text-[#94A3B8]">Btl: {money(p.selling_price)}</div>
                            )}
                          </>
                        )}
                      </div>
                      {p.is_local_purchase ? (
                        <span className="text-[10px] font-bold text-[#10B981]">On-demand</span>
                      ) : p.stock_status ? (
                        <StockDot s={p.stock_status} label={`${p.stock_display}`} />
                      ) : isOut(p) && <span className="text-xs font-bold text-[#F87171]">Out</span>}
                    </div>
                  </div>
                </div>
              );
            };

            if (!search.trim() && isFoodCat && subCat === 'all') {
              const packedItems = shown.filter((p) => resolveFoodSub(p) === 'Packed');
              const vegItems = shown.filter((p) => resolveFoodSub(p) === 'Veg');
              const nonVegItems = shown.filter((p) => resolveFoodSub(p) === 'Non-Veg');
              return (
                <div className="space-y-5">
                  <div>
                    <div className="mb-2.5 flex items-center gap-2 px-1 text-sm font-extrabold text-[#D97706] dark:text-[#FBBF24]">
                      <span>📦 Packed ({packedItems.length})</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3.5 xl:grid-cols-4 2xl:grid-cols-5">
                      {packedItems.map(renderCard)}
                      {packedItems.length === 0 && <div className="col-span-full py-2 text-xs text-[#94A3B8]">No Packed items found</div>}
                    </div>
                  </div>
                  <div>
                    <div className="mb-2.5 flex items-center gap-2 px-1 text-sm font-extrabold text-emerald-600 dark:text-emerald-400">
                      <VegMark type="veg" /> <span>Veg ({vegItems.length})</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3.5 xl:grid-cols-4 2xl:grid-cols-5">
                      {vegItems.map(renderCard)}
                      {vegItems.length === 0 && <div className="col-span-full py-2 text-xs text-[#94A3B8]">No Veg items found</div>}
                    </div>
                  </div>
                  <div>
                    <div className="mb-2.5 flex items-center gap-2 px-1 text-sm font-extrabold text-red-600 dark:text-red-400">
                      <VegMark type="nonveg" /> <span>Non-Veg ({nonVegItems.length})</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3.5 xl:grid-cols-4 2xl:grid-cols-5">
                      {nonVegItems.map(renderCard)}
                      {nonVegItems.length === 0 && <div className="col-span-full py-2 text-xs text-[#94A3B8]">No Non-Veg items found</div>}
                    </div>
                  </div>
                </div>
              );
            }

            return (
              <div className="grid auto-rows-max grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3.5 xl:grid-cols-4 2xl:grid-cols-5">
                {shown.map(renderCard)}
                {shown.length === 0 && <div className="col-span-full py-10 text-center text-sm font-medium text-[#94A3B8]">No products found</div>}
              </div>
            );
          })()}
        </div>
      </section>

      {/* Desktop Cart Sidebar Card */}
      {!readOnly && (
        <aside className="horizon-shadow hidden w-[380px] shrink-0 overflow-hidden rounded-[20px] border border-transparent bg-white dark:border-[#2A3346] dark:bg-[#1C2230] lg:block">
          {renderCartPanel()}
        </aside>
      )}

      {/* Portaled Mobile/Tablet Floating Action Buttons (above bottom navbar on iOS Safari; hidden while modals/sheets are open) */}
      {!showCart && !showQuickMenu && !picker && !localModal && typeof document !== 'undefined' && createPortal(
        <>
          {/* MOBILE-ONLY Floating Quick Products / Categories Menu Button */}
          <button
            type="button"
            onClick={() => setShowQuickMenu(true)}
            className={cx(
              'no-print fixed left-3 z-40 flex items-center gap-1.5 rounded-full border border-white/15 bg-[#1B2559] px-3.5 py-3 text-xs font-extrabold text-white shadow-xl transition active:scale-95 dark:bg-[#252D3D] md:hidden',
              fabBottom,
            )}
          >
            <span>☰</span>
            <span>Quick Menu</span>
          </button>

          {/* Floating Cart / Order Now Button on Mobile & Tablet */}
          {!readOnly && (
            <button
              type="button"
              onClick={() => setShowCart(true)}
              className={cx(
                'no-print horizon-gradient fixed right-3 z-40 flex items-center gap-1.5 rounded-full px-4 py-3 text-xs font-extrabold text-white shadow-xl ring-2 ring-white/25 transition active:scale-95 sm:px-5 sm:py-3.5 sm:text-sm lg:hidden',
                fabBottom,
              )}
            >
              <span>🛒</span>
              <span>Order Now</span>
              {count > 0 && (
                <span className="rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-extrabold">
                  {count} · {money(total)}
                </span>
              )}
            </button>
          )}
        </>,
        document.body,
      )}

      {/* MOBILE-ONLY Quick Products / Categories Jump Bottom Sheet */}
      <Modal open={showQuickMenu} onClose={() => setShowQuickMenu(false)} title="Quick Products Menu">
        <div className="space-y-3.5">
          <button
            type="button"
            onClick={() => jumpToCategory('fav')}
            className={cx(
              'flex w-full items-center justify-between rounded-2xl px-4 py-3 text-sm font-extrabold transition',
              cat === 'fav'
                ? 'bg-[#422AFB] text-white dark:bg-[#6366F1]'
                : 'bg-[#F4F7FE] text-[#1B2559] dark:bg-[#252D3D] dark:text-[#E6EDF3]',
            )}
          >
            <span>⭐ Favorites</span>
            <span className="text-xs opacity-80">{visibleProducts.filter((p) => p.favourite).length} items</span>
          </button>

          {categories.map((c: any) => {
            const cname = String(c.name || '').toLowerCase();
            const catProds = visibleProducts.filter((p) => p.category_id === c.id);
            const icon = cname === 'alcohol' ? '🥃' : cname.includes('mocktail') ? '🍹' : cname.includes('soft') ? '🥤' : cname === 'food' ? '🍽' : cname === 'cigarettes' ? '🚬' : '🧊';
            let subs: string[] = [];
            if (cname === 'alcohol') {
              const sSet = new Set(catProds.map((p) => p.sub_category).filter(Boolean) as string[]);
              subs = [...ALCOHOL_SUB_ORDER.filter((x) => sSet.has(x)), ...[...sSet].filter((x) => !ALCOHOL_SUB_ORDER.includes(x))];
            } else if (cname.includes('soft')) {
              subs = SOFT_SUB_ORDER;
            } else if (cname === 'food') {
              subs = FOOD_SUB_ORDER;
            }
            return (
              <div key={c.id} className="rounded-2xl border border-[#E9EDF7] bg-[#F4F7FE]/60 p-3 dark:border-[#2A3346] dark:bg-[#252D3D]/60">
                <button
                  type="button"
                  onClick={() => jumpToCategory(c.id, 'all')}
                  className="flex w-full items-center justify-between text-left text-sm font-extrabold text-[#1B2559] dark:text-[#E6EDF3]"
                >
                  <span>{icon} {c.name}</span>
                  <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-bold text-[#422AFB] dark:bg-[#1C2230] dark:text-[#818CF8]">
                    {catProds.length}
                  </span>
                </button>
                {subs.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {subs.map((sc) => {
                      const cnt = cname === 'food'
                        ? catProds.filter((p) => resolveFoodSub(p) === sc).length
                        : catProds.filter((p) => p.sub_category === sc).length;
                      const active = cat === c.id && subCat === sc;
                      return (
                        <button
                          key={sc}
                          type="button"
                          onClick={() => jumpToCategory(c.id, sc)}
                          className={cx(
                            'rounded-full px-3 py-1.5 text-xs font-bold transition',
                            active
                              ? 'bg-[#422AFB] text-white dark:bg-[#6366F1]'
                              : 'bg-white text-[#1B2559] shadow-2xs dark:bg-[#1C2230] dark:text-[#E6EDF3]',
                          )}
                        >
                          {sc} ({cnt})
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Modal>

      {!readOnly && showCart && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[80] flex justify-end bg-black/55 backdrop-blur-xs lg:hidden" onClick={() => setShowCart(false)}>
          <div
            className="flex h-full max-h-[100dvh] w-full max-w-md flex-col bg-white pt-[max(0.5rem,env(safe-area-inset-top))] shadow-2xl dark:bg-[#1C2230]"
            onClick={(e) => e.stopPropagation()}
          >
            {renderCartPanel(() => setShowCart(false))}
          </div>
        </div>,
        document.body,
      )}

      <Modal open={!!picker} onClose={() => setPicker(null)} title={picker?.name || ''}>
        {picker && <ServePicker p={picker} canIssueBottle={staff} onPick={(s, ml) => add(picker, s, ml)} money={money} />}
      </Modal>

      <Modal open={!!localModal} onClose={() => setLocalModal(null)} title={localModal ? `Local Purchase · ${localModal.p.name}` : 'Local Purchase'}>
        {localModal && (() => {
          const margin = Number(localModal.p.local_margin_pct ?? 10);
          const qty = Math.max(0, Math.floor(Number(localModal.qty) || 0));
          const cost = Math.max(0, Number(localModal.cost) || 0);
          const unitSell = Math.round(cost * (1 + margin / 100) * 100) / 100;
          const totalCost = Math.round(cost * qty * 100) / 100;
          const totalSell = Math.round(unitSell * qty * 100) / 100;
          const profit = Math.round((totalSell - totalCost) * 100) / 100;
          return (
            <form onSubmit={addLocalMisc} className="space-y-4">
              <p className="text-xs text-[#707EAE] dark:text-[#94A3B8]">
                Locally purchased on demand (not deducted from bar inventory). Customer bill shows only product name, quantity, and final selling price.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <Field label={`Quantity (${localModal.p.unit || 'unit'})`}>
                  <Input
                    type="number"
                    min={1}
                    step={1}
                    value={localModal.qty}
                    onChange={(e) => setLocalModal({ ...localModal, qty: e.target.value })}
                    required
                  />
                </Field>
                <Field label="Purchase Cost / Unit (₹)">
                  <Input
                    type="number"
                    min={0.01}
                    step="0.01"
                    placeholder="e.g. 50"
                    value={localModal.cost}
                    onChange={(e) => setLocalModal({ ...localModal, cost: e.target.value })}
                    autoFocus
                    required
                  />
                </Field>
              </div>
              <div className="space-y-1.5 rounded-2xl bg-[#F4F7FE] p-3.5 text-sm dark:bg-[#252D3D]">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#707EAE] dark:text-[#94A3B8]">Product</span>
                  <span className="font-extrabold text-[#1B2559] dark:text-[#E6EDF3]">{localModal.p.name} × {qty}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#707EAE] dark:text-[#94A3B8]">Purchase Cost</span>
                  <span className="font-bold">{money(cost)} / unit ({money(totalCost)} total)</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#707EAE] dark:text-[#94A3B8]">Auto Selling Price (+{margin}%)</span>
                  <span className="text-base font-extrabold text-[#422AFB] dark:text-[#818CF8]">
                    {money(unitSell)} / unit ({money(totalSell)} total)
                  </span>
                </div>
                <div className="flex items-center justify-between border-t border-[#E0E5F2] pt-1.5 dark:border-[#2E384D]">
                  <span className="text-xs font-bold text-[#707EAE] dark:text-[#94A3B8]">Estimated Profit</span>
                  <span className="font-extrabold text-emerald-600 dark:text-emerald-400">+{money(profit)}</span>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setLocalModal(null)}>Cancel</Button>
                <Button disabled={!(qty > 0 && cost > 0)}>Add to Order · {money(totalSell)}</Button>
              </div>
            </form>
          );
        })()}
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
