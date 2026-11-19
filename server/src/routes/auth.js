import { Router } from 'express';
import { q, audit, notify, now } from '../db.js';
import { hashPin, verifyPin, signToken, requireAuth } from '../auth.js';
import { broadcast } from '../events.js';
import { getAlcoholUsage } from '../services.js';

const r = Router();
const attempts = new Map(); // simple brute-force throttle per key

r.post('/login', (req, res) => {
  const { service_no, pin, mode } = req.body || {};
  const rawPin = String(pin ?? service_no ?? '').trim();
  if (!rawPin) return res.status(400).json({ error: 'Please enter your PIN' });

  const key = String(service_no || `${mode || 'any'}:${rawPin.slice(0, 2)}`).toLowerCase();
  const a = attempts.get(key) || { n: 0, until: 0 };
  if (a.until > Date.now()) return res.status(429).json({ error: 'Too many attempts. Try again in a minute.' });

  let u = null;
  const allowedRoles =
    mode === 'admin'
      ? ['admin', 'bartender']
      : mode === 'guest'
        ? ['guest']
        : mode === 'member'
          ? ['member', 'customer', 'guest']
          : ['admin', 'bartender', 'member', 'customer', 'guest'];

  if (service_no) {
    const candidate = q.get('SELECT * FROM users WHERE service_no=? COLLATE NOCASE', String(service_no).trim());
    if (candidate && allowedRoles.includes(candidate.role) && verifyPin(rawPin, candidate.pin_hash)) {
      if (candidate.role === 'guest' && candidate.approval_status === 'pending') {
        return res.status(403).json({ error: 'Your guest registration is pending bartender approval' });
      }
      if (candidate.role === 'guest' && candidate.approval_status === 'rejected') {
        return res.status(403).json({ error: 'Your guest registration was declined by the bartender' });
      }
      if (candidate.active && candidate.approval_status === 'approved') u = candidate;
    }
  } else {
    // PIN-only fallback
    const placeholders = allowedRoles.map(() => '?').join(',');
    const direct = q.get(`SELECT * FROM users WHERE role IN (${placeholders}) AND service_no=? COLLATE NOCASE`, ...allowedRoles, rawPin);
    if (direct && verifyPin(rawPin, direct.pin_hash)) {
      if (direct.role === 'guest' && direct.approval_status === 'pending') {
        return res.status(403).json({ error: 'Your guest registration is pending bartender approval' });
      }
      if (direct.role === 'guest' && direct.approval_status === 'rejected') {
        return res.status(403).json({ error: 'Your guest registration was declined by the bartender' });
      }
      if (direct.active && direct.approval_status === 'approved') u = direct;
    } else {
      const candidates = q.all(`SELECT * FROM users WHERE active=1 AND approval_status='approved' AND role IN (${placeholders})`, ...allowedRoles);
      u = candidates.find((c) => verifyPin(rawPin, c.pin_hash)) || null;
    }
  }

  if (!u) {
    a.n++; if (a.n >= 6) { a.until = Date.now() + 60e3; a.n = 0; }
    attempts.set(key, a);
    audit(null, 'auth.login_failed', 'user', null, { service_no: service_no || null, mode: mode || 'pin' });
    return res.status(401).json({
      error: mode === 'admin' ? 'Invalid Admin ID or PIN' : mode === 'guest' ? 'Invalid Guest Service No. or PIN' : 'Invalid service number or PIN',
    });
  }
  attempts.delete(key);
  audit(u.id, 'auth.login', 'user', u.id);
  const { pin_hash, ...user } = u;
  res.json({ token: signToken({ uid: u.id, role: u.role }), user });
});

// Guest self-registration (via QR menu or login page) -> requires bartender approval, notifies admin
r.post('/guest-register', (req, res) => {
  const { service_no, rank, name, mobile, pin, table_code } = req.body || {};
  const sn = String(service_no || '').trim();
  const rk = String(rank || '').trim();
  const nm = String(name || '').trim();
  if (!sn || !rk || !nm) return res.status(400).json({ error: 'Service number, rank and name are required' });

  const existing = q.get('SELECT * FROM users WHERE service_no=? COLLATE NOCASE', sn);
  if (existing) {
    if (existing.role !== 'guest') {
      return res.status(409).json({ error: 'Service number belongs to a registered member/staff. Please use Member Login.' });
    }
    if (existing.approval_status === 'pending') {
      return res.status(200).json({
        status: 'pending',
        message: 'Your registration is already submitted and awaiting bartender approval.',
        user: { id: existing.id, name: existing.name, rank: existing.rank, service_no: existing.service_no, approval_status: 'pending' },
      });
    }
    if (existing.approval_status === 'approved' && existing.active) {
      return res.status(200).json({
        status: 'approved',
        message: 'You are already approved as a Guest. Please sign in with your Service Number & PIN.',
        user: { id: existing.id, name: existing.name, rank: existing.rank, service_no: existing.service_no, approval_status: 'approved' },
      });
    }
    // Re-submit previously rejected or deactivated guest registration
    const nextPin = pin && String(pin).trim().length >= 4 ? String(pin).trim() : sn;
    q.run(
      "UPDATE users SET name=?, rank=?, mobile=?, pin_hash=?, approval_status='pending', active=0, approved_by=NULL, approved_at=NULL WHERE id=?",
      nm, rk, mobile ? String(mobile).trim() : existing.mobile, hashPin(nextPin), existing.id,
    );
    const tbl = table_code ? q.get('SELECT name FROM tables WHERE code=?', table_code)?.name : null;
    const msg = `Guest registration request: ${rk} ${nm} (${sn})${tbl ? ` at ${tbl}` : ''} — awaiting bartender approval`;
    notify('bartender', null, msg, '/orders');
    notify('admin', null, msg, '/users');
    audit(existing.id, 'guest.register', 'user', existing.id, { service_no: sn, rank: rk, name: nm, table: tbl });
    broadcast('guest_request', { id: existing.id, service_no: sn, approval_status: 'pending' });
    broadcast('notification', {});
    return res.status(201).json({
      status: 'pending',
      message: 'Registration submitted! Waiting for bartender approval.',
      user: { id: existing.id, name: nm, rank: rk, service_no: sn, approval_status: 'pending' },
    });
  }

  const chosenPin = pin && String(pin).trim().length >= 4 ? String(pin).trim() : sn;
  const rIns = q.run(
    `INSERT INTO users(name, service_no, rank, mobile, email, category, role, pin_hash, must_change_pin, active, approval_status)
     VALUES(?,?,?,?,NULL,'GUEST','guest',?,0,0,'pending')`,
    nm, sn, rk, mobile ? String(mobile).trim() : null, hashPin(chosenPin),
  );
  const id = Number(rIns.lastInsertRowid);
  const tbl = table_code ? q.get('SELECT name FROM tables WHERE code=?', table_code)?.name : null;
  const msg = `New Guest registration: ${rk} ${nm} (${sn})${tbl ? ` at ${tbl}` : ''} — pending bartender approval`;
  notify('bartender', null, msg, '/orders');
  notify('admin', null, msg, '/users');
  audit(id, 'guest.register', 'user', id, { service_no: sn, rank: rk, name: nm, table: tbl });
  broadcast('guest_request', { id, service_no: sn, approval_status: 'pending' });
  broadcast('notification', {});
  res.status(201).json({
    status: 'pending',
    message: 'Guest registration submitted! Please wait for the bartender to approve.',
    user: { id, name: nm, rank: rk, service_no: sn, approval_status: 'pending' },
  });
});

// Lightweight status check for a waiting guest on the QR menu
r.get('/guest-status/:service_no', (req, res) => {
  const u = q.get("SELECT id, name, rank, service_no, approval_status, active FROM users WHERE role='guest' AND service_no=? COLLATE NOCASE", String(req.params.service_no).trim());
  if (!u) return res.status(404).json({ error: 'Guest registration not found' });
  res.json(u);
});

r.get('/me', requireAuth, (req, res) => {
  const u = q.get('SELECT id, name, service_no, rank, mobile, email, category, role, approval_status, alcohol_limit, must_change_pin FROM users WHERE id=?', req.user.id);
  res.json({ ...u, alcohol_usage: getAlcoholUsage(u) });
});

r.post('/change-pin', requireAuth, (req, res) => {
  const { current, next } = req.body || {};
  const u = q.get('SELECT * FROM users WHERE id=?', req.user.id);
  if (!verifyPin(current, u.pin_hash)) return res.status(400).json({ error: 'Current PIN is incorrect' });
  if (!next || String(next).length < 4) return res.status(400).json({ error: 'New PIN must have at least 4 characters' });
  const others = q.all('SELECT id, pin_hash FROM users WHERE active=1 AND id<>?', u.id);
  if (others.some((o) => verifyPin(next, o.pin_hash))) return res.status(400).json({ error: 'This PIN is already in use. Choose another PIN.' });
  q.run('UPDATE users SET pin_hash=?, must_change_pin=0 WHERE id=?', hashPin(next), u.id);
  audit(u.id, 'auth.change_pin', 'user', u.id, { at: now() });
  res.json({ ok: true });
});

export default r;
