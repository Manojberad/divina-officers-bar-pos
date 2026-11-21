import crypto from 'node:crypto';
import { Router } from 'express';
import { q, audit, notify, now } from '../db.js';
import { hashPin, verifyPin, createSessionToken, revokeSession, requireAuth, tdValidity, STAFF, ALL_ROLES, PRIVILEGED_OFFICER_ROLES, roleLabel } from '../auth.js';
import { broadcast } from '../events.js';
import { getAlcoholUsage } from '../services.js';

const r = Router();
const attempts = new Map(); // simple brute-force throttle per key

function canLoginInMode(u, mode) {
  if (!u) return false;
  if (mode === 'admin') return STAFF.includes(u.role);
  if (mode === 'guest') return u.role === 'guest';
  if (mode === 'member') {
    if (['member', 'customer', 'guest', ...PRIVILEGED_OFFICER_ROLES].includes(u.role)) return true;
    // Officer accounts with Super Admin privilege (e.g. Posted-in / Course officers) can also log in via Member tab
    if (u.role === 'superadmin' && ['POSTED', 'COURSE'].includes(u.category)) return true;
    return false;
  }
  return ALL_ROLES.includes(u.role);
}

r.post('/login', (req, res) => {
  const { service_no, pin, mode } = req.body || {};
  const rawPin = String(pin ?? service_no ?? '').trim();
  if (!rawPin) return res.status(400).json({ error: 'Please enter your PIN' });

  const key = String(service_no || `${mode || 'any'}:${rawPin.slice(0, 2)}`).toLowerCase();
  const a = attempts.get(key) || { n: 0, until: 0 };
  if (a.until > Date.now()) return res.status(429).json({ error: 'Too many attempts. Try again in a minute.' });

  let u = null;

  if (service_no) {
    const candidate = q.get('SELECT * FROM users WHERE service_no=? COLLATE NOCASE', String(service_no).trim());
    if (candidate && canLoginInMode(candidate, mode) && verifyPin(rawPin, candidate.pin_hash)) {
      if (candidate.role === 'guest' && candidate.approval_status === 'pending') {
        return res.status(403).json({ error: 'Your guest registration is pending bartender approval' });
      }
      if (candidate.role === 'guest' && candidate.approval_status === 'rejected') {
        return res.status(403).json({ error: 'Your guest registration was declined by the bartender' });
      }
      const tdv = tdValidity(candidate);
      if (!tdv.ok) return res.status(403).json({ error: tdv.message });
      if (candidate.active && candidate.approval_status === 'approved') u = candidate;
    }
  } else {
    // PIN-only fallback
    const direct = q.get('SELECT * FROM users WHERE service_no=? COLLATE NOCASE', rawPin);
    if (direct && canLoginInMode(direct, mode) && verifyPin(rawPin, direct.pin_hash)) {
      if (direct.role === 'guest' && direct.approval_status === 'pending') {
        return res.status(403).json({ error: 'Your guest registration is pending bartender approval' });
      }
      if (direct.role === 'guest' && direct.approval_status === 'rejected') {
        return res.status(403).json({ error: 'Your guest registration was declined by the bartender' });
      }
      const tdv = tdValidity(direct);
      if (!tdv.ok) return res.status(403).json({ error: tdv.message });
      if (direct.active && direct.approval_status === 'approved') u = direct;
    } else {
      const candidates = q.all("SELECT * FROM users WHERE active=1 AND approval_status='approved'").filter((c) => canLoginInMode(c, mode));
      u = candidates.find((c) => verifyPin(rawPin, c.pin_hash) && tdValidity(c).ok) || null;
    }
  }

  if (!u) {
    a.n++; if (a.n >= 6) { a.until = Date.now() + 60e3; a.n = 0; }
    attempts.set(key, a);
    audit(null, 'auth.login_failed', 'user', null, { service_no: service_no || null, mode: mode || 'pin' });
    return res.status(401).json({
      error: mode === 'admin' ? 'Invalid Admin / Staff ID or PIN' : mode === 'guest' ? 'Invalid Guest Service No. or PIN' : 'Invalid service number or PIN',
    });
  }
  attempts.delete(key);
  audit(u.id, 'auth.login', 'user', u.id);
  const { pin_hash, guest_claim_token, ...user } = u;
  user.designation = roleLabel(user.role);
  const hours = req.body?.remember ? 24 * 7 : 12;
  res.json({ token: createSessionToken(u, hours), user });
});

r.post('/logout', requireAuth, (req, res) => {
  revokeSession(req.user.session_id);
  q.run('UPDATE users SET guest_claim_token=NULL WHERE id=?', req.user.id);
  audit(req.user.id, 'auth.logout', 'user', req.user.id);
  res.json({ ok: true });
});

// Guest self-registration (via QR menu or login page) -> requires bartender approval, notifies admin
r.post('/guest-register', (req, res) => {
  const { service_no, rank, name, mobile, pin, table_code } = req.body || {};
  const sn = String(service_no || '').trim();
  const rk = String(rank || '').trim();
  const nm = String(name || '').trim();
  if (!sn || !rk || !nm) return res.status(400).json({ error: 'Service number, rank and name are required' });

  const claimToken = crypto.randomBytes(32).toString('hex');
  const existing = q.get('SELECT * FROM users WHERE service_no=? COLLATE NOCASE', sn);
  if (existing) {
    if (existing.role !== 'guest') {
      return res.status(409).json({ error: 'Service number belongs to a registered member/staff. Please use Member Login.' });
    }
    if (existing.approval_status === 'pending') {
      const nextToken = existing.guest_claim_token || claimToken;
      if (!existing.guest_claim_token) q.run('UPDATE users SET guest_claim_token=? WHERE id=?', nextToken, existing.id);
      return res.status(200).json({
        status: 'pending',
        request_token: nextToken,
        message: 'Your registration is submitted and awaiting bartender approval. You will be logged in automatically once approved.',
        user: { id: existing.id, name: existing.name, rank: existing.rank, service_no: existing.service_no, approval_status: 'pending' },
      });
    }
    if (existing.approval_status === 'approved' && existing.active) {
      const chosenPin = pin && String(pin).trim().length >= 4 ? String(pin).trim() : sn;
      if (verifyPin(chosenPin, existing.pin_hash)) {
        const { pin_hash, guest_claim_token, ...user } = existing;
        user.designation = roleLabel(user.role);
        audit(existing.id, 'auth.guest_auto_login', 'user', existing.id, { via: 'already_approved' });
        return res.status(200).json({
          status: 'approved',
          token: createSessionToken(existing, 12),
          message: 'Your access has been approved. Welcome!',
          user,
        });
      }
      return res.status(200).json({
        status: 'approved',
        message: 'You are already approved as a Guest. Please sign in with your Service Number & PIN.',
        user: { id: existing.id, name: existing.name, rank: existing.rank, service_no: existing.service_no, approval_status: 'approved' },
      });
    }
    // Re-submit previously rejected or deactivated guest registration
    const nextPin = pin && String(pin).trim().length >= 4 ? String(pin).trim() : sn;
    q.run(
      "UPDATE users SET name=?, rank=?, mobile=?, pin_hash=?, guest_claim_token=?, approval_status='pending', active=0, approved_by=NULL, approved_at=NULL WHERE id=?",
      nm, rk, mobile ? String(mobile).trim() : existing.mobile, hashPin(nextPin), claimToken, existing.id,
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
      request_token: claimToken,
      message: 'Registration submitted! Waiting for bartender approval — you will enter automatically once approved.',
      user: { id: existing.id, name: nm, rank: rk, service_no: sn, approval_status: 'pending' },
    });
  }

  const chosenPin = pin && String(pin).trim().length >= 4 ? String(pin).trim() : sn;
  const rIns = q.run(
    `INSERT INTO users(name, service_no, rank, mobile, email, category, role, pin_hash, guest_claim_token, must_change_pin, active, approval_status)
     VALUES(?,?,?,?,NULL,'GUEST','guest',?,?,0,0,'pending')`,
    nm, sn, rk, mobile ? String(mobile).trim() : null, hashPin(chosenPin), claimToken,
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
    request_token: claimToken,
    message: 'Guest registration submitted! Please wait — you will be logged in automatically once approved.',
    user: { id, name: nm, rank: rk, service_no: sn, approval_status: 'pending' },
  });
});

// Secure auto-login claim for waiting guests: once bartender approves, issues a live session token without asking for credentials again
r.post('/guest-claim', (req, res) => {
  const sn = String(req.body?.service_no || '').trim();
  const tok = String(req.body?.request_token || '').trim();
  if (!sn || !tok) return res.status(400).json({ error: 'Missing guest claim details' });
  const u = q.get("SELECT * FROM users WHERE role='guest' AND service_no=? COLLATE NOCASE", sn);
  if (!u) return res.status(404).json({ status: 'not_found', error: 'Guest registration not found' });
  if (u.approval_status === 'rejected') {
    return res.status(403).json({ status: 'rejected', error: 'Your guest access request was declined by the bartender.' });
  }
  if (!u.guest_claim_token) {
    return res.status(403).json({ status: 'revoked', error: 'Guest approval session expired or was revoked. Please register or sign in.' });
  }
  const a = Buffer.from(tok);
  const b = Buffer.from(u.guest_claim_token);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ status: 'invalid', error: 'Invalid guest request session' });
  }
  if (u.approval_status === 'pending') {
    return res.json({ status: 'pending', user: { id: u.id, name: u.name, rank: u.rank, service_no: u.service_no, approval_status: 'pending' } });
  }
  if (u.approval_status === 'approved' && !u.active) {
    return res.status(403).json({ status: 'revoked', error: 'Your guest access has been revoked. Contact the bartender.' });
  }
  const { pin_hash, guest_claim_token, ...user } = u;
  user.designation = roleLabel(user.role);
  const token = createSessionToken(u, 12);
  audit(u.id, 'auth.guest_auto_login', 'user', u.id);
  res.json({
    status: 'approved',
    token,
    user: { ...user, alcohol_usage: getAlcoholUsage(u) },
    message: 'Your access has been approved. Welcome!',
  });
});

// Lightweight status check for a waiting guest on the QR menu
r.get('/guest-status/:service_no', (req, res) => {
  const u = q.get("SELECT id, name, rank, service_no, approval_status, active FROM users WHERE role='guest' AND service_no=? COLLATE NOCASE", String(req.params.service_no).trim());
  if (!u) return res.status(404).json({ error: 'Guest registration not found' });
  res.json(u);
});

r.get('/me', requireAuth, (req, res) => {
  const u = q.get('SELECT id, name, service_no, rank, branch, tors, mobile, email, category, role, approval_status, alcohol_limit, td_start_date, td_end_date, must_change_pin FROM users WHERE id=?', req.user.id);
  res.json({ ...u, designation: roleLabel(u.role), alcohol_usage: getAlcoholUsage(u) });
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
