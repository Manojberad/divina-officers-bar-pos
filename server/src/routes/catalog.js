import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import crypto from 'node:crypto';
import { q, audit, UPLOAD_DIR, getSettings } from '../db.js';
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

/* ---------- Categories ---------- */
r.get('/categories', (_req, res) => res.json(q.all('SELECT * FROM categories ORDER BY sort, name')));

r.post('/categories', requireRole('admin'), (req, res) => {
  const { name, low_threshold = null, critical_threshold = null, sort = 0 } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
  if (q.get('SELECT id FROM categories WHERE name=?', name.trim())) return res.status(400).json({ error: 'Category exists' });
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

r.get('/products', optionalAuth, (req, res) => {
  const staff = req.user && ['admin', 'bartender'].includes(req.user.role);
  const rows = q.all(`${PRODUCT_SELECT} ${staff && req.query.all ? '' : 'WHERE p.active=1'} ORDER BY c.sort, p.name`).map(decorate);
  if (staff) return res.json(rows);
  // Public / customer view hides costs and exact stock
  res.json(rows.map(publicView));
});

export const publicView = (p) => ({
  id: p.id, name: p.name, category: p.category, category_id: p.category_id, brand: p.brand, description: p.description, image: p.image,
  size_ml: p.size_ml, unit: p.unit, is_peg: p.is_peg, selling_price: p.selling_price, peg_price: p.peg_price, favourite: p.favourite,
  available: p.stock_status !== 'out', active: p.active,
});

r.get('/products/:id', requireRole('admin', 'bartender'), (req, res) => {
  const p = getProduct(Number(req.params.id));
  if (!p) return res.status(404).json({ error: 'Not found' });
  res.json(decorate(p));
});

function productFields(b) {
  return [b.name?.trim(), numOrNull(b.category_id), b.brand || null, b.description || null, Number(b.size_ml) || 0, b.unit || 'bottle',
    b.is_peg === true || b.is_peg === '1' || b.is_peg === 1 || b.is_peg === 'true' ? 1 : 0,
    Number(b.purchase_price) || 0, Number(b.selling_price) || 0, Number(b.peg_price) || 0, numOrNull(b.min_stock), numOrNull(b.critical_stock)];
}

r.post('/products', requireRole('admin'), imageUpload.single('image'), (req, res) => {
  const b = req.body;
  if (!b.name?.trim()) return res.status(400).json({ error: 'Name required' });
  const f = productFields(b);
  if (f[6] && !(f[4] > 0)) return res.status(400).json({ error: 'Peg-enabled products need a bottle size (ml)' });
  const id = Number(q.run(`INSERT INTO products(name, category_id, brand, description, size_ml, unit, is_peg, purchase_price, selling_price, peg_price, min_stock, critical_stock, image, stock)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,0)`, ...f, req.file ? `/uploads/${req.file.filename}` : b.image || null).lastInsertRowid);
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
  q.run(`UPDATE products SET name=?, category_id=?, brand=?, description=?, size_ml=?, unit=?, is_peg=?, purchase_price=?, selling_price=?, peg_price=?, min_stock=?, critical_stock=?, image=?, active=? WHERE id=?`,
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
