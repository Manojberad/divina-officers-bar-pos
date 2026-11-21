import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import crypto from 'node:crypto';
import * as XLSX from 'xlsx';
import { q, tx, audit, UPLOAD_DIR, getSettings } from '../db.js';
import { requireRole, optionalAuth, isStaff } from '../auth.js';
import { PRODUCT_SELECT, decorate, getProduct, moveStock, toBase, baseCost, computeRecipeMetrics } from '../services.js';

const r = Router();
export const imageUpload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, f, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${path.extname(f.originalname).toLowerCase() || '.png'}`),
  }),
  limits: { fileSize: 8e6 },
  fileFilter: (_req, f, cb) => cb(null, /^image\//.test(f.mimetype)),
});
const sheetUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10e6 } });

export function applyCategoryMargin(categoryId, marginPct) {
  const m = Math.max(0, Number(marginPct) || 0);
  const cat = q.get('SELECT name FROM categories WHERE id=?', categoryId);
  // For Miscellaneous, the margin governs dynamic on-demand local-purchase pricing without overwriting stocked Lime/Disposables
  if (cat && /^misc/i.test(cat.name)) return 0;
  // Keep recipe/composite and local-purchase products independent of bulk purchase-price recalculation
  const prods = q.all('SELECT id, purchase_price, is_peg, size_ml FROM products WHERE category_id=? AND is_recipe=0 AND is_local_purchase=0', categoryId);
  let updated = 0;
  for (const p of prods) {
    const pp = Number(p.purchase_price) || 0;
    if (!(pp > 0)) continue;
    const sp = Math.round(pp * (1 + m / 100) * 100) / 100;
    const pegp = p.is_peg && p.size_ml > 0 ? Math.round((sp / (p.size_ml / 30)) * 100) / 100 : 0;
    q.run('UPDATE products SET selling_price=?, peg_price=? WHERE id=?', sp, pegp, p.id);
    updated++;
  }
  return updated;
}

/* ---------- Categories ---------- */
r.get('/categories', (_req, res) => res.json(q.all('SELECT * FROM categories ORDER BY sort, name')));

r.post('/categories', requireRole('admin'), (req, res) => {
  const { name, low_threshold = null, critical_threshold = null, sort = 0, profit_margin = 0 } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
  if (q.get('SELECT id FROM categories WHERE name=? COLLATE NOCASE', name.trim())) return res.status(400).json({ error: 'Category exists' });
  const margin = Math.max(0, Number(profit_margin) || 0);
  const id = Number(q.run('INSERT INTO categories(name, low_threshold, critical_threshold, sort, profit_margin) VALUES(?,?,?,?,?)',
    name.trim(), numOrNull(low_threshold), numOrNull(critical_threshold), Number(sort) || 0, margin).lastInsertRowid);
  audit(req.user.id, 'category.create', 'category', id, req.body);
  res.status(201).json(q.get('SELECT * FROM categories WHERE id=?', id));
});

r.put('/categories/:id', requireRole('admin'), (req, res) => {
  const c = q.get('SELECT * FROM categories WHERE id=?', Number(req.params.id));
  if (!c) return res.status(404).json({ error: 'Not found' });
  const b = { ...c, ...req.body };
  const nextMargin = req.body.profit_margin !== undefined ? Math.max(0, Number(req.body.profit_margin) || 0) : (c.profit_margin || 0);
  const shouldApply = req.body.apply_margin === true || (req.body.profit_margin !== undefined && req.body.apply_margin !== false);
  let updatedProducts = 0;
  tx(() => {
    q.run('UPDATE categories SET name=?, low_threshold=?, critical_threshold=?, sort=?, profit_margin=? WHERE id=?',
      b.name, numOrNull(b.low_threshold), numOrNull(b.critical_threshold), Number(b.sort) || 0, nextMargin, c.id);
    if (shouldApply) {
      updatedProducts = applyCategoryMargin(c.id, nextMargin);
    }
  });
  audit(req.user.id, shouldApply ? 'category.margin_update' : 'category.update', 'category', c.id, { ...req.body, profit_margin: nextMargin, updated_products: updatedProducts });
  res.json({ ...q.get('SELECT * FROM categories WHERE id=?', c.id), updated_products: updatedProducts });
});

r.delete('/categories/:id', requireRole('admin'), (req, res) => {
  const n = q.get('SELECT COUNT(*) n FROM products WHERE category_id=?', Number(req.params.id)).n;
  if (n) return res.status(400).json({ error: 'Category has products' });
  q.run('DELETE FROM categories WHERE id=?', Number(req.params.id));
  audit(req.user.id, 'category.delete', 'category', req.params.id);
  res.json({ ok: true });
});

/* ---------- Products ---------- */
const numOrNull = (v) => (v === '' || v == null || isNaN(Number(v)) ? null : Number(v));
const parseFoodType = (v) => {
  const s = String(v || '').trim().toLowerCase().replace(/[^a-z]/g, '');
  if (!s || s === 'none' || s === 'na') return null;
  if (s === 'nonveg' || s === 'nv') return 'nonveg';
  if (s === 'veg' || s === 'v' || s === 'vegetarian') return 'veg';
  return null;
};

r.get('/products', optionalAuth, (req, res) => {
  const staff = isStaff(req.user);
  const rows = q.all(`${PRODUCT_SELECT} ${staff && req.query.all ? '' : 'WHERE p.active=1'} ORDER BY c.sort, p.name`).map(decorate);
  if (staff) return res.json(rows);
  // Regular customer view hides costs, exact stock, party-only 750ml variants & bartender-only local-purchase items
  res.json(rows.filter((p) => !p.party_only && !p.is_local_purchase).map(publicView));
});

export const publicView = (p) => ({
  id: p.id, name: p.name, category: p.category, category_id: p.category_id, sub_category: p.sub_category || null, brand: p.brand, description: p.description, image: p.image,
  size_ml: p.size_ml, unit: p.unit, is_peg: p.is_peg, party_only: !!p.party_only, is_local_purchase: !!p.is_local_purchase,
  food_type: p.food_type || null, selling_price: p.selling_price, peg_price: p.peg_price,
  favourite: p.favourite, available: p.stock_status !== 'out', active: p.active,
});

// Download ready-to-fill Excel template for importing Products & Categories
r.get('/products/template', requireRole('admin'), (_req, res) => {
  const wb = XLSX.utils.book_new();
  const prodRows = [
    {
      Name: 'Paneer Tikka',
      Category: 'Food',
      'Sub Category': 'Veg',
      'Food Type': 'Veg',
      Brand: 'Kitchen',
      Description: 'Tandoori spiced cottage cheese',
      'Size (ml)': 0,
      Unit: 'plate',
      'Is Peg': 'No',
      'Purchase Price': 110,
      'Selling Price': 220,
      'Peg Price (30ml)': 0,
      'Opening Stock': 20,
      'Min Stock': 5,
      'Critical Stock': 2,
    },
    {
      Name: 'Mutton Seekh Kebab',
      Category: 'Food',
      'Sub Category': 'Non-Veg',
      'Food Type': 'Non-Veg',
      Brand: 'Kitchen',
      Description: 'Spiced minced mutton skewers',
      'Size (ml)': 0,
      Unit: 'plate',
      'Is Peg': 'No',
      'Purchase Price': 160,
      'Selling Price': 320,
      'Peg Price (30ml)': 0,
      'Opening Stock': 15,
      'Min Stock': 5,
      'Critical Stock': 2,
    },
    {
      Name: 'Single Malt 15Y',
      Category: 'Alcohol',
      'Sub Category': 'Whisky',
      'Food Type': '',
      Brand: 'Highland',
      Description: 'Aged 15 years single malt',
      'Size (ml)': 750,
      Unit: 'bottle',
      'Is Peg': 'Yes',
      'Purchase Price': 4200,
      'Selling Price': 5800,
      'Peg Price (30ml)': 280,
      'Opening Stock': 6,
      'Min Stock': 2,
      'Critical Stock': 1,
    },
  ];
  const catRows = [
    { Name: 'Alcohol', 'Profit Margin (%)': 5, Sort: 1 },
    { Name: 'Soft Drinks', 'Profit Margin (%)': 10, Sort: 2 },
    { Name: 'Food', 'Profit Margin (%)': 10, Sort: 3 },
    { Name: 'Cigarettes', 'Profit Margin (%)': 7.5, Sort: 4 },
    { Name: 'Misc', 'Profit Margin (%)': 0, Sort: 5 },
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(prodRows), 'Products');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(catRows), 'Categories');
  res.setHeader('Content-Disposition', 'attachment; filename="products-categories-template.xlsx"');
  res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
});

// Bulk import Categories & Products from Excel (.xlsx / .xls / .csv)
r.post('/products/import', requireRole('admin'), sheetUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No Excel file uploaded' });
  const wb = XLSX.read(req.file.buffer);
  const result = { categories_created: 0, created: 0, updated: 0, skipped: [] };

  const normRow = (row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k.toLowerCase().replace(/[^a-z0-9]/g, ''), v]));
  const ensureCat = (name, low = null, crit = null, sort = null) => {
    const clean = String(name || '').trim();
    if (!clean) return null;
    const existing = q.get('SELECT id FROM categories WHERE name=? COLLATE NOCASE', clean);
    if (existing) {
      if (low != null || crit != null || sort != null) {
        q.run('UPDATE categories SET low_threshold=COALESCE(?,low_threshold), critical_threshold=COALESCE(?,critical_threshold), sort=COALESCE(?,sort) WHERE id=?', low, crit, sort, existing.id);
      }
      return existing.id;
    }
    const maxSort = q.get('SELECT COALESCE(MAX(sort),0) m FROM categories').m;
    const id = Number(q.run('INSERT INTO categories(name, low_threshold, critical_threshold, sort) VALUES(?,?,?,?)', clean, low, crit, sort ?? maxSort + 1).lastInsertRowid);
    result.categories_created++;
    return id;
  };

  tx(() => {
    // 1. Optional Categories sheet
    const catSheetName = wb.SheetNames.find((s) => /^categor/i.test(s));
    if (catSheetName) {
      for (const raw of XLSX.utils.sheet_to_json(wb.Sheets[catSheetName])) {
        const n = normRow(raw);
        if (n.name || n.category || n.categoryname) {
          ensureCat(n.name || n.category || n.categoryname, numOrNull(n.lowthreshold ?? n.low ?? n.minstock), numOrNull(n.criticalthreshold ?? n.critical), numOrNull(n.sort));
        }
      }
    }

    // 2. Products sheet (named 'Products' or first sheet if not purely Categories)
    const prodSheetName = wb.SheetNames.find((s) => /^product|^item|^menu/i.test(s)) || (wb.SheetNames[0] !== catSheetName ? wb.SheetNames[0] : null);
    if (prodSheetName) {
      for (const raw of XLSX.utils.sheet_to_json(wb.Sheets[prodSheetName])) {
        const n = normRow(raw);
        const name = String(n.name || n.product || n.productname || '').trim();
        if (!name) { result.skipped.push('Missing product name'); continue; }
        const catName = String(n.category || n.categoryname || 'Uncategorised').trim();
        const catId = ensureCat(catName);
        const isPegRaw = String(n.ispeg ?? n.peg ?? '').trim().toLowerCase();
        const isPeg = ['1', 'true', 'yes', 'y'].includes(isPegRaw) ? 1 : 0;
        const sizeMl = Number(n.sizeml ?? n.size ?? n.bottlesize ?? 0) || 0;
        if (isPeg && !(sizeMl > 0)) { result.skipped.push(`${name}: Peg-enabled products need Size (ml)`); continue; }
        const unit = String(n.unit || (isPeg ? 'bottle' : 'unit')).trim();
        const pp = Number(n.purchaseprice ?? n.cost ?? 0) || 0;
        const sp = Number(n.sellingprice ?? n.price ?? 0) || 0;
        const pegp = Number(n.pegprice30ml ?? n.pegprice ?? 0) || 0;
        const minS = numOrNull(n.minstock ?? n.lowstock);
        const critS = numOrNull(n.criticalstock);
        const foodType = parseFoodType(n.foodtype ?? n.vegnonveg ?? n.diet ?? n.type);
        let subCat = String(n.subcategory ?? n.drinktype ?? '').trim() || null;
        if (!subCat && foodType === 'veg') subCat = 'Veg';
        if (!subCat && foodType === 'nonveg') subCat = 'Non-Veg';
        const brand = n.brand ? String(n.brand).trim() : null;
        const desc = n.description ? String(n.description).trim() : null;

        const existing = q.get('SELECT * FROM products WHERE name=? COLLATE NOCASE', name);
        if (existing) {
          q.run(
            `UPDATE products SET category_id=?, sub_category=COALESCE(?,sub_category), brand=COALESCE(?,brand), description=COALESCE(?,description), unit=?, purchase_price=?, selling_price=?, peg_price=?, min_stock=COALESCE(?,min_stock), critical_stock=COALESCE(?,critical_stock), food_type=COALESCE(?,food_type), active=1 WHERE id=?`,
            catId, subCat, brand, desc, unit, pp, sp, pegp, minS, critS, foodType, existing.id,
          );
          result.updated++;
        } else {
          const id = Number(
            q.run(
              `INSERT INTO products(name, category_id, sub_category, brand, description, size_ml, unit, is_peg, purchase_price, selling_price, peg_price, min_stock, critical_stock, food_type, stock)
               VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`,
              name, catId, subCat, brand, desc, sizeMl, unit, isPeg, pp, sp, pegp, minS, critS, foodType,
            ).lastInsertRowid,
          );
          const opening = Number(n.openingstock ?? n.stock ?? 0) || 0;
          if (opening > 0) {
            const p = getProduct(id);
            moveStock({ productId: id, type: 'opening', qty: toBase(p, opening), unitCost: baseCost(p), userId: req.user.id, note: 'Excel import opening stock' });
          }
          result.created++;
        }
      }
    }
  });

  audit(req.user.id, 'product.import', 'product', null, result);
  res.json(result);
});

r.get('/products/:id', requireRole('admin', 'bartender'), (req, res) => {
  const p = getProduct(Number(req.params.id));
  if (!p) return res.status(404).json({ error: 'Not found' });
  res.json(decorate(p));
});

function productFields(b) {
  let subCat = b.sub_category ? String(b.sub_category).trim() : null;
  let foodType = parseFoodType(b.food_type);
  if (!foodType && subCat === 'Veg') foodType = 'veg';
  if (!foodType && subCat === 'Non-Veg') foodType = 'nonveg';
  if (!subCat && foodType === 'veg') subCat = 'Veg';
  if (!subCat && foodType === 'nonveg') subCat = 'Non-Veg';
  const toBit = (v) => (v === true || v === '1' || v === 1 || v === 'true' ? 1 : 0);
  const isLocal = toBit(b.is_local_purchase);
  const isRecipe = isLocal ? 0 : toBit(b.is_recipe);
  const isPeg = isRecipe || isLocal ? 0 : toBit(b.is_peg);
  const partyOnly = toBit(b.party_only);
  return [
    b.name?.trim(), numOrNull(b.category_id), subCat, b.brand || null, b.description || null,
    isRecipe || isLocal ? 0 : (Number(b.size_ml) || 0), b.unit || (isRecipe ? 'glass' : isLocal ? 'unit' : 'bottle'),
    isPeg, isRecipe, partyOnly, isLocal,
    isLocal ? 0 : (Number(b.purchase_price) || 0),
    isLocal ? 0 : (Number(b.selling_price) || 0),
    isPeg ? (Number(b.peg_price) || 0) : 0,
    numOrNull(b.min_stock), numOrNull(b.critical_stock), foodType,
  ];
}

r.post('/products', requireRole('admin'), imageUpload.single('image'), (req, res) => {
  const b = req.body;
  if (!b.name?.trim()) return res.status(400).json({ error: 'Name required' });
  const f = productFields(b);
  if (f[7] && !(f[5] > 0)) return res.status(400).json({ error: 'Peg-enabled products need a bottle size (ml)' });
  const id = Number(q.run(`INSERT INTO products(name, category_id, sub_category, brand, description, size_ml, unit, is_peg, is_recipe, party_only, is_local_purchase, purchase_price, selling_price, peg_price, min_stock, critical_stock, food_type, image, stock)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`, ...f, req.file ? `/uploads/${req.file.filename}` : b.image || null).lastInsertRowid);
  const opening = f[8] || f[10] ? 0 : (Number(b.opening_stock) || 0);
  if (opening > 0) {
    const p = getProduct(id);
    moveStock({ productId: id, type: 'opening', qty: toBase(p, opening), unitCost: baseCost(p), userId: req.user.id, note: 'Opening stock' });
  }
  audit(req.user.id, 'product.create', 'product', id, { name: b.name, is_recipe: !!f[8], party_only: !!f[9], is_local_purchase: !!f[10] });
  res.status(201).json(decorate(getProduct(id)));
});

r.put('/products/:id', requireRole('admin'), imageUpload.single('image'), (req, res) => {
  const p = getProduct(Number(req.params.id));
  if (!p) return res.status(404).json({ error: 'Not found' });
  const b = { ...p, ...req.body };
  const f = productFields(b);
  if (f[7] && !(f[5] > 0)) return res.status(400).json({ error: 'Peg-enabled products need a bottle size (ml)' });
  if (!!f[7] !== !!p.is_peg && p.stock !== 0) return res.status(400).json({ error: 'Set stock to zero before changing peg mode' });
  if (f[7] && p.is_peg && f[5] !== p.size_ml && p.stock !== 0) return res.status(400).json({ error: 'Set stock to zero before changing bottle size' });
  const image = req.file ? `/uploads/${req.file.filename}` : b.image;
  q.run(`UPDATE products SET name=?, category_id=?, sub_category=?, brand=?, description=?, size_ml=?, unit=?, is_peg=?, is_recipe=?, party_only=?, is_local_purchase=?, purchase_price=?, selling_price=?, peg_price=?, min_stock=?, critical_stock=?, food_type=?, image=?, active=? WHERE id=?`,
    ...f, image, b.active === false || b.active === '0' || b.active === 'false' || b.active === 0 ? 0 : 1, p.id);
  const priceChange = ['purchase_price', 'selling_price', 'peg_price'].filter((k) => req.body[k] != null && Number(req.body[k]) !== p[k]);
  audit(req.user.id, priceChange.length ? 'product.price_change' : 'product.update', 'product', p.id,
    { changes: Object.fromEntries(Object.keys(req.body).map((k) => [k, { from: p[k], to: req.body[k] }])) });
  res.json(decorate(getProduct(p.id)));
});

/* ---------- Configurable Recipes (for Mocktails & future composite drinks) ---------- */
r.get('/products/:id/recipe', requireRole('admin', 'bartender'), (req, res) => {
  const p = getProduct(Number(req.params.id));
  if (!p) return res.status(404).json({ error: 'Not found' });
  res.json({ product_id: p.id, name: p.name, is_recipe: !!p.is_recipe, selling_price: p.selling_price, ...computeRecipeMetrics(p.id) });
});

r.put('/products/:id/recipe', requireRole('admin'), (req, res) => {
  const pid = Number(req.params.id);
  const p = getProduct(pid);
  if (!p) return res.status(404).json({ error: 'Product not found' });
  const list = Array.isArray(req.body.ingredients) ? req.body.ingredients : [];
  const enable = req.body.is_recipe === false ? 0 : list.length > 0 ? 1 : 0;
  if (enable && list.length === 0) return res.status(400).json({ error: 'Add at least one ingredient to enable a recipe' });

  const normalized = [];
  const seen = new Set();
  for (const raw of list) {
    const ingId = Number(raw.ingredient_id);
    if (!ingId || ingId === pid) return res.status(400).json({ error: 'Invalid or self-referencing ingredient' });
    if (seen.has(ingId)) return res.status(400).json({ error: 'Duplicate ingredient in recipe' });
    const ing = getProduct(ingId);
    if (!ing) return res.status(400).json({ error: `Ingredient #${ingId} not found` });
    if (ing.is_recipe) return res.status(400).json({ error: `${ing.name} is itself a recipe product and cannot be nested as an ingredient` });
    const qty = Number(raw.qty);
    if (!(qty > 0)) return res.status(400).json({ error: `Quantity for ${ing.name} must be positive` });
    const displayQty = raw.display_qty != null && Number(raw.display_qty) > 0 ? Number(raw.display_qty) : qty;
    const displayUnit = String(raw.display_unit || (ing.is_peg ? 'ml' : ing.unit || 'unit')).trim();
    seen.add(ingId);
    normalized.push({ ingredient_id: ingId, qty, display_qty: displayQty, display_unit: displayUnit });
  }

  tx(() => {
    q.run('DELETE FROM product_recipes WHERE product_id=?', pid);
    for (const row of normalized) {
      q.run(
        'INSERT INTO product_recipes(product_id, ingredient_id, qty, display_qty, display_unit) VALUES(?,?,?,?,?)',
        pid, row.ingredient_id, row.qty, row.display_qty, row.display_unit,
      );
    }
    q.run('UPDATE products SET is_recipe=?, is_peg=CASE WHEN ?=1 THEN 0 ELSE is_peg END WHERE id=?', enable, enable, pid);
  });

  audit(req.user.id, 'product.recipe_update', 'product', pid, { is_recipe: !!enable, ingredients: normalized });
  res.json(decorate(getProduct(pid)));
});

r.post('/products/:id/favourite', requireRole('admin', 'bartender'), (req, res) => {
  q.run('UPDATE products SET favourite = 1 - favourite WHERE id=?', Number(req.params.id));
  res.json(decorate(getProduct(Number(req.params.id))));
});

r.delete('/products/:id', requireRole('admin'), (req, res) => {
  const id = Number(req.params.id);
  const used = q.get('SELECT (SELECT COUNT(*) FROM order_items WHERE product_id=?) + (SELECT COUNT(*) FROM stock_movements WHERE product_id=?) n', id, id).n;
  if (used) q.run('UPDATE products SET active=0 WHERE id=?', id);
  else q.run('DELETE FROM products WHERE id=?', id);
  audit(req.user.id, used ? 'product.deactivate' : 'product.delete', 'product', id);
  res.json({ ok: true, deactivated: !!used });
});

/* ---------- Public menu for QR ---------- */
r.get('/menu/:code', (req, res) => {
  const t = q.get('SELECT id, name, code, active FROM tables WHERE code=?', req.params.code);
  if (!t || !t.active) return res.status(404).json({ error: 'This table QR code is not active' });
  const s = getSettings();
  res.json({
    table: t,
    bar: { name: s.bar_name, logo: s.logo, currency: s.currency, peg_sizes: s.peg_sizes },
    categories: q.all('SELECT id, name FROM categories ORDER BY sort, name'),
    products: q.all(`${PRODUCT_SELECT} WHERE p.active=1 AND p.party_only=0 AND p.is_local_purchase=0 ORDER BY c.sort, p.name`).map(decorate).map(publicView),
  });
});

export default r;
