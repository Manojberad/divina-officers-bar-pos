import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import crypto from 'node:crypto';
import * as XLSX from 'xlsx';
import { q, tx, audit, UPLOAD_DIR, getSettings } from '../db.js';
import { requireRole, optionalAuth } from '../auth.js';
import { PRODUCT_SELECT, decorate, getProduct, moveStock, toBase, baseCost } from '../services.js';

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

/* ---------- Categories ---------- */
r.get('/categories', (_req, res) => res.json(q.all('SELECT * FROM categories ORDER BY sort, name')));

r.post('/categories', requireRole('admin'), (req, res) => {
  const { name, low_threshold = null, critical_threshold = null, sort = 0 } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
  if (q.get('SELECT id FROM categories WHERE name=? COLLATE NOCASE', name.trim())) return res.status(400).json({ error: 'Category exists' });
  const id = Number(q.run('INSERT INTO categories(name, low_threshold, critical_threshold, sort) VALUES(?,?,?,?)', name.trim(), numOrNull(low_threshold), numOrNull(critical_threshold), Number(sort) || 0).lastInsertRowid);
  audit(req.user.id, 'category.create', 'category', id, req.body);
  res.status(201).json(q.get('SELECT * FROM categories WHERE id=?', id));
});

r.put('/categories/:id', requireRole('admin'), (req, res) => {
  const c = q.get('SELECT * FROM categories WHERE id=?', Number(req.params.id));
  if (!c) return res.status(404).json({ error: 'Not found' });
  const b = { ...c, ...req.body };
  q.run('UPDATE categories SET name=?, low_threshold=?, critical_threshold=?, sort=? WHERE id=?', b.name, numOrNull(b.low_threshold), numOrNull(b.critical_threshold), Number(b.sort) || 0, c.id);
  audit(req.user.id, 'category.update', 'category', c.id, req.body);
  res.json(q.get('SELECT * FROM categories WHERE id=?', c.id));
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
  const staff = req.user && ['admin', 'bartender'].includes(req.user.role);
  const rows = q.all(`${PRODUCT_SELECT} ${staff && req.query.all ? '' : 'WHERE p.active=1'} ORDER BY c.sort, p.name`).map(decorate);
  if (staff) return res.json(rows);
  // Public / customer view hides costs and exact stock
  res.json(rows.map(publicView));
});

export const publicView = (p) => ({
  id: p.id, name: p.name, category: p.category, category_id: p.category_id, brand: p.brand, description: p.description, image: p.image,
  size_ml: p.size_ml, unit: p.unit, is_peg: p.is_peg, food_type: p.food_type || null, selling_price: p.selling_price, peg_price: p.peg_price,
  favourite: p.favourite, available: p.stock_status !== 'out', active: p.active,
});

// Download ready-to-fill Excel template for importing Products & Categories
r.get('/products/template', requireRole('admin'), (_req, res) => {
  const wb = XLSX.utils.book_new();
  const prodRows = [
    {
      Name: 'Paneer Tikka',
      Category: 'From the Kitchen',
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
      Category: 'From the Kitchen',
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
    { Name: 'Alcohol', 'Low Threshold': 3, 'Critical Threshold': 1, Sort: 1 },
    { Name: 'Soft Drinks', 'Low Threshold': 24, 'Critical Threshold': 10, Sort: 2 },
    { Name: 'Packaged Snacks', 'Low Threshold': 10, 'Critical Threshold': 4, Sort: 3 },
    { Name: 'From the Kitchen', 'Low Threshold': 10, 'Critical Threshold': 4, Sort: 4 },
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
        const brand = n.brand ? String(n.brand).trim() : null;
        const desc = n.description ? String(n.description).trim() : null;

        const existing = q.get('SELECT * FROM products WHERE name=? COLLATE NOCASE', name);
        if (existing) {
          q.run(
            `UPDATE products SET category_id=?, brand=COALESCE(?,brand), description=COALESCE(?,description), unit=?, purchase_price=?, selling_price=?, peg_price=?, min_stock=COALESCE(?,min_stock), critical_stock=COALESCE(?,critical_stock), food_type=COALESCE(?,food_type), active=1 WHERE id=?`,
            catId, brand, desc, unit, pp, sp, pegp, minS, critS, foodType, existing.id,
          );
          result.updated++;
        } else {
          const id = Number(
            q.run(
              `INSERT INTO products(name, category_id, brand, description, size_ml, unit, is_peg, purchase_price, selling_price, peg_price, min_stock, critical_stock, food_type, stock)
               VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,0)`,
              name, catId, brand, desc, sizeMl, unit, isPeg, pp, sp, pegp, minS, critS, foodType,
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
  return [b.name?.trim(), numOrNull(b.category_id), b.brand || null, b.description || null, Number(b.size_ml) || 0, b.unit || 'bottle',
    b.is_peg === true || b.is_peg === '1' || b.is_peg === 1 || b.is_peg === 'true' ? 1 : 0,
    Number(b.purchase_price) || 0, Number(b.selling_price) || 0, Number(b.peg_price) || 0, numOrNull(b.min_stock), numOrNull(b.critical_stock), parseFoodType(b.food_type)];
}

r.post('/products', requireRole('admin'), imageUpload.single('image'), (req, res) => {
  const b = req.body;
  if (!b.name?.trim()) return res.status(400).json({ error: 'Name required' });
  const f = productFields(b);
  if (f[6] && !(f[4] > 0)) return res.status(400).json({ error: 'Peg-enabled products need a bottle size (ml)' });
  const id = Number(q.run(`INSERT INTO products(name, category_id, brand, description, size_ml, unit, is_peg, purchase_price, selling_price, peg_price, min_stock, critical_stock, food_type, image, stock)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`, ...f, req.file ? `/uploads/${req.file.filename}` : b.image || null).lastInsertRowid);
  const opening = Number(b.opening_stock) || 0;
  if (opening > 0) {
    const p = getProduct(id);
    moveStock({ productId: id, type: 'opening', qty: toBase(p, opening), unitCost: baseCost(p), userId: req.user.id, note: 'Opening stock' });
  }
  audit(req.user.id, 'product.create', 'product', id, { name: b.name });
  res.status(201).json(decorate(getProduct(id)));
});

r.put('/products/:id', requireRole('admin'), imageUpload.single('image'), (req, res) => {
  const p = getProduct(Number(req.params.id));
  if (!p) return res.status(404).json({ error: 'Not found' });
  const b = { ...p, ...req.body };
  const f = productFields(b);
  if (f[6] && !(f[4] > 0)) return res.status(400).json({ error: 'Peg-enabled products need a bottle size (ml)' });
  if (!!f[6] !== !!p.is_peg && p.stock !== 0) return res.status(400).json({ error: 'Set stock to zero before changing peg mode' });
  if (f[6] && p.is_peg && f[4] !== p.size_ml && p.stock !== 0) return res.status(400).json({ error: 'Set stock to zero before changing bottle size' });
  const image = req.file ? `/uploads/${req.file.filename}` : b.image;
  q.run(`UPDATE products SET name=?, category_id=?, brand=?, description=?, size_ml=?, unit=?, is_peg=?, purchase_price=?, selling_price=?, peg_price=?, min_stock=?, critical_stock=?, food_type=?, image=?, active=? WHERE id=?`,
    ...f, image, b.active === false || b.active === '0' || b.active === 'false' || b.active === 0 ? 0 : 1, p.id);
  const priceChange = ['purchase_price', 'selling_price', 'peg_price'].filter((k) => req.body[k] != null && Number(req.body[k]) !== p[k]);
  audit(req.user.id, priceChange.length ? 'product.price_change' : 'product.update', 'product', p.id,
    { changes: Object.fromEntries(Object.keys(req.body).map((k) => [k, { from: p[k], to: req.body[k] }])) });
  res.json(decorate(getProduct(p.id)));
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
    products: q.all(`${PRODUCT_SELECT} WHERE p.active=1 ORDER BY c.sort, p.name`).map(decorate).map(publicView),
  });
});

export default r;
