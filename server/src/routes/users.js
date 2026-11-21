import { Router } from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { q, tx, audit, notify, now } from '../db.js';
import {
  hashPin, verifyPin, requireRole, requireSuperAdmin, requireAuth, localToday,
  ALL_ROLES, ALL_CATEGORIES, ADMIN_ROLES, PRIVILEGED_OFFICER_ROLES, isSuperAdmin, roleLabel,
  revokeUserSessions,
} from '../auth.js';
import { broadcast } from '../events.js';

const r = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5e6 } });
const MAX_USERS = 250;
const COLS = 'id, name, service_no, rank, branch, tors, mobile, email, category, role, active, approval_status, approved_by, approved_at, alcohol_limit, td_start_date, td_end_date, must_change_pin, created_at';

const withDesignation = (u) => (u ? { ...u, designation: roleLabel(u.role) } : u);
const cleanServiceNo = (sn) => {
  const s = String(sn ?? '').trim();
  // Strip trailing alphabetic check suffix like "27415-T" -> "27415"
  return /^\d+-[A-Za-z]+$/.test(s) ? s.replace(/-[A-Za-z]+$/, '') : s;
};

// Staff need a light customer list for the POS customer picker.
r.get('/lookup', requireRole('admin', 'bartender'), (_req, res) => {
  const t = localToday();
  res.json(q.all(
    `SELECT id, name, service_no, rank, branch, role, category, alcohol_limit, td_start_date, td_end_date
     FROM users
     WHERE active=1 AND approval_status='approved'
       AND (category<>'TD' OR ((td_start_date IS NULL OR td_start_date<=?) AND (td_end_date IS NULL OR td_end_date>=?)))
     ORDER BY name`,
    t, t,
  ).map(withDesignation));
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
  q.run('UPDATE users SET approval_status=?, active=?, approved_by=?, approved_at=?, alcohol_limit=?, guest_claim_token=CASE WHEN ?=0 THEN NULL ELSE guest_claim_token END WHERE id=?', action, active, req.user.id, t, lim, active, id);
  if (!active) revokeUserSessions(id);
  const label = `${u.rank ? `${u.rank} ` : ''}${u.name} (${u.service_no})`;
  const msg = action === 'approved'
    ? `Guest ${label} approved by ${req.user.name} (${roleLabel(req.user.role)})${lim != null ? ` · limit ${lim} pegs` : ''}`
    : `Guest ${label} declined by ${req.user.name} (${roleLabel(req.user.role)})`;
  notify('admin', null, msg, '/users');
  audit(req.user.id, `guest.${action}`, 'user', id, { guest: label, alcohol_limit: lim, note: req.body?.note || null });
  broadcast('guest_request', { id, service_no: u.service_no, approval_status: action });
  broadcast('notification', {});
  res.json(withDesignation(q.get(`SELECT ${COLS} FROM users WHERE id=?`, id)));
});

r.get('/', requireRole('admin'), (_req, res) => res.json(q.all(
  `SELECT ${COLS} FROM users ORDER BY
    CASE approval_status WHEN 'pending' THEN 0 ELSE 1 END,
    CASE role
      WHEN 'superadmin' THEN 0
      WHEN 'commanding_officer' THEN 1
      WHEN 'mess_secretary' THEN 2
      WHEN 'bar_incharge' THEN 3
      WHEN 'admin' THEN 4
      WHEN 'bartender' THEN 5
      ELSE 6
    END,
    name`,
).map(withDesignation)));

function validate(b, id) {
  if (!b.name?.trim()) return 'Name is required';
  if (!b.service_no?.toString().trim()) return 'Service / Staff number is required';
  if (b.role && !ALL_ROLES.includes(b.role)) return 'Invalid role';
  if (b.category && !ALL_CATEGORIES.includes(b.category)) return 'Invalid category';
  const sn = cleanServiceNo(b.service_no);
  const dup = q.get('SELECT id FROM users WHERE service_no=? COLLATE NOCASE AND id<>?', sn, id || 0);
  if (dup) return `Service / Staff number ${sn} already exists`;
  if (b.email && !/^\S+@\S+\.\S+$/.test(b.email)) return 'Invalid email';
  if (b.td_start_date && !/^\d{4}-\d{2}-\d{2}$/.test(String(b.td_start_date))) return 'Invalid TD enrollment date';
  if (b.td_end_date && !/^\d{4}-\d{2}-\d{2}$/.test(String(b.td_end_date))) return 'Invalid TD completion date';
  if (b.td_start_date && b.td_end_date && String(b.td_end_date) < String(b.td_start_date)) return 'TD completion date must be on or after enrollment date';
  return null;
}

function insertUser(b) {
  const role = b.role || 'member';
  if (role !== 'guest') {
    const count = q.get("SELECT COUNT(*) n FROM users WHERE role<>'guest'").n;
    if (count >= MAX_USERS) throw Object.assign(new Error(`Maximum of ${MAX_USERS} users reached`), { status: 409 });
  }
  const sn = cleanServiceNo(b.service_no);
  const category = role === 'bartender' ? 'STAFF' : role === 'guest' ? 'GUEST' : b.category || 'POSTED';
  // Posted-in & Course officers: initial PIN = service number. TD / Mess Staff / Guest: admin assigned PIN (fallback service/staff number).
  const pin = ['TD', 'STAFF', 'GUEST'].includes(category) && b.pin ? String(b.pin) : sn;
  const tdStart = category === 'TD' && b.td_start_date ? String(b.td_start_date) : null;
  const tdEnd = category === 'TD' && b.td_end_date ? String(b.td_end_date) : null;
  const res = q.run(
    "INSERT INTO users(name, service_no, rank, branch, tors, mobile, email, category, role, pin_hash, alcohol_limit, td_start_date, td_end_date, must_change_pin, active, approval_status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,1,1,'approved')",
    b.name.trim(), sn, b.rank || null, b.branch ? String(b.branch).trim() : null, b.tors ? String(b.tors).trim() : null,
    b.mobile ? String(b.mobile) : null, b.email || null, category, role, hashPin(pin), parseLimit(b.alcohol_limit), tdStart, tdEnd,
  );
  return Number(res.lastInsertRowid);
}

r.post('/', requireRole('admin'), (req, res) => {
  const requestedRole = req.body?.role || 'member';
  if (ADMIN_ROLES.includes(requestedRole) && !isSuperAdmin(req.user)) {
    return res.status(403).json({ error: 'Only Super Admin can assign Super Admin, Commanding Officer, Mess Secretary, Bar Incharge, or Admin roles' });
  }
  const err = validate(req.body);
  if (err) return res.status(400).json({ error: err });
  const id = insertUser(req.body);
  audit(req.user.id, 'user.create', 'user', id, { service_no: cleanServiceNo(req.body.service_no), role: requestedRole, category: req.body.category, alcohol_limit: req.body.alcohol_limit, td_start_date: req.body.td_start_date, td_end_date: req.body.td_end_date });
  res.status(201).json(withDesignation(q.get(`SELECT ${COLS} FROM users WHERE id=?`, id)));
});

// Super Admin quick role assignment for Mess Appointments (Commanding Officer, Mess Secretary, Bar Incharge) & Super Admin
r.post('/:id/assign-role', requireSuperAdmin, (req, res) => {
  const id = Number(req.params.id);
  const u = q.get('SELECT * FROM users WHERE id=?', id);
  if (!u) return res.status(404).json({ error: 'User not found' });
  const role = String(req.body?.role || '').trim();
  if (!ALL_ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
  if (u.role === 'superadmin' && role !== 'superadmin') {
    const supers = q.get("SELECT COUNT(*) n FROM users WHERE role='superadmin' AND active=1 AND id<>?", id).n;
    if (!supers) return res.status(400).json({ error: 'At least one active Super Admin is required' });
  }
  const replaceExisting = req.body?.replace_existing !== false && PRIVILEGED_OFFICER_ROLES.includes(role);
  tx(() => {
    if (replaceExisting) {
      const prev = q.all('SELECT id, name, service_no FROM users WHERE role=? AND id<>?', role, id);
      if (prev.length) {
        q.run("UPDATE users SET role='member' WHERE role=? AND id<>?", role, id);
        for (const p of prev) {
          audit(req.user.id, 'user.role_revoked', 'user', p.id, { from: role, to: 'member', replaced_by: u.service_no });
        }
      }
    }
    q.run('UPDATE users SET role=? WHERE id=?', role, id);
    audit(req.user.id, 'user.role_assign', 'user', id, { from: u.role, to: role, designation: roleLabel(role) });
  });
  res.json(withDesignation(q.get(`SELECT ${COLS} FROM users WHERE id=?`, id)));
});

r.put('/:id', requireRole('admin'), (req, res) => {
  const id = Number(req.params.id);
  const u = q.get('SELECT * FROM users WHERE id=?', id);
  if (!u) return res.status(404).json({ error: 'Not found' });
  const b = { ...u, ...req.body };
  const err = validate(b, id);
  if (err) return res.status(400).json({ error: err });

  // Only Super Admin can manage privileged/admin roles or modify a Super Admin account
  const roleChanged = b.role !== u.role;
  const touchesPrivileged = ADMIN_ROLES.includes(u.role) || ADMIN_ROLES.includes(b.role);
  if (!isSuperAdmin(req.user)) {
    if (u.role === 'superadmin') return res.status(403).json({ error: 'Only Super Admin can modify a Super Admin account' });
    if (roleChanged && touchesPrivileged) {
      return res.status(403).json({ error: 'Only Super Admin can assign or change Commanding Officer, Mess Secretary, Bar Incharge, Admin, or Super Admin roles' });
    }
  }

  if (u.role === 'superadmin' && (b.role !== 'superadmin' || !Number(b.active))) {
    const supers = q.get("SELECT COUNT(*) n FROM users WHERE role='superadmin' AND active=1 AND id<>?", id).n;
    if (!supers) return res.status(400).json({ error: 'At least one active Super Admin is required' });
  }
  if (ADMIN_ROLES.includes(u.role) && (!ADMIN_ROLES.includes(b.role) || !Number(b.active))) {
    const ph = ADMIN_ROLES.map(() => '?').join(',');
    const admins = q.get(`SELECT COUNT(*) n FROM users WHERE role IN (${ph}) AND active=1 AND id<>?`, ...ADMIN_ROLES, id).n;
    if (!admins) return res.status(400).json({ error: 'At least one active admin is required' });
  }

  const nextSn = cleanServiceNo(b.service_no);
  const nextCategory =
    b.role === 'bartender' ? 'STAFF'
      : b.role === 'guest' ? 'GUEST'
        : b.role === 'superadmin' && u.category === 'STAFF' && b.category === 'STAFF' ? 'STAFF'
          : ['STAFF', 'GUEST'].includes(b.category) && !['bartender', 'guest', 'superadmin'].includes(b.role) ? 'POSTED'
            : b.category;
  const nextPinHash = b.pin ? hashPin(String(b.pin)) : nextSn !== u.service_no && verifyPin(u.service_no, u.pin_hash) ? hashPin(nextSn) : u.pin_hash;
  const nextLimit = req.body.alcohol_limit !== undefined ? parseLimit(req.body.alcohol_limit) : u.alcohol_limit;
  const tdStart = nextCategory === 'TD' ? (b.td_start_date ? String(b.td_start_date) : null) : null;
  const tdEnd = nextCategory === 'TD' ? (b.td_end_date ? String(b.td_end_date) : null) : null;
  const isActive = Number(b.active) ? 1 : 0;
  q.run('UPDATE users SET name=?, service_no=?, rank=?, branch=?, tors=?, mobile=?, email=?, category=?, role=?, pin_hash=?, alcohol_limit=?, td_start_date=?, td_end_date=?, active=?, guest_claim_token=CASE WHEN ?=0 THEN NULL ELSE guest_claim_token END WHERE id=?',
    b.name.trim(), nextSn, b.rank || null, b.branch ? String(b.branch).trim() : null, b.tors ? String(b.tors).trim() : null,
    b.mobile || null, b.email || null, nextCategory, b.role, nextPinHash, nextLimit, tdStart, tdEnd, isActive, isActive, id);
  if (!isActive) revokeUserSessions(id);
  audit(req.user.id, 'user.update', 'user', id, req.body);
  res.json(withDesignation(q.get(`SELECT ${COLS} FROM users WHERE id=?`, id)));
});

// Admin extends a TD Officer's membership by custom days or sets a new completion date (also reactivates if expired)
r.post('/:id/extend-td', requireRole('admin'), (req, res) => {
  const id = Number(req.params.id);
  const u = q.get("SELECT * FROM users WHERE id=? AND category='TD'", id);
  if (!u) return res.status(404).json({ error: 'TD Officer not found' });
  const today = localToday();
  let nextEnd = null;
  const days = req.body?.days != null && req.body.days !== '' ? Math.floor(Number(req.body.days)) : null;
  if (req.body?.td_end_date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(req.body.td_end_date))) return res.status(400).json({ error: 'Invalid date' });
    nextEnd = String(req.body.td_end_date);
    if (u.td_start_date && nextEnd < u.td_start_date) return res.status(400).json({ error: 'Completion date cannot be before enrollment date' });
  } else if (days && days > 0) {
    const baseStr = u.td_end_date && u.td_end_date >= today ? u.td_end_date : today;
    const [y, m, d] = baseStr.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + days));
    nextEnd = dt.toISOString().slice(0, 10);
  } else {
    return res.status(400).json({ error: 'Provide positive custom days or a new completion date' });
  }
  const nextStart = u.td_start_date || today;
  q.run('UPDATE users SET td_start_date=?, td_end_date=?, active=1 WHERE id=?', nextStart, nextEnd, id);
  audit(req.user.id, 'user.td_extend', 'user', id, { from: u.td_end_date, to: nextEnd, days });
  res.json(withDesignation(q.get(`SELECT ${COLS} FROM users WHERE id=?`, id)));
});

r.post('/:id/reset-pin', requireRole('admin'), (req, res) => {
  const u = q.get('SELECT * FROM users WHERE id=?', Number(req.params.id));
  if (!u) return res.status(404).json({ error: 'Not found' });
  if (u.role === 'superadmin' && !isSuperAdmin(req.user)) {
    return res.status(403).json({ error: 'Only Super Admin can reset a Super Admin PIN' });
  }
  const pin = req.body?.pin ? String(req.body.pin) : u.service_no;
  q.run('UPDATE users SET pin_hash=?, must_change_pin=1 WHERE id=?', hashPin(pin), u.id);
  audit(req.user.id, 'user.reset_pin', 'user', u.id);
  res.json({ ok: true, message: req.body?.pin ? 'PIN set' : 'PIN reset to service number' });
});

r.delete('/:id', requireRole('admin'), (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'You cannot delete yourself' });
  const u = q.get('SELECT * FROM users WHERE id=?', id);
  if (!u) return res.status(404).json({ error: 'Not found' });
  if (ADMIN_ROLES.includes(u.role) && !isSuperAdmin(req.user)) {
    return res.status(403).json({ error: 'Only Super Admin can remove privileged officers or Super Admins' });
  }
  const used = q.get('SELECT COUNT(*) n FROM orders WHERE user_id=? OR created_by=?', id, id).n;
  if (used) {
    q.run('UPDATE users SET active=0, guest_claim_token=NULL WHERE id=?', id);
    revokeUserSessions(id);
    audit(req.user.id, 'user.deactivate', 'user', id);
    return res.json({ ok: true, deactivated: true });
  }
  revokeUserSessions(id);
  q.run('DELETE FROM users WHERE id=?', id);
  audit(req.user.id, 'user.delete', 'user', id);
  res.json({ ok: true });
});

// Excel import of officers. Columns: Name, Service Number, Rank, Branch, TORS, Mobile, Email, Category / List Type, Role
r.post('/import', requireRole('admin'), upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const wb = XLSX.read(req.file.buffer);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
  const result = { created: 0, skipped: [] };
  tx(() => {
    for (const row of rows) {
      const norm = Object.fromEntries(Object.entries(row).map(([k, v]) => [k.toLowerCase().replace(/[^a-z]/g, ''), v]));
      const catRaw = String(norm.category || norm.listtype || 'POSTED').toUpperCase();
      const category = catRaw.includes('COURSE') ? 'COURSE'
        : catRaw === 'TD' ? 'TD'
          : catRaw.includes('STAFF') ? 'STAFF'
            : catRaw === 'GUEST' ? 'GUEST'
              : 'POSTED';
      const rawRole = String(norm.role || '').trim().toLowerCase().replace(/\s+/g, '_');
      let role = ALL_ROLES.includes(rawRole) ? rawRole : (category === 'TD' ? 'customer' : category === 'STAFF' ? 'bartender' : category === 'GUEST' ? 'guest' : 'member');
      if (ADMIN_ROLES.includes(role) && !isSuperAdmin(req.user)) role = 'member';
      const b = {
        name: String(norm.name || ''),
        service_no: cleanServiceNo(norm.servicenumber || norm.serviceno || ''),
        rank: norm.rank,
        branch: norm.branch,
        tors: norm.tors,
        mobile: norm.mobile || norm.mobilenumber,
        email: norm.email,
        category,
        role,
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
