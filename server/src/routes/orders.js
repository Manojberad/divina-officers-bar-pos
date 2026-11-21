import { Router } from 'express';
import { q, now, audit } from '../db.js';
import { requireAuth, optionalAuth, requireRole, STAFF } from '../auth.js';
import { createOrder, editOrderItems, transition, approve, loadOrder, getProduct, decorate, HttpError } from '../services.js';

const r = Router();

// Customer-facing bills must never expose purchase_cost or profit margins
function sanitizeOrder(o, user) {
  if (!o || (user && STAFF.includes(user.role))) return o;
  return {
    ...o,
    items: (o.items || []).map(({ purchase_cost, ...rest }) => rest),
  };
}

/* ---------- Member & Guest Favorite Orders (Repeat Orders) ---------- */
function hydrateFavorite(row) {
  let rawItems = [];
  try { rawItems = JSON.parse(row.items_json || '[]'); } catch { rawItems = []; }
  const items = rawItems.map((it) => {
    const p = getProduct(Number(it.product_id));
    const d = p ? decorate(p) : null;
    const serve = it.serve_type || (p?.is_peg ? 'peg' : 'unit');
    const pegMl = serve === 'peg' ? Number(it.peg_ml || 30) : null;
    const qty = Number(it.qty) || 1;
    const unitPrice = p
      ? serve === 'peg'
        ? Math.round((p.peg_price * (pegMl || 30)) / 30 * 100) / 100
        : p.selling_price
      : 0;
    return {
      product_id: Number(it.product_id),
      name: p?.name || it.name || 'Unavailable item',
      image: p?.image || null,
      serve_type: serve,
      peg_ml: pegMl,
      qty,
      unit_price: unitPrice,
      line_total: Math.round(unitPrice * qty * 100) / 100,
      available: !!d && d.active && d.stock_status !== 'out',
    };
  });
  const live_total = Math.round(items.reduce((s, i) => s + i.line_total, 0) * 100) / 100;
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    notes: row.notes || '',
    items,
    live_total,
    all_available: items.length > 0 && items.every((i) => i.available),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

r.get('/favorites', requireAuth, (req, res) => {
  const rows = q.all('SELECT * FROM favorite_orders WHERE user_id=? ORDER BY updated_at DESC, id DESC', req.user.id);
  res.json(rows.map(hydrateFavorite));
});

r.post('/favorites', requireAuth, (req, res) => {
  const name = String(req.body?.name || '').trim();
  const items = req.body?.items;
  if (!name) return res.status(400).json({ error: 'Give your favorite order a name (e.g. Evening Usual)' });
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'Add at least one item' });
  const clean = items.map((it) => ({
    product_id: Number(it.product_id),
    serve_type: it.serve_type || 'unit',
    peg_ml: it.serve_type === 'peg' ? Number(it.peg_ml || 30) : null,
    qty: Math.max(1, Number(it.qty) || 1),
  }));
  const t = now();
  const id = Number(
    q.run(
      'INSERT INTO favorite_orders(user_id, name, items_json, notes, created_at, updated_at) VALUES(?,?,?,?,?,?)',
      req.user.id, name, JSON.stringify(clean), req.body?.notes ? String(req.body.notes).trim() : null, t, t,
    ).lastInsertRowid,
  );
  audit(req.user.id, 'favorite_order.create', 'favorite_order', id, { name, count: clean.length });
  res.status(201).json(hydrateFavorite(q.get('SELECT * FROM favorite_orders WHERE id=?', id)));
});

r.put('/favorites/:id', requireAuth, (req, res) => {
  const row = q.get('SELECT * FROM favorite_orders WHERE id=? AND user_id=?', Number(req.params.id), req.user.id);
  if (!row) return res.status(404).json({ error: 'Favorite order not found' });
  const name = req.body?.name !== undefined ? String(req.body.name).trim() : row.name;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  let itemsJson = row.items_json;
  if (req.body?.items !== undefined) {
    if (!Array.isArray(req.body.items) || !req.body.items.length) return res.status(400).json({ error: 'At least one item is required' });
    itemsJson = JSON.stringify(req.body.items.map((it) => ({
      product_id: Number(it.product_id),
      serve_type: it.serve_type || 'unit',
      peg_ml: it.serve_type === 'peg' ? Number(it.peg_ml || 30) : null,
      qty: Math.max(1, Number(it.qty) || 1),
    })));
  }
  const notes = req.body?.notes !== undefined ? (String(req.body.notes).trim() || null) : row.notes;
  q.run('UPDATE favorite_orders SET name=?, items_json=?, notes=?, updated_at=? WHERE id=?', name, itemsJson, notes, now(), row.id);
  res.json(hydrateFavorite(q.get('SELECT * FROM favorite_orders WHERE id=?', row.id)));
});

r.delete('/favorites/:id', requireAuth, (req, res) => {
  const row = q.get('SELECT id FROM favorite_orders WHERE id=? AND user_id=?', Number(req.params.id), req.user.id);
  if (!row) return res.status(404).json({ error: 'Favorite order not found' });
  q.run('DELETE FROM favorite_orders WHERE id=?', row.id);
  res.json({ ok: true });
});

r.post('/favorites/:id/reorder', requireAuth, (req, res) => {
  const row = q.get('SELECT * FROM favorite_orders WHERE id=? AND user_id=?', Number(req.params.id), req.user.id);
  if (!row) return res.status(404).json({ error: 'Favorite order not found' });
  let items = [];
  try { items = JSON.parse(row.items_json || '[]'); } catch { items = []; }
  const { order } = createOrder(
    {
      items,
      user_id: req.user.id,
      table_id: req.body?.table_id || undefined,
      table_code: req.body?.table_code || undefined,
      notes: req.body?.notes || row.notes || `Repeat: ${row.name}`,
      source: 'favorite',
    },
    req.user,
  );
  res.status(201).json(order);
});

/* ---------- Orders ---------- */
r.get('/', requireAuth, (req, res) => {
  const { status, from, to, user_id, approval, limit = 300, search } = req.query;
  const where = [], p = [];
  if (!STAFF.includes(req.user.role)) { where.push('o.user_id=?'); p.push(req.user.id); }
  else if (user_id) { where.push('o.user_id=?'); p.push(Number(user_id)); }
  if (status) { const s = String(status).split(','); where.push(`o.status IN (${s.map(() => '?').join(',')})`); p.push(...s); }
  if (approval) { where.push('o.approval_status=?'); p.push(approval); }
  if (from) { where.push('o.created_at>=?'); p.push(new Date(`${from}T00:00:00`).toISOString()); }
  if (to) { where.push('o.created_at<?'); p.push(new Date(new Date(`${to}T00:00:00`).getTime() + 86400e3).toISOString()); }
  if (search) { where.push('(o.order_no LIKE ? OR u.name LIKE ? OR t.name LIKE ?)'); p.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  const rows = q.all(`SELECT o.*, u.name customer_name, u.rank customer_rank, u.service_no customer_service_no, u.role customer_role, u.category customer_category, t.name table_name, cb.name created_by_name
    FROM orders o LEFT JOIN users u ON u.id=o.user_id LEFT JOIN tables t ON t.id=o.table_id LEFT JOIN users cb ON cb.id=o.created_by
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY o.id DESC LIMIT ?`, ...p, Number(limit));
  const items = rows.length ? q.all(`SELECT * FROM order_items WHERE order_id IN (${rows.map(() => '?').join(',')})`, ...rows.map((o) => o.id)) : [];
  const isStaffUser = STAFF.includes(req.user.role);
  const byOrder = {};
  items.forEach((i) => {
    const clean = isStaffUser ? i : (({ purchase_cost, ...rest }) => rest)(i);
    (byOrder[i.order_id] ||= []).push(clean);
  });
  res.json(rows.map((o) => ({ ...o, items: byOrder[o.id] || [] })));
});

r.get('/:id', requireAuth, (req, res) => {
  const o = loadOrder(Number(req.params.id));
  if (!o || (!STAFF.includes(req.user.role) && o.user_id !== req.user.id)) return res.status(404).json({ error: 'Not found' });
  o.events = q.all('SELECT e.*, u.name user_name FROM order_events e LEFT JOIN users u ON u.id=e.user_id WHERE order_id=? ORDER BY e.id', o.id);
  res.json(sanitizeOrder(o, req.user));
});

// Orders may be created by staff (Products/POS), logged-in members/customers or via QR menu.
r.post('/', optionalAuth, (req, res) => {
  if (!req.user) throw new HttpError(401, 'Please log in to place an order');
  const { order, duplicate } = createOrder(req.body || {}, req.user);
  res.status(duplicate ? 200 : 201).json({ ...sanitizeOrder(order, req.user), duplicate });
});

r.put('/:id/items', requireRole('admin', 'bartender'), (req, res) => {
  res.json(editOrderItems(Number(req.params.id), req.body?.items, req.body?.notes, req.user, req.body?.reason));
});

r.post('/:id/status', requireAuth, (req, res) => {
  res.json(transition(Number(req.params.id), req.body.status, req.user, req.body.note, req.body.payment_mode, req.body.payment_ref));
});

r.post('/:id/approve', requireAuth, (req, res) => res.json(approve(Number(req.params.id), req.user, 'approve')));
r.post('/:id/dispute', requireAuth, (req, res) => res.json(approve(Number(req.params.id), req.user, 'dispute', req.body.note)));

export default r;
