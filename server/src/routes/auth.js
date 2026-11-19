import { Router } from 'express';
import { q, audit, now } from '../db.js';
import { hashPin, verifyPin, signToken, requireAuth } from '../auth.js';

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
  const allowedRoles = mode === 'admin' ? ['admin', 'bartender'] : mode === 'member' ? ['member', 'customer'] : ['admin', 'bartender', 'member', 'customer'];
  if (service_no) {
    const candidate = q.get('SELECT * FROM users WHERE service_no=? COLLATE NOCASE', String(service_no).trim());
    if (candidate && candidate.active && allowedRoles.includes(candidate.role) && verifyPin(rawPin, candidate.pin_hash)) {
      u = candidate;
    }
  } else {
    // PIN-only fallback
    const placeholders = allowedRoles.map(() => '?').join(',');
    const direct = q.get(`SELECT * FROM users WHERE active=1 AND role IN (${placeholders}) AND service_no=? COLLATE NOCASE`, ...allowedRoles, rawPin);
    if (direct && verifyPin(rawPin, direct.pin_hash)) {
      u = direct;
    } else {
      const candidates = q.all(`SELECT * FROM users WHERE active=1 AND role IN (${placeholders})`, ...allowedRoles);
      u = candidates.find((c) => verifyPin(rawPin, c.pin_hash)) || null;
    }
  }

  if (!u) {
    a.n++; if (a.n >= 6) { a.until = Date.now() + 60e3; a.n = 0; }
    attempts.set(key, a);
    audit(null, 'auth.login_failed', 'user', null, { service_no: service_no || null, mode: mode || 'pin' });
    return res.status(401).json({ error: mode === 'admin' ? 'Invalid Admin PIN' : mode === 'member' ? 'Invalid Member PIN' : 'Invalid service number or PIN' });
  }
  attempts.delete(key);
  audit(u.id, 'auth.login', 'user', u.id);
  const { pin_hash, ...user } = u;
  res.json({ token: signToken({ uid: u.id, role: u.role }), user });
});

r.get('/me', requireAuth, (req, res) => {
  const u = q.get('SELECT id, name, service_no, rank, mobile, email, category, role, must_change_pin FROM users WHERE id=?', req.user.id);
  res.json(u);
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
