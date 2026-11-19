import { Router } from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { q, tx, audit, notify, now } from '../db.js';
import { hashPin, verifyPin, requireRole, requireAuth } from '../auth.js';
import { broadcast } from '../events.js';

const r = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5e6 } });
const MAX_USERS = 50;
const ROLES = ['admin', 'member', 'bartender', 'customer', 'guest'];
const COLS = 'id, name, service_no, rank, mobile, email, category, role, active, approval_status, approved_by, approved_at, alcohol_limit, must_change_pin, created_at';

// Staff need a light customer list for the POS customer picker.
r.get('/lookup', requireRole('admin', 'bartender'), (_req, res) => {
  res.json(q.all("SELECT id, name, service_no, rank, role, category, alcohol_limit FROM users WHERE active=1 AND approval_status='approved' ORDER BY name"));
});

// Pending & recent guest registration requests (for Bartender approval & Admin visibility)
r.get('/guest-requests', requireRole('admin', 'bartender'), (req, res) => {
  const onlyPending = req.query.status === 'pending';
  res.json(q.all(
    `SELECT u.id, u.name, u.service_no, u.rank, u.mobile, u.approval_status, u.active, u.alcohol_limit, u.created_at, u.approved_at, ap.name approved_by_name
     FROM users u LEFT JOIN users ap ON ap.id=u.approved_by
     WHERE u.role='guest' ${onlyPending ? "AND u.approval_status='pending'" : ''}
     ORDER BY CASE u.approval_status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, u.id DESC LIMIT 100`,
  ));
});

const parseLimit = (v) => (v === '' || v == null ? null : Math.max(0, Math.floor(Number(v))));

// Bartender (or Admin) approves or declines a Guest registration -> notifies Admin
r.post('/:id/approve-guest', requireRole('admin', 'bartender'), (req, res) => {
  const id = Number(req.params.id);
  const u = q.get("SELECT * FROM users WHERE id=? AND role='guest'", id);
  if (!u) return res.status(404).json({ error: 'Guest registration not found' });
  const action = req.body?.action === 'reject' ? 'rejected' : 'approved';
  const active = action === 'approved' ? 1 : 0;
  const t = now();
  const lim = req.body?.alcohol_limit !== undefined ? parseLimit(req.body.alcohol_limit) : u.alcohol_limit;
  q.run('UPDATE users SET approval_status=?, active=?, approved_by=?, approved_at=?, alcohol_limit=? WHERE id=?', action, active, req.user.id, t, lim, id);
  const label = `${u.rank ? `${u.rank} ` : ''}${u.name} (${u.service_no})`;
  const msg = action === 'approved'
    ? `Guest ${label} approved by ${req.user.name} (${req.user.role})${lim != null ? ` · limit ${lim} pegs` : ''}`
    : `Guest ${label} declined by ${req.user.name} (${req.user.role})`;
  notify('admin', null, msg, '/users');
  audit(req.user.id, `guest.${action}`, 'user', id, { guest: label, alcohol_limit: lim, note: req.body?.note || null });
  broadcast('guest_request', { id, service_no: u.service_no, approval_status: action });
  broadcast('notification', {});
  res.json(q.get(`SELECT ${COLS} FROM users WHERE id=?`, id));
});

r.get('/', requireRole('admin'), (_req, res) => res.json(q.all(`SELECT ${COLS} FROM users ORDER BY CASE approval_status WHEN 'pending' THEN 0 ELSE 1 END, name`)));

function validate(b, id) {
  if (!b.name?.trim()) return 'Name is required';
  if (!b.service_no?.toString().trim()) return 'Service / Staff number is required';
  if (b.role && !ROLES.includes(b.role)) return 'Invalid role';
  if (b.category && !['POSTED', 'TD', 'STAFF', 'GUEST'].includes(b.category)) return 'Invalid category';
  const dup = q.get('SELECT id FROM users WHERE service_no=? COLLATE NOCASE AND id<>?', String(b.service_no).trim(), id || 0);
  if (dup) return `Service / Staff number ${b.service_no} already exists`;
  if (b.email && !/^\S+@\S+\.\S+$/.test(b.email)) return 'Invalid email';
  return null;
}

function insertUser(b) {
  const role = b.role || 'member';
  if (role !== 'guest') {
    const count = q.get("SELECT COUNT(*) n FROM users WHERE role<>'guest'").n;
    if (count >= MAX_USERS) throw Object.assign(new Error(`Maximum of ${MAX_USERS} users reached`), { status: 409 });
  }
  const sn = String(b.service_no).trim();
  const category = role === 'bartender' ? 'STAFF' : role === 'guest' ? 'GUEST' : b.category || 'POSTED';
  // Posted-in officers: initial PIN = service number. TD / Mess Staff / Guest: admin assigned PIN (fallback service/staff number).
  const pin = ['TD', 'STAFF', 'GUEST'].includes(category) && b.pin ? String(b.pin) : sn;
  const res = q.run(
    "INSERT INTO users(name, service_no, rank, mobile, email, category, role, pin_hash, alcohol_limit, must_change_pin, active, approval_status) VALUES(?,?,?,?,?,?,?,?,?,1,1,'approved')",
    b.name.trim(), sn, b.rank || null, b.mobile ? String(b.mobile) : null, b.email || null, category, role, hashPin(pin), parseLimit(b.alcohol_limit),
  );
  return Number(res.lastInsertRowid);
}

r.post('/', requireRole('admin'), (req, res) => {
  const err = validate(req.body);
  if (err) return res.status(400).json({ error: err });
  const id = insertUser(req.body);
  audit(req.user.id, 'user.create', 'user', id, { service_no: req.body.service_no, role: req.body.role, category: req.body.category, alcohol_limit: req.body.alcohol_limit });
  res.status(201).json(q.get(`SELECT ${COLS} FROM users WHERE id=?`, id));
});

r.put('/:id', requireRole('admin'), (req, res) => {
  const id = Number(req.params.id);
  const u = q.get('SELECT * FROM users WHERE id=?', id);
  if (!u) return res.status(404).json({ error: 'Not found' });
  const b = { ...u, ...req.body };
  const err = validate(b, id);
  if (err) return res.status(400).json({ error: err });
  if (u.role === 'admin' && (b.role !== 'admin' || !Number(b.active))) {
    const admins = q.get("SELECT COUNT(*) n FROM users WHERE role='admin' AND active=1 AND id<>?", id).n;
    if (!admins) return res.status(400).json({ error: 'At least one active admin is required' });
  }
  const nextSn = String(b.service_no).trim();
  const nextCategory =
    b.role === 'bartender' ? 'STAFF'
      : b.role === 'guest' ? 'GUEST'
        : ['STAFF', 'GUEST'].includes(b.category) ? 'POSTED' : b.category;
  const nextPinHash = b.pin ? hashPin(String(b.pin)) : nextSn !== u.service_no && verifyPin(u.service_no, u.pin_hash) ? hashPin(nextSn) : u.pin_hash;
  const nextLimit = req.body.alcohol_limit !== undefined ? parseLimit(req.body.alcohol_limit) : u.alcohol_limit;
  q.run('UPDATE users SET name=?, service_no=?, rank=?, mobile=?, email=?, category=?, role=?, pin_hash=?, alcohol_limit=?, active=? WHERE id=?',
    b.name.trim(), nextSn, b.rank, b.mobile, b.email, nextCategory, b.role, nextPinHash, nextLimit, Number(b.active) ? 1 : 0, id);
  audit(req.user.id, 'user.update', 'user', id, req.body);
  res.json(q.get(`SELECT ${COLS} FROM users WHERE id=?`, id));
});

r.post('/:id/reset-pin', requireRole('admin'), (req, res) => {
  const u = q.get('SELECT * FROM users WHERE id=?', Number(req.params.id));
  if (!u) return res.status(404).json({ error: 'Not found' });
  const pin = req.body?.pin ? String(req.body.pin) : u.service_no;
  q.run('UPDATE users SET pin_hash=?, must_change_pin=1 WHERE id=?', hashPin(pin), u.id);
  audit(req.user.id, 'user.reset_pin', 'user', u.id);
  res.json({ ok: true, message: req.body?.pin ? 'PIN set' : 'PIN reset to service number' });
});

r.delete('/:id', requireRole('admin'), (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'You cannot delete yourself' });
  const used = q.get('SELECT COUNT(*) n FROM orders WHERE user_id=? OR created_by=?', id, id).n;
  if (used) { q.run('UPDATE users SET active=0 WHERE id=?', id); audit(req.user.id, 'user.deactivate', 'user', id); return res.json({ ok: true, deactivated: true }); }
  q.run('DELETE FROM users WHERE id=?', id);
  audit(req.user.id, 'user.delete', 'user', id);
  res.json({ ok: true });
});

// Excel import of preloaded posted-in officers. Columns: Name, Service Number, Rank, Mobile, Email, Category, Role
r.post('/import', requireRole('admin'), upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const wb = XLSX.read(req.file.buffer);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
  const result = { created: 0, skipped: [] };
  tx(() => {
    for (const row of rows) {
      const norm = Object.fromEntries(Object.entries(row).map(([k, v]) => [k.toLowerCase().replace(/[^a-z]/g, ''), v]));
      const catUpper = String(norm.category || 'POSTED').toUpperCase();
      const b = {
        name: String(norm.name || ''), service_no: String(norm.servicenumber || norm.serviceno || ''), rank: norm.rank, mobile: norm.mobile || norm.mobilenumber,
        email: norm.email, category: catUpper === 'TD' ? 'TD' : catUpper.includes('STAFF') ? 'STAFF' : catUpper === 'GUEST' ? 'GUEST' : 'POSTED',
        role: ROLES.includes(String(norm.role || '').toLowerCase()) ? String(norm.role).toLowerCase() : 'member',
      };
      const err = validate(b);
      if (err) { result.skipped.push(`${b.service_no || '?'}: ${err}`); continue; }
      try { insertUser(b); result.created++; } catch (e) { result.skipped.push(`${b.service_no}: ${e.message}`); }
    }
  });
  audit(req.user.id, 'user.import', 'user', null, result);
  res.json(result);
});

r.get('/me/summary', requireAuth, (req, res) => {
  res.json(q.get(`SELECT COUNT(*) orders, COALESCE(SUM(total),0) spent FROM orders WHERE user_id=? AND status NOT IN ('cancelled','draft')`, req.user.id));
});

export default r;
