import { useEffect, useMemo, useState } from 'react';
import { api, download } from '../lib/api';
import { useApp } from '../lib/app';
import { Button, Card, Field, Input, Modal, Select, StockDot } from '../components/ui';

const BLANK = {
  name: '', category_id: '', sub_category: '', brand: '', description: '', size_ml: 750, unit: 'bottle',
  is_peg: true, is_recipe: false, food_type: '', purchase_price: 0, selling_price: 0, peg_price: 0, opening_stock: 0, active: true,
};

const SUB_OPTIONS: Record<string, string[]> = {
  alcohol: ['Whisky', 'Rum', 'Vodka', 'Gin', 'Brandy', 'Wine', 'Beer'],
  'soft drinks': ['Juices', 'Soda', 'Water'],
  food: ['Packed', 'Veg', 'Non-Veg'],
};

export default function Products() {
  const { money, toast } = useApp();
  const [products, setProducts] = useState<any[]>([]);
  const [cats, setCats] = useState<any[]>([]);
  const [margins, setMargins] = useState<Record<number, string>>({});
  const [ed, setEd] = useState<any>(null);
  const [file, setFile] = useState<File | null>(null);
  const [catEd, setCatEd] = useState<any>(null);
  const [recipeEd, setRecipeEd] = useState<{ product: any; rows: { ingredient_id: string; qty: string; display_qty: string; display_unit: string }[] } | null>(null);
  const [recipeBusy, setRecipeBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('ALL');

  const rawIngredients = useMemo(() => products.filter((p) => !p.is_recipe && p.active), [products]);

  const openRecipeEditor = (p: any) => {
    const existing = Array.isArray(p.recipe) ? p.recipe : [];
    setRecipeEd({
      product: p,
      rows: existing.map((r: any) => ({
        ingredient_id: String(r.ingredient_id),
        qty: String(r.qty),
        display_qty: String(r.display_qty),
        display_unit: String(r.display_unit || r.ingredient_unit || 'unit'),
      })),
    });
  };

  const saveRecipe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recipeEd) return;
    setRecipeBusy(true);
    try {
      const ingredients = recipeEd.rows
        .filter((r) => r.ingredient_id && Number(r.qty) > 0)
        .map((r) => ({
          ingredient_id: Number(r.ingredient_id),
          qty: Number(r.qty),
          display_qty: Number(r.display_qty) > 0 ? Number(r.display_qty) : Number(r.qty),
          display_unit: r.display_unit.trim() || 'unit',
        }));
      await api(`/products/${recipeEd.product.id}/recipe`, {
        method: 'PUT',
        body: { is_recipe: ingredients.length > 0, ingredients },
      });
      toast(`✔ Recipe saved for ${recipeEd.product.name}`);
      setRecipeEd(null);
      load();
    } catch (err: any) {
      toast(err.message, 'error');
    } finally {
      setRecipeBusy(false);
    }
  };

  const load = () => {
    api('/products?all=1', { cache: false }).then(setProducts);
    api<any[]>('/categories', { cache: false }).then((cs) => {
      setCats(cs);
      const m: Record<number, string> = {};
      cs.forEach((c) => { m[c.id] = String(c.profit_margin ?? 0); });
      setMargins(m);
    });
  };
  useEffect(load, []);

  const applyMargin = async (c: any) => {
    const val = Math.max(0, Number(margins[c.id]) || 0);
    try {
      const r = await api<any>(`/categories/${c.id}`, { method: 'PUT', body: { profit_margin: val, apply_margin: true } });
      toast(`✔ ${c.name} margin set to ${val}% (${r.updated_products ?? 0} product prices recalculated)`);
      load();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const recalcDraftPrices = (draft: any, nextPurchase?: any, nextCatId?: any, nextIsPeg?: boolean, nextSizeMl?: any) => {
    const pp = Number(nextPurchase ?? draft.purchase_price) || 0;
    const cid = nextCatId ?? draft.category_id;
    const isPeg = nextIsPeg ?? draft.is_peg;
    const sizeMl = Number(nextSizeMl ?? draft.size_ml) || 0;
    const c = cats.find((x) => String(x.id) === String(cid));
    const margin = Number(c?.profit_margin ?? 0);
    const sp = pp > 0 ? Math.round(pp * (1 + margin / 100) * 100) / 100 : draft.selling_price;
    const pegp = isPeg && sizeMl > 0 && sp > 0 ? Math.round((sp / (sizeMl / 30)) * 100) / 100 : 0;
    return { ...draft, purchase_price: nextPurchase ?? draft.purchase_price, category_id: cid, is_peg: isPeg, size_ml: nextSizeMl ?? draft.size_ml, selling_price: sp, peg_price: pegp };
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const fd = new FormData();
    Object.entries(ed).forEach(([k, v]) => v != null && fd.append(k, String(v)));
    if (file) fd.append('image', file);
    try {
      await api(ed.id ? `/products/${ed.id}` : '/products', { method: ed.id ? 'PUT' : 'POST', body: fd });
      toast('Saved'); setEd(null); setFile(null); load();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const del = async (id: number) => { if (!confirm('Delete / deactivate product?')) return; await api(`/products/${id}`, { method: 'DELETE' }); load(); };

  const saveCat = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const r = await api<any>(catEd.id ? `/categories/${catEd.id}` : '/categories', {
        method: catEd.id ? 'PUT' : 'POST',
        body: { ...catEd, profit_margin: Number(catEd.profit_margin) || 0, apply_margin: true },
      });
      toast(catEd.id ? `Category updated (${r.updated_products ?? 0} prices updated)` : 'Category added');
      setCatEd(null);
      load();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const importXlsx = async (f?: File) => {
    if (!f) return;
    const fd = new FormData();
    fd.append('file', f);
    try {
      const r = await api('/products/import', { method: 'POST', body: fd });
      toast(`Imported: ${r.created} added, ${r.updated} updated${r.categories_created ? `, ${r.categories_created} new categories` : ''}${r.skipped?.length ? ` (${r.skipped.length} skipped)` : ''}`);
      load();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (catFilter !== 'ALL' && String(p.category_id) !== catFilter) return false;
      if (!q) return true;
      return `${p.name} ${p.category || ''} ${p.sub_category || ''} ${p.brand || ''}`.toLowerCase().includes(q);
    });
  }, [products, search, catFilter]);

  return (
    <div className="space-y-4 p-4">
      <Card
        title="Categories & Profit Margins (%)"
        actions={<Button size="sm" onClick={() => setCatEd({ name: '', profit_margin: 0 })}>+ Category</Button>}
      >
        <p className="mb-3 text-xs text-[#707EAE] dark:text-[#94A3B8]">
          Edit the profit margin percentage for any category and click <b>Apply</b> to automatically recalculate selling &amp; 30 ml peg prices for all items in that category from their purchase price.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {cats.map((c) => (
            <div key={c.id} className="rounded-2xl border border-[#E9EDF7] bg-[#F4F7FE]/70 p-3 dark:border-[#2A3346] dark:bg-[#252D3D]">
              <div className="flex items-center justify-between gap-1">
                <button type="button" onClick={() => setCatEd(c)} className="truncate text-sm font-extrabold text-[#1B2559] hover:text-[#422AFB] dark:text-[#E6EDF3] dark:hover:text-[#818CF8]">
                  {c.name}
                </button>
                <span className="rounded-full bg-[#10B981]/15 px-2 py-0.5 text-[11px] font-extrabold text-[#059669] dark:text-[#34D399]">
                  {c.profit_margin ?? 0}%
                </span>
              </div>
              <div className="mt-2 flex items-center gap-1.5">
                <Input
                  type="number"
                  step="0.5"
                  min={0}
                  max={200}
                  value={margins[c.id] ?? ''}
                  onChange={(e) => setMargins({ ...margins, [c.id]: e.target.value })}
                  className="!min-h-8 !px-2.5 !py-1 !text-xs"
                  aria-label={`${c.name} profit margin %`}
                />
                <span className="text-xs font-bold text-[#94A3B8]">%</span>
                <Button size="sm" onClick={() => applyMargin(c)}>Apply</Button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card
        title={`Products (${filtered.length}${filtered.length !== products.length ? ` of ${products.length}` : ''})`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" onClick={() => download('/products/template', 'products-categories-template.xlsx').catch((e) => toast(e.message, 'error'))}>
              📄 Excel Template
            </Button>
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-[#F4F7FE] px-3.5 py-1.5 text-xs font-bold text-[#1B2559] hover:bg-[#E9EDF7] dark:bg-[#252D3D] dark:text-[#E6EDF3]">
              📥 Import Excel
              <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { importXlsx(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
            <Button onClick={() => { setFile(null); setEd({ ...BLANK, category_id: cats[0]?.id || '' }); }}>+ New Product</Button>
          </div>
        }
      >
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Input placeholder="🔍 Search product, sub-category, brand…" value={search} onChange={(e) => setSearch(e.target.value)} className="!max-w-xs" />
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant={catFilter === 'ALL' ? 'primary' : 'subtle'} onClick={() => setCatFilter('ALL')}>All ({products.length})</Button>
            {cats.map((c) => (
              <Button key={c.id} size="sm" variant={catFilter === String(c.id) ? 'primary' : 'subtle'} onClick={() => setCatFilter(String(c.id))}>
                {c.name} ({products.filter((p) => p.category_id === c.id).length})
              </Button>
            ))}
          </div>
        </div>

        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs font-bold uppercase tracking-wider text-[#94A3B8]">
              <tr>
                <th className="p-2">Product</th>
                <th>Category / Sub</th>
                <th>Size / Unit</th>
                <th>Purchase</th>
                <th>Selling</th>
                <th>30 ml Rate</th>
                <th>Stock</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} className={`border-t border-[#E9EDF7] dark:border-[#2A3346] ${!p.active ? 'opacity-50' : ''}`}>
                  <td className="flex items-center gap-2 p-2 font-semibold">
                    {p.image && <img src={p.image} className="h-9 w-9 shrink-0 rounded-lg object-cover" alt="" />}
                    <span className="max-w-xs truncate" title={p.name}>{p.name}</span>
                    {p.is_recipe && (
                      <span className="shrink-0 rounded-full bg-[#422AFB]/12 px-2 py-0.5 text-[10px] font-extrabold text-[#422AFB] dark:bg-[#6366F1]/20 dark:text-[#A5B4FC]">
                        🍹 Recipe
                      </span>
                    )}
                    {p.food_type === 'veg' && <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-xs border border-emerald-600" title="Veg"><span className="h-2 w-2 rounded-full bg-emerald-600" /></span>}
                    {p.food_type === 'nonveg' && <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-xs border border-red-600" title="Non-Veg"><span className="h-2 w-2 rounded-full bg-red-600" /></span>}
                  </td>
                  <td>
                    <div className="font-medium">{p.category}</div>
                    {p.sub_category && <div className="text-xs text-[#94A3B8]">{p.sub_category}</div>}
                  </td>
                  <td>{p.size_ml ? `${p.size_ml} ml` : p.unit}</td>
                  <td>
                    {p.is_recipe ? (
                      <div>
                        <div className="font-semibold">{money(p.recipe_cost ?? 0)}</div>
                        <div className="text-[10px] text-[#94A3B8]">dynamic recipe cost</div>
                      </div>
                    ) : money(p.purchase_price)}
                  </td>
                  <td className="font-bold text-[#422AFB] dark:text-[#818CF8]">{money(p.selling_price)}</td>
                  <td>{p.is_peg ? money(p.peg_price) : '—'}</td>
                  <td>
                    <StockDot s={p.stock_status} label={`${p.stock_display} ${p.stock_unit}`} />
                    {p.is_recipe && (
                      <div className="text-[11px] text-[#94A3B8]">
                        from ingredients{p.limiting_ingredient ? ` (min: ${p.limiting_ingredient})` : ''}
                      </div>
                    )}
                    {p.is_peg && p.full_bottles != null && (p.full_bottles > 0 || p.loose_pegs_30ml > 0) && (
                      <div className="text-[11px] text-[#94A3B8]">{p.full_bottles} btl · {p.loose_pegs_30ml} pegs</div>
                    )}
                  </td>
                  <td className="space-x-1 whitespace-nowrap text-right">
                    {!p.is_peg && (
                      <Button size="sm" variant={p.is_recipe ? 'primary' : 'ghost'} onClick={() => openRecipeEditor(p)}>
                        🧪 Recipe
                      </Button>
                    )}
                    <Button size="sm" variant="subtle" onClick={() => { setFile(null); setEd({ ...p, sub_category: p.sub_category ?? '', food_type: p.food_type ?? '' }); }}>Edit</Button>
                    <Button size="sm" variant="ghost" onClick={() => del(p.id)}>✕</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal open={!!ed} onClose={() => setEd(null)} title={ed?.id ? 'Edit Product' : 'New Product'} wide>
        {ed && (
          <form onSubmit={save} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Product name"><Input value={ed.name} onChange={(e) => setEd({ ...ed, name: e.target.value })} required /></Field>
            <Field label="Category">
              <Select value={ed.category_id || ''} onChange={(e) => setEd(recalcDraftPrices({ ...ed, sub_category: '' }, undefined, e.target.value))}>
                {cats.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.profit_margin ?? 0}% margin)</option>)}
              </Select>
            </Field>
            {(() => {
              const cName = (cats.find((c) => String(c.id) === String(ed.category_id))?.name || '').toLowerCase();
              const opts = SUB_OPTIONS[cName];
              if (!opts) return null;
              return (
                <Field label="Sub-Category">
                  <Select
                    value={ed.sub_category || ''}
                    onChange={(e) => {
                      const v = e.target.value;
                      setEd({ ...ed, sub_category: v, food_type: v === 'Veg' ? 'veg' : v === 'Non-Veg' ? 'nonveg' : v === 'Packed' ? '' : ed.food_type });
                    }}
                  >
                    <option value="">Select sub-category…</option>
                    {opts.map((o) => <option key={o} value={o}>{o}</option>)}
                  </Select>
                </Field>
              );
            })()}
            <Field label="Brand"><Input value={ed.brand || ''} onChange={(e) => setEd({ ...ed, brand: e.target.value })} /></Field>
            <Field label="Serve mode">
              <Select
                value={ed.is_recipe ? 'recipe' : ed.is_peg ? '1' : '0'}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === 'recipe') setEd({ ...ed, is_recipe: true, is_peg: false, size_ml: 0, unit: ed.unit === 'bottle' ? 'glass' : ed.unit });
                  else setEd(recalcDraftPrices({ ...ed, is_recipe: false }, undefined, undefined, v === '1'));
                }}
              >
                <option value="1">Bottle + Peg (ml tracked)</option>
                <option value="0">Unit / Bottle / Pack</option>
                <option value="recipe">Recipe / Composite Drink (auto-deduct ingredients)</option>
              </Select>
            </Field>
            {!ed.is_recipe && (
              <Field label="Bottle size (ml)">
                <Input type="number" value={ed.size_ml} onChange={(e) => setEd(recalcDraftPrices(ed, undefined, undefined, undefined, e.target.value))} />
              </Field>
            )}
            <Field label="Unit of measure"><Input value={ed.unit} onChange={(e) => setEd({ ...ed, unit: e.target.value })} /></Field>
            {!ed.is_recipe && (
              <Field label="Purchase price (per bottle/unit)">
                <Input type="number" step="0.01" value={ed.purchase_price} onChange={(e) => setEd(recalcDraftPrices(ed, e.target.value))} />
              </Field>
            )}
            <Field label={ed.is_recipe ? 'Selling price (independent of recipe cost)' : 'Selling price (auto from margin, editable)'}>
              <Input type="number" step="0.01" value={ed.selling_price} onChange={(e) => setEd({ ...ed, selling_price: e.target.value })} />
            </Field>
            {ed.is_peg && !ed.is_recipe && (
              <Field label="30 ml peg selling price" hint="60 ml scales 2×">
                <Input type="number" step="0.01" value={ed.peg_price} onChange={(e) => setEd({ ...ed, peg_price: e.target.value })} />
              </Field>
            )}
            {!ed.id && !ed.is_recipe && <Field label="Opening stock (bottles/units)"><Input type="number" step="0.01" value={ed.opening_stock} onChange={(e) => setEd({ ...ed, opening_stock: e.target.value })} /></Field>}
            {ed.is_recipe && (
              <div className="rounded-xl bg-[#422AFB]/10 p-3 text-xs font-medium text-[#1B2559] dark:bg-[#6366F1]/15 dark:text-[#E6EDF3] sm:col-span-3">
                🍹 Recipe-based drink: ingredient cost and available quantity are computed dynamically from the configured recipe ingredients. Click <b>🧪 Recipe</b> after saving to configure ingredients.
              </div>
            )}
            <Field label="Product image"><Input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] || null)} /></Field>
            <div className="sm:col-span-2"><Field label="Description"><Input value={ed.description || ''} onChange={(e) => setEd({ ...ed, description: e.target.value })} /></Field></div>
            {ed.id && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!ed.active} onChange={(e) => setEd({ ...ed, active: e.target.checked })} /> Active</label>}
            <div className="flex justify-end gap-2 sm:col-span-3"><Button type="button" variant="ghost" onClick={() => setEd(null)}>Cancel</Button><Button>Save</Button></div>
          </form>
        )}
      </Modal>

      <Modal open={!!recipeEd} onClose={() => setRecipeEd(null)} title={recipeEd ? `Recipe Configuration · ${recipeEd.product.name}` : 'Recipe'} wide>
        {recipeEd && (() => {
          const calcCost = recipeEd.rows.reduce((sum, r) => {
            const ing = rawIngredients.find((x) => String(x.id) === r.ingredient_id);
            if (!ing) return sum;
            const unitCost = ing.is_peg && ing.size_ml > 0 ? ing.purchase_price / ing.size_ml : ing.purchase_price;
            return sum + (Number(r.qty) || 0) * unitCost;
          }, 0);
          const sell = Number(recipeEd.product.selling_price) || 0;
          const profit = Math.round((sell - calcCost) * 100) / 100;
          return (
            <form onSubmit={saveRecipe} className="space-y-4">
              <div className="grid grid-cols-1 gap-2.5 rounded-2xl bg-[#F4F7FE] p-3.5 dark:bg-[#252D3D] sm:grid-cols-3">
                <div>
                  <div className="text-[11px] font-bold uppercase text-[#94A3B8]">Dynamic Ingredient Cost</div>
                  <div className="text-lg font-extrabold text-[#1B2559] dark:text-[#E6EDF3]">{money(Math.round(calcCost * 100) / 100)}</div>
                </div>
                <div>
                  <div className="text-[11px] font-bold uppercase text-[#94A3B8]">Independent Selling Price</div>
                  <div className="text-lg font-extrabold text-[#422AFB] dark:text-[#818CF8]">{money(sell)}</div>
                </div>
                <div>
                  <div className="text-[11px] font-bold uppercase text-[#94A3B8]">Margin per Drink</div>
                  <div className={`text-lg font-extrabold ${profit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}`}>
                    {profit >= 0 ? '+' : ''}{money(profit)}
                  </div>
                </div>
              </div>

              <p className="text-xs text-[#707EAE] dark:text-[#94A3B8]">
                Every time 1 <b>{recipeEd.product.name}</b> is sold, all configured ingredients below are deducted atomically from inventory in their exact stock units. Costs update automatically when ingredient purchase prices change.
              </p>

              <div className="space-y-2.5">
                {recipeEd.rows.map((row, idx) => {
                  const ing = rawIngredients.find((x) => String(x.id) === row.ingredient_id);
                  const ingBaseUnit = ing ? (ing.is_peg ? 'ml' : ing.unit || 'unit') : 'unit';
                  const unitCost = ing ? (ing.is_peg && ing.size_ml > 0 ? ing.purchase_price / ing.size_ml : ing.purchase_price) : 0;
                  const lineCost = Math.round((Number(row.qty) || 0) * unitCost * 100) / 100;
                  return (
                    <div key={idx} className="grid grid-cols-1 items-end gap-2 rounded-2xl border border-[#E9EDF7] p-3 dark:border-[#2A3346] sm:grid-cols-12">
                      <div className="sm:col-span-4">
                        <Field label="Inventory Ingredient">
                          <Select
                            value={row.ingredient_id}
                            onChange={(e) => {
                              const nextId = e.target.value;
                              const nextIng = rawIngredients.find((x) => String(x.id) === nextId);
                              setRecipeEd({
                                ...recipeEd,
                                rows: recipeEd.rows.map((r, i) => (i === idx ? {
                                  ...r,
                                  ingredient_id: nextId,
                                  display_unit: nextIng ? (nextIng.is_peg ? 'ml' : nextIng.unit || 'unit') : r.display_unit,
                                } : r)),
                              });
                            }}
                            required
                          >
                            <option value="">Select ingredient…</option>
                            {rawIngredients.map((x) => (
                              <option key={x.id} value={String(x.id)}>
                                {x.name} ({x.stock_display} {x.stock_unit} · {money(x.purchase_price)})
                              </option>
                            ))}
                          </Select>
                        </Field>
                      </div>
                      <div className="sm:col-span-2">
                        <Field label={`Deduct (${ingBaseUnit})`}>
                          <Input
                            type="number"
                            step="0.01"
                            min="0.01"
                            value={row.qty}
                            onChange={(e) => setRecipeEd({ ...recipeEd, rows: recipeEd.rows.map((r, i) => (i === idx ? { ...r, qty: e.target.value } : r)) })}
                            required
                          />
                        </Field>
                      </div>
                      <div className="sm:col-span-2">
                        <Field label="Report Qty">
                          <Input
                            type="number"
                            step="0.01"
                            min="0.01"
                            value={row.display_qty}
                            onChange={(e) => setRecipeEd({ ...recipeEd, rows: recipeEd.rows.map((r, i) => (i === idx ? { ...r, display_qty: e.target.value } : r)) })}
                            required
                          />
                        </Field>
                      </div>
                      <div className="sm:col-span-2">
                        <Field label="Report Unit">
                          <Input
                            value={row.display_unit}
                            onChange={(e) => setRecipeEd({ ...recipeEd, rows: recipeEd.rows.map((r, i) => (i === idx ? { ...r, display_unit: e.target.value } : r)) })}
                            placeholder="ml / piece"
                            required
                          />
                        </Field>
                      </div>
                      <div className="flex items-center justify-between gap-2 sm:col-span-2 sm:flex-col sm:items-end">
                        <div className="text-xs font-extrabold text-[#422AFB] dark:text-[#818CF8]">{money(lineCost)}</div>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setRecipeEd({ ...recipeEd, rows: recipeEd.rows.filter((_, i) => i !== idx) })}
                        >
                          Remove
                        </Button>
                      </div>
                    </div>
                  );
                })}
                {recipeEd.rows.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-[#E0E5F2] py-6 text-center text-xs text-[#94A3B8] dark:border-[#2E384D]">
                    No recipe ingredients configured. Add ingredients below to convert this into a recipe-deducted drink.
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                <Button
                  type="button"
                  variant="subtle"
                  onClick={() => setRecipeEd({
                    ...recipeEd,
                    rows: [...recipeEd.rows, { ingredient_id: '', qty: '1', display_qty: '1', display_unit: 'ml' }],
                  })}
                >
                  + Add Ingredient
                </Button>
                <div className="flex gap-2">
                  <Button type="button" variant="ghost" onClick={() => setRecipeEd(null)}>Cancel</Button>
                  <Button disabled={recipeBusy}>{recipeBusy ? 'Saving…' : 'Save Recipe'}</Button>
                </div>
              </div>
            </form>
          );
        })()}
      </Modal>

      <Modal open={!!catEd} onClose={() => setCatEd(null)} title={catEd?.id ? 'Edit Category' : 'New Category'}>
        {catEd && (
          <form onSubmit={saveCat} className="space-y-3">
            <Field label="Category Name"><Input value={catEd.name} onChange={(e) => setCatEd({ ...catEd, name: e.target.value })} required /></Field>
            <Field label="Profit Margin (%)" hint="Automatically updates selling & 30 ml peg prices in this category">
              <Input type="number" step="0.5" min={0} max={200} value={catEd.profit_margin ?? 0} onChange={(e) => setCatEd({ ...catEd, profit_margin: e.target.value })} />
            </Field>
            <div className="flex justify-between">
              {catEd.id ? <Button type="button" variant="danger" onClick={async () => { try { await api(`/categories/${catEd.id}`, { method: 'DELETE' }); setCatEd(null); load(); } catch (e: any) { toast(e.message, 'error'); } }}>Delete</Button> : <span />}
              <Button>Save &amp; Apply Margin</Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
