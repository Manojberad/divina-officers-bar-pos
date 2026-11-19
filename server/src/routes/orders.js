import { Router } from 'express';
import { q } from '../db.js';
import { requireAuth, optionalAuth } from '../auth.js';
import { createOrder, transition, approve, loadOrder, HttpError } from '../services.js';

const r = Router();
const STAFF = ['admin', 'bartender'];

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
  const byOrder = {};
  items.forEach((i) => (byOrder[i.order_id] ||= []).push(i));
  res.json(rows.map((o) => ({ ...o, items: byOrder[o.id] || [] })));
});

r.get('/:id', requireAuth, (req, res) => {
  const o = loadOrder(Number(req.params.id));
  if (!o || (!STAFF.includes(req.user.role) && o.user_id !== req.user.id)) return res.status(404).json({ error: 'Not found' });
  o.events = q.all('SELECT e.*, u.name user_name FROM order_events e LEFT JOIN users u ON u.id=e.user_id WHERE order_id=? ORDER BY e.id', o.id);
  res.json(o);
});

// Orders may be created by staff (POS), logged-in members/customers or via QR menu (login required to order).
r.post('/', optionalAuth, (req, res) => {
  if (!req.user) throw new HttpError(401, 'Please log in to place an order');
  const { order, duplicate } = createOrder(req.body || {}, req.user);
  res.status(duplicate ? 200 : 201).json({ ...order, duplicate });
});

r.post('/:id/status', requireAuth, (req, res) => {
  res.json(transition(Number(req.params.id), req.body.status, req.user, req.body.note, req.body.payment_mode, req.body.payment_ref));
});

r.post('/:id/approve', requireAuth, (req, res) => res.json(approve(Number(req.params.id), req.user, 'approve')));
r.post('/:id/dispute', requireAuth, (req, res) => res.json(approve(Number(req.params.id), req.user, 'dispute', req.body.note)));

export default r;
