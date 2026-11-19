import { Router } from 'express';
import crypto from 'node:crypto';
import os from 'node:os';
import QRCode from 'qrcode';
import { q, audit } from '../db.js';
import { requireRole } from '../auth.js';

const r = Router();
const admin = requireRole('admin');

export function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
}

r.get('/', requireRole('admin', 'bartender'), (_req, res) => res.json(q.all('SELECT * FROM tables ORDER BY id')));

r.post('/', admin, (req, res) => {
  const name = req.body.name?.trim();
  if (!name) return res.status(400).json({ error: 'Name required' });
  const code = crypto.randomBytes(5).toString('hex');
  const id = Number(q.run('INSERT INTO tables(name, code) VALUES(?,?)', name, code).lastInsertRowid);
  audit(req.user.id, 'table.create', 'table', id, { name });
  res.status(201).json(q.get('SELECT * FROM tables WHERE id=?', id));
});

r.put('/:id', admin, (req, res) => {
  const t = q.get('SELECT * FROM tables WHERE id=?', Number(req.params.id));
  if (!t) return res.status(404).json({ error: 'Not found' });
  const code = req.body.regenerate ? crypto.randomBytes(5).toString('hex') : t.code;
  q.run('UPDATE tables SET name=?, active=?, code=? WHERE id=?', req.body.name ?? t.name, req.body.active == null ? t.active : req.body.active ? 1 : 0, code, t.id);
  audit(req.user.id, 'table.update', 'table', t.id, req.body);
  res.json(q.get('SELECT * FROM tables WHERE id=?', t.id));
});

r.delete('/:id', admin, (req, res) => {
  const id = Number(req.params.id);
  if (q.get('SELECT COUNT(*) n FROM orders WHERE table_id=?', id).n) { q.run('UPDATE tables SET active=0 WHERE id=?', id); return res.json({ ok: true, deactivated: true }); }
  q.run('DELETE FROM tables WHERE id=?', id);
  audit(req.user.id, 'table.delete', 'table', id);
  res.json({ ok: true });
});

// QR image (no auth so it can be used in <img>); base URL supplied by client or derived from LAN IP.
r.get('/:id/qr.png', async (req, res) => {
  const t = q.get('SELECT * FROM tables WHERE id=?', Number(req.params.id));
  if (!t) return res.status(404).end();
  const base = req.query.base || `${req.protocol}://${req.get('host')}`;
  const png = await QRCode.toBuffer(`${base}/menu/${t.code}`, { width: 512, margin: 2 });
  res.type('png').send(png);
});

export default r;
