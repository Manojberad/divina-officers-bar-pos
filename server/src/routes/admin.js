import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { q, audit, getSettings, DEFAULT_SETTINGS, BACKUP_DIR } from '../db.js';
import { requireRole, requireAuth, isAdmin } from '../auth.js';
import { imageUpload } from './catalog.js';
import { createBackupObject, restoreBackupObject, writeBackupFile, listBackups } from '../jobs.js';
import { lanAddresses } from './tables.js';
import { broadcast } from '../events.js';

const r = Router();
const admin = requireRole('admin');
const jsonUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 300e6 } });
const PUBLIC_KEYS = ['bar_name', 'bar_address', 'bar_phone', 'currency', 'logo', 'background', 'theme', 'accent', 'peg_sizes', 'approval_hours', 'guest_alcohol_limit', 'member_alcohol_limit', 'alcohol_limit_scope', 'alcohol_limit_unit'];

r.get('/settings/public', (_req, res) => {
  const s = getSettings();
  res.json({ ...Object.fromEntries(PUBLIC_KEYS.map((k) => [k, s[k]])), lan: lanAddresses(), port: Number(process.env.PORT || 4000) });
});
r.get('/settings', admin, (_req, res) => res.json(getSettings()));

r.put('/settings', admin, (req, res) => {
  const allowed = Object.keys(DEFAULT_SETTINGS);
  for (const [k, v] of Object.entries(req.body)) {
    if (!allowed.includes(k)) continue;
    q.run('INSERT INTO settings(key, value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, String(v ?? ''));
  }
  audit(req.user.id, 'settings.update', 'settings', null, req.body);
  broadcast('settings', {});
  res.json(getSettings());
});

r.post('/settings/image/:kind', admin, imageUpload.single('image'), (req, res) => {
  const kind = req.params.kind === 'background' ? 'background' : 'logo';
  const val = req.file ? `/uploads/${req.file.filename}` : '';
  q.run('INSERT INTO settings(key, value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', kind, val);
  audit(req.user.id, `settings.${kind}`, 'settings', null, val);
  broadcast('settings', {});
  res.json(getSettings());
});

/* ---------- Backup / restore ---------- */
r.get('/backup', admin, (req, res) => {
  audit(req.user.id, 'backup.download', 'backup');
  res.setHeader('Content-Disposition', `attachment; filename="divinabar-backup-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(createBackupObject({ includeImages: req.query.images !== '0' }));
});

r.get('/backups', admin, (_req, res) => res.json(listBackups()));
r.post('/backups', admin, (req, res) => { const name = writeBackupFile('manual'); audit(req.user.id, 'backup.create', 'backup', name); res.json({ name }); });
r.get('/backups/:name', admin, (req, res) => res.download(path.join(BACKUP_DIR, path.basename(req.params.name))));
r.post('/backups/:name/restore', admin, (req, res) => {
  const obj = JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, path.basename(req.params.name)), 'utf8'));
  const counts = restoreBackupObject(obj);
  audit(req.user.id, 'backup.restore', 'backup', req.params.name, counts);
  res.json({ ok: true, counts });
});

r.post('/restore', admin, jsonUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  let obj;
  try { obj = JSON.parse(req.file.buffer.toString('utf8')); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
  const uid = req.user.id;
  const counts = restoreBackupObject(obj);
  audit(uid, 'backup.restore', 'backup', req.file.originalname, counts);
  res.json({ ok: true, counts });
});

/* ---------- Audit & notifications ---------- */
r.get('/audit', admin, (req, res) => {
  const { action, limit = 500 } = req.query;
  res.json(q.all(`SELECT a.*, u.name user_name FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id ${action ? 'WHERE a.action LIKE ?' : ''} ORDER BY a.id DESC LIMIT ?`,
    ...(action ? [`%${action}%`] : []), Number(limit)));
});

r.get('/notifications', requireAuth, (req, res) => {
  if (isAdmin(req.user)) {
    return res.json(q.all("SELECT * FROM notifications WHERE target_role IN ('admin', ?) OR user_id=? ORDER BY id DESC LIMIT 50", req.user.role, req.user.id));
  }
  res.json(q.all('SELECT * FROM notifications WHERE (target_role=? OR user_id=?) ORDER BY id DESC LIMIT 50', req.user.role, req.user.id));
});
r.post('/notifications/read', requireAuth, (req, res) => {
  if (isAdmin(req.user)) {
    q.run("UPDATE notifications SET read=1 WHERE target_role IN ('admin', ?) OR user_id=?", req.user.role, req.user.id);
  } else {
    q.run('UPDATE notifications SET read=1 WHERE target_role=? OR user_id=?', req.user.role, req.user.id);
  }
  res.json({ ok: true });
});

export default r;
