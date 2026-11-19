import { Router } from 'express';
import { q, tx, audit } from '../db.js';
import { requireRole } from '../auth.js';
import { getProduct, moveStock, toBase, baseCost, decorate, PRODUCT_SELECT, displayQty, HttpError } from '../services.js';

const r = Router();
const admin = requireRole('admin');
const staff = requireRole('admin', 'bartender');

export const rangeWhere = (col, from, to, where, p) => {
  if (from) { where.push(`${col}>=?`); p.push(new Date(`${from}T00:00:00`).toISOString()); }
  if (to) { where.push(`${col}<?`); p.push(new Date(new Date(`${to}T00:00:00`).getTime() + 86400e3).toISOString()); }
};

// type: purchase | wastage | complimentary | adjustment | removal
r.post('/movement', staff, (req, res) => {
  const { product_id, type, qty, ml, unit_cost, supplier, invoice, note } = req.body;
  const p = getProduct(Number(product_id));
  if (!p) throw new HttpError(404, 'Product not found');
  if (!['purchase', 'wastage', 'complimentary', 'adjustment', 'removal'].includes(type)) throw new HttpError(400, 'Invalid movement type');
  if (req.user.role === 'bartender' && !['wastage', 'complimentary'].includes(type)) throw new HttpError(403, 'Bartenders may record wastage/complimentary only');
  // Quantity in bottles/units, or ml for peg products
  let base = ml != null && ml !== '' && p.is_peg ? Number(ml) : toBase(p, Number(qty));
  if (!base || isNaN(base)) throw new HttpError(400, 'Quantity required');
  if (type !== 'adjustment') base = Math.abs(base);
  if (['wastage', 'complimentary', 'removal'].includes(type)) base = -base;
  if (['wastage', 'complimentary', 'adjustment', 'removal'].includes(type) && !note && type !== 'complimentary') throw new HttpError(400, 'A reason/note is required');
  let cost = baseCost(p);
  if (type === 'purchase' && unit_cost !== '' && unit_cost != null) {
    cost = p.is_peg ? Number(unit_cost) / p.size_ml : Number(unit_cost);
    q.run('UPDATE products SET purchase_price=? WHERE id=?', Number(unit_cost), p.id); // last purchase price
  }
  const updated = moveStock({ productId: p.id, type, qty: base, unitCost: cost, supplier, invoice, note, userId: req.user.id });
  audit(req.user.id, `stock.${type}`, 'product', p.id, { qty: base, note, supplier, invoice });
  res.json(decorate(updated));
});

r.get('/movements', staff, (req, res) => {
  const { product_id, type, from, to, limit = 1000 } = req.query;
  const where = [], p = [];
  if (product_id) { where.push('m.product_id=?'); p.push(Number(product_id)); }
  if (type) { const t = String(type).split(','); where.push(`m.type IN (${t.map(() => '?').join(',')})`); p.push(...t); }
  rangeWhere('m.at', from, to, where, p);
  const rows = q.all(`SELECT m.*, pr.name product, pr.is_peg, pr.size_ml, pr.unit, u.name user_name, o.order_no FROM stock_movements m
    JOIN products pr ON pr.id=m.product_id LEFT JOIN users u ON u.id=m.user_id LEFT JOIN orders o ON o.id=m.order_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY m.id DESC LIMIT ?`, ...p, Number(limit));
  res.json(rows.map((m) => ({ ...m, qty_display: m.is_peg && m.size_ml ? Math.round((m.qty / m.size_ml) * 1000) / 1000 : m.qty, value: Math.round(Math.abs(m.qty) * (m.unit_cost || 0) * 100) / 100 })));
});

// Physical stock count → adjust to physical, record discrepancy
r.post('/reconcile', admin, (req, res) => {
  const { items = [], note } = req.body;
  const out = tx(() => items.filter((i) => i.physical_qty !== '' && i.physical_qty != null).map((i) => {
    const p = getProduct(Number(i.product_id));
    if (!p) throw new HttpError(404, 'Product not found');
    const sys = displayQty(p);
    const phys = Number(i.physical_qty);
    const diff = Math.round((phys - sys) * 1000) / 1000;
    q.run('INSERT INTO reconciliations(product_id, system_qty, physical_qty, diff, note, user_id, at) VALUES(?,?,?,?,?,?,?)',
      p.id, sys, phys, diff, i.note || note || null, req.user.id, new Date().toISOString());
    if (diff !== 0) moveStock({ productId: p.id, type: 'reconcile', qty: toBase(p, diff), unitCost: baseCost(p), userId: req.user.id, note: i.note || note || 'Stock reconciliation' });
    return { product_id: p.id, name: p.name, system_qty: sys, physical_qty: phys, diff };
  }));
  audit(req.user.id, 'stock.reconcile', 'inventory', null, out);
  res.json(out);
});

r.get('/reconciliations', staff, (req, res) => {
  const where = [], p = [];
  rangeWhere('r.at', req.query.from, req.query.to, where, p);
  res.json(q.all(`SELECT r.*, pr.name product, pr.purchase_price, u.name user_name FROM reconciliations r JOIN products pr ON pr.id=r.product_id
    LEFT JOIN users u ON u.id=r.user_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY r.id DESC`, ...p));
});

r.get('/alerts', staff, (_req, res) => {
  const rows = q.all(`${PRODUCT_SELECT} WHERE p.active=1`).map(decorate).filter((p) => p.stock_status !== 'healthy');
  res.json(rows.sort((a, b) => a.stock_display - b.stock_display));
});

// Bulk threshold configuration – by category or selected products
r.put('/thresholds', admin, (req, res) => {
  const { category_id, product_ids, low, critical, apply_to_products } = req.body;
  const L = low === '' || low == null ? null : Number(low), C = critical === '' || critical == null ? null : Number(critical);
  if (L != null && C != null && C > L) throw new HttpError(400, 'Critical level must be below low level');
  tx(() => {
    if (category_id) {
      q.run('UPDATE categories SET low_threshold=?, critical_threshold=? WHERE id=?', L, C, Number(category_id));
      if (apply_to_products) q.run('UPDATE products SET min_stock=NULL, critical_stock=NULL WHERE category_id=?', Number(category_id));
    }
    for (const id of product_ids || []) q.run('UPDATE products SET min_stock=?, critical_stock=? WHERE id=?', L, C, Number(id));
  });
  audit(req.user.id, 'stock.thresholds', 'inventory', null, req.body);
  res.json({ ok: true });
});

export default r;
