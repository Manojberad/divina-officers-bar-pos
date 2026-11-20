import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, q } from './db.js';

// Secret is generated once per installation and stored locally.
const secretFile = path.join(DATA_DIR, '.secret');
if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(48).toString('hex'));
const SECRET = fs.readFileSync(secretFile, 'utf8').trim();

export const PRIVILEGED_OFFICER_ROLES = ['commanding_officer', 'mess_secretary', 'bar_incharge'];
export const ADMIN_ROLES = ['superadmin', 'admin', ...PRIVILEGED_OFFICER_ROLES];
export const STAFF = [...ADMIN_ROLES, 'bartender'];
export const ALL_ROLES = ['superadmin', ...PRIVILEGED_OFFICER_ROLES, 'admin', 'bartender', 'member', 'customer', 'guest'];
export const ALL_CATEGORIES = ['POSTED', 'COURSE', 'TD', 'STAFF', 'GUEST'];

export const ROLE_LABELS = {
  superadmin: 'Super Admin',
  commanding_officer: 'Commanding Officer',
  mess_secretary: 'Mess Secretary',
  bar_incharge: 'Bar Incharge',
  admin: 'Admin',
  bartender: 'Bartender',
  member: 'Mess Member',
  customer: 'TD Officer',
  guest: 'Guest',
};

export const roleLabel = (role) => ROLE_LABELS[role] || role || '';
export const isSuperAdmin = (u) => u?.role === 'superadmin';
export const isAdmin = (u) => !!u && ADMIN_ROLES.includes(u.role);
export const isStaff = (u) => !!u && STAFF.includes(u.role);

export function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pin), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPin(pin, stored) {
  const [, salt, hash] = String(stored).split('$');
  if (!salt || !hash) return false;
  const h = crypto.scryptSync(String(pin), salt, 64);
  const b = Buffer.from(hash, 'hex');
  return b.length === h.length && crypto.timingSafeEqual(h, b);
}

const b64 = (s) => Buffer.from(s).toString('base64url');
export function signToken(payload, hours = 12) {
  const body = b64(JSON.stringify({ ...payload, exp: Date.now() + hours * 3600e3 }));
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyToken(token) {
  if (!token) return null;
  const [body, sig] = String(token).split('.');
  if (!body || !sig) return null;
  const exp = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  if (sig.length !== exp.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(exp))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (p.exp < Date.now()) return null;
    return p;
  } catch { return null; }
}

export function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function tdValidity(u) {
  if (!u || u.category !== 'TD') return { ok: true };
  const today = localToday();
  if (u.td_start_date && today < u.td_start_date) {
    return { ok: false, reason: 'not_started', message: `TD membership starts on ${u.td_start_date}` };
  }
  if (u.td_end_date && today > u.td_end_date) {
    return { ok: false, reason: 'expired', message: `TD membership expired on ${u.td_end_date}. Contact Admin to extend.` };
  }
  return { ok: true };
}

/** Attach req.user if a valid token is present (does not reject). */
export function optionalAuth(req, _res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : req.query.token;
  const p = verifyToken(token);
  if (p) {
    const u = q.get('SELECT id, name, service_no, rank, branch, tors, role, category, active, approval_status, td_start_date, td_end_date, must_change_pin FROM users WHERE id=?', p.uid);
    if (u && u.active && u.approval_status === 'approved' && tdValidity(u).ok) {
      req.user = { ...u, designation: roleLabel(u.role) };
    }
  }
  next();
}

export function requireAuth(req, res, next) {
  optionalAuth(req, res, () => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    next();
  });
}

export const requireRole = (...roles) => (req, res, next) =>
  requireAuth(req, res, () => {
    const allowed = roles.flatMap((r) => (r === 'admin' ? ADMIN_ROLES : [r]));
    if (!allowed.includes(req.user.role)) return res.status(403).json({ error: 'Not authorised' });
    next();
  });

export const requireSuperAdmin = (req, res, next) =>
  requireAuth(req, res, () => {
    if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Only Super Admin can manage privileged roles' });
    next();
  });
