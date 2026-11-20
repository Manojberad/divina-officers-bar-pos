import { useEffect, useState } from 'react';
import { api, download } from '../lib/api';
import { useApp } from '../lib/app';
import { Button, Card, Field, Input, Modal, Select, StockDot } from '../components/ui';

const BLANK = { name: '', category_id: '', sub_category: '', brand: '', description: '', size_ml: 750, unit: 'bottle', is_peg: true, food_type: '', purchase_price: 0, selling_price: 0, peg_price: 0, opening_stock: 0, min_stock: '', critical_stock: '', active: true };

const SUB_OPTIONS: Record<string, string[]> = {
  alcohol: ['Whisky', 'Rum', 'Vodka', 'Gin', 'Brandy', 'Wine', 'Beer'],
  food: ['Packed', 'Veg', 'Non-Veg'],
};

export default function Products() {
  const { money, toast } = useApp();
  const [products, setProducts] = useState<any[]>([]);
  const [cats, setCats] = useState<any[]>([]);
  const [ed, setEd] = useState<any>(null);
  const [file, setFile] = useState<File | null>(null);
  const [catEd, setCatEd] = useState<any>(null);

  const load = () => { api('/products?all=1', { cache: false }).then(setProducts); api('/categories', { cache: false }).then(setCats); };
  useEffect(load, []);

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
    try { await api(catEd.id ? `/categories/${catEd.id}` : '/categories', { method: catEd.id ? 'PUT' : 'POST', body: catEd }); setCatEd(null); load(); } catch (e: any) { toast(e.message, 'error'); }
  };

  const importXlsx = async (file?: File) => {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    try {
      const r = await api('/products/import', { method: 'POST', body: fd });
      toast(`Imported: ${r.created} added, ${r.updated} updated${r.categories_created ? `, ${r.categories_created} new categories` : ''}${r.skipped?.length ? ` (${r.skipped.length} skipped)` : ''}`);
      load();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  return (
    <div className="space-y-4 p-4">
      <Card title="Categories & default stock thresholds" actions={<Button size="sm" onClick={() => setCatEd({ name: '', low_threshold: 3, critical_threshold: 1 })}>+ Category</Button>}>
        <div className="flex flex-wrap gap-2">
          {cats.map((c) => (
            <button key={c.id} onClick={() => setCatEd(c)} className="rounded-xl border px-3 py-2 text-left text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-900">
              <div className="font-semibold">{c.name}</div>
              <div className="text-xs text-gray-500">Low ≤ {c.low_threshold ?? 3} · Crit ≤ {c.critical_threshold ?? 1}</div>
            </button>
          ))}
        </div>
      </Card>

      <Card
        title={`Products (${products.length})`}
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
        <p className="mb-3 text-xs text-[#707EAE] dark:text-[#94A3B8]">
          Import products &amp; categories in bulk from Excel (<code>.xlsx</code> / <code>.csv</code>). Missing categories are created automatically; include <code>Food Type</code> (<code>Veg</code> / <code>Non-Veg</code>) for kitchen items.
        </p>
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-gray-500"><tr><th className="p-2">Product</th><th>Category / Sub</th><th>Size / Unit</th><th>Peg</th><th>Purchase</th><th>Selling</th><th>Peg (30ml)</th><th>Stock</th><th>Thresholds</th><th /></tr></thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id} className={`border-t dark:border-gray-700 ${!p.active ? 'opacity-50' : ''}`}>
                  <td className="flex items-center gap-2 p-2 font-semibold">
                    {p.image && <img src={p.image} className="h-9 w-9 rounded object-cover" alt="" />}
                    <span>{p.name}</span>
                    {p.food_type === 'veg' && <span className="inline-flex h-4 w-4 items-center justify-center rounded-xs border border-emerald-600" title="Veg"><span className="h-2 w-2 rounded-full bg-emerald-600" /></span>}
                    {p.food_type === 'nonveg' && <span className="inline-flex h-4 w-4 items-center justify-center rounded-xs border border-red-600" title="Non-Veg"><span className="h-2 w-2 rounded-full bg-red-600" /></span>}
                  </td>
                  <td>
                    <div className="font-medium">{p.category}</div>
                    {p.sub_category && <div className="text-xs text-[#94A3B8]">{p.sub_category}</div>}
                  </td>
                  <td>{p.size_ml ? `${p.size_ml} ml` : p.unit}</td><td>{p.is_peg ? 'Yes' : 'No'}</td>
                  <td>{money(p.purchase_price)}</td><td>{money(p.selling_price)}</td><td>{p.is_peg ? money(p.peg_price) : '—'}</td>
                  <td>
                    <StockDot s={p.stock_status} label={`${p.stock_display} ${p.stock_unit}`} />
                    {p.is_peg && p.full_bottles != null && (p.full_bottles > 0 || p.loose_pegs_30ml > 0) && (
                      <div className="text-[11px] text-[#94A3B8]">{p.full_bottles} btl · {p.loose_pegs_30ml} pegs</div>
                    )}
                  </td>
                  <td>{p.low_level} / {p.critical_level}</td>
                  <td className="space-x-1 text-right"><Button size="sm" variant="subtle" onClick={() => { setFile(null); setEd({ ...p, sub_category: p.sub_category ?? '', food_type: p.food_type ?? '', min_stock: p.min_stock ?? '', critical_stock: p.critical_stock ?? '' }); }}>Edit</Button><Button size="sm" variant="ghost" onClick={() => del(p.id)}>✕</Button></td>
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
            <Field label="Category"><Select value={ed.category_id || ''} onChange={(e) => setEd({ ...ed, category_id: e.target.value, sub_category: '' })}>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
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
            <Field label="Food Type (Kitchen Veg / Non-Veg)">
              <Select value={ed.food_type || ''} onChange={(e) => setEd({ ...ed, food_type: e.target.value })}>
                <option value="">Not applicable (Drink / Other)</option>
                <option value="veg">Veg</option>
                <option value="nonveg">Non-Veg</option>
              </Select>
            </Field>
            <Field label="Serve mode"><Select value={ed.is_peg ? '1' : '0'} onChange={(e) => setEd({ ...ed, is_peg: e.target.value === '1' })}><option value="1">Bottle + Peg (ml tracked)</option><option value="0">Unit / Bottle only</option></Select></Field>
            <Field label="Bottle size (ml)"><Input type="number" value={ed.size_ml} onChange={(e) => setEd({ ...ed, size_ml: e.target.value })} /></Field>
            <Field label="Unit of measure"><Input value={ed.unit} onChange={(e) => setEd({ ...ed, unit: e.target.value })} /></Field>
            <Field label="Purchase price (per bottle/unit)"><Input type="number" step="0.01" value={ed.purchase_price} onChange={(e) => setEd({ ...ed, purchase_price: e.target.value })} /></Field>
            <Field label="Selling price (per bottle/unit)"><Input type="number" step="0.01" value={ed.selling_price} onChange={(e) => setEd({ ...ed, selling_price: e.target.value })} /></Field>
            {ed.is_peg && <Field label="30 ml peg selling price" hint="60/90 ml scale proportionally"><Input type="number" step="0.01" value={ed.peg_price} onChange={(e) => setEd({ ...ed, peg_price: e.target.value })} /></Field>}
            {!ed.id && <Field label="Opening stock (bottles/units)"><Input type="number" step="0.01" value={ed.opening_stock} onChange={(e) => setEd({ ...ed, opening_stock: e.target.value })} /></Field>}
            <Field label="Min stock override" hint="Blank = category default"><Input type="number" step="0.1" value={ed.min_stock} onChange={(e) => setEd({ ...ed, min_stock: e.target.value })} /></Field>
            <Field label="Critical stock override"><Input type="number" step="0.1" value={ed.critical_stock} onChange={(e) => setEd({ ...ed, critical_stock: e.target.value })} /></Field>
            <Field label="Product image"><Input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] || null)} /></Field>
            <div className="sm:col-span-2"><Field label="Description"><Input value={ed.description || ''} onChange={(e) => setEd({ ...ed, description: e.target.value })} /></Field></div>
            {ed.id && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!ed.active} onChange={(e) => setEd({ ...ed, active: e.target.checked })} /> Active</label>}
            <div className="flex justify-end gap-2 sm:col-span-3"><Button type="button" variant="ghost" onClick={() => setEd(null)}>Cancel</Button><Button>Save</Button></div>
          </form>
        )}
      </Modal>

      <Modal open={!!catEd} onClose={() => setCatEd(null)} title={catEd?.id ? 'Edit Category' : 'New Category'}>
        {catEd && (
          <form onSubmit={saveCat} className="space-y-3">
            <Field label="Name"><Input value={catEd.name} onChange={(e) => setCatEd({ ...catEd, name: e.target.value })} required /></Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Low stock threshold"><Input type="number" step="0.5" value={catEd.low_threshold ?? ''} onChange={(e) => setCatEd({ ...catEd, low_threshold: e.target.value })} /></Field>
              <Field label="Critical stock threshold"><Input type="number" step="0.5" value={catEd.critical_threshold ?? ''} onChange={(e) => setCatEd({ ...catEd, critical_threshold: e.target.value })} /></Field>
            </div>
            <div className="flex justify-between">
              {catEd.id ? <Button type="button" variant="danger" onClick={async () => { try { await api(`/categories/${catEd.id}`, { method: 'DELETE' }); setCatEd(null); load(); } catch (e: any) { toast(e.message, 'error'); } }}>Delete</Button> : <span />}
              <Button>Save</Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
