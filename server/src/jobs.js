import fs from 'node:fs';
import path from 'node:path';
import { db, q, tx, ALL_TABLES, BACKUP_DIR, UPLOAD_DIR, getSettings, now } from './db.js';
import { expireApprovals, checkPreorderReminders, checkTdExpiries } from './services.js';

export function createBackupObject({ includeImages = true } = {}) {
  const data = {};
  for (const t of ALL_TABLES) data[t] = q.all(`SELECT * FROM ${t}`);
  const images = {};
  if (includeImages) {
    for (const f of fs.readdirSync(UPLOAD_DIR)) {
      const fp = path.join(UPLOAD_DIR, f);
      if (fs.statSync(fp).isFile()) images[f] = fs.readFileSync(fp).toString('base64');
    }
  }
  return { app: 'divinabar', version: q.get('SELECT MAX(version) v FROM schema_migrations').v, created_at: now(), data, images };
}

export function restoreBackupObject(obj) {
  if (!obj || !['divinabar', 'bartill'].includes(obj.app) || !obj.data) throw Object.assign(new Error('Not a valid DivinaBar backup file'), { status: 400 });
  // Safety copy before restore
  writeBackupFile('pre-restore');
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    tx(() => {
      for (const t of [...ALL_TABLES].reverse()) q.run(`DELETE FROM ${t}`);
      for (const t of ALL_TABLES) {
        for (const row of obj.data[t] || []) {
          const cols = Object.keys(row);
          q.run(`INSERT INTO ${t}(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`, ...cols.map((c) => row[c]));
        }
      }
    });
  } finally { db.exec('PRAGMA foreign_keys = ON'); }
  for (const [name, b64] of Object.entries(obj.images || {})) {
    const safe = path.basename(name);
    fs.writeFileSync(path.join(UPLOAD_DIR, safe), Buffer.from(b64, 'base64'));
  }
  return Object.fromEntries(ALL_TABLES.map((t) => [t, (obj.data[t] || []).length]));
}

export function writeBackupFile(tag = 'auto') {
  const name = `backup-${tag}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  fs.writeFileSync(path.join(BACKUP_DIR, name), JSON.stringify(createBackupObject()));
  const keep = Number(getSettings().backup_keep || 20);
  const files = listBackups();
  files.slice(keep).forEach((f) => fs.unlinkSync(path.join(BACKUP_DIR, f.name)));
  return name;
}

export function listBackups() {
  return fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.json'))
    .map((f) => ({ name: f, size: fs.statSync(path.join(BACKUP_DIR, f)).size, at: fs.statSync(path.join(BACKUP_DIR, f)).mtime }))
    .sort((a, b) => b.at - a.at);
}

let lastBackup = 0;
export function startJobs() {
  const tick = () => {
    try {
      const n = expireApprovals();
      if (n) console.log(`[jobs] ${n} order approval(s) expired`);
      const pr = checkPreorderReminders();
      if (pr) console.log(`[jobs] ${pr} pre-order reminder(s) sent to bartender`);
      const td = checkTdExpiries();
      if (td) console.log(`[jobs] ${td} TD expiry notification(s) sent to admin`);
      const hours = Number(getSettings().auto_backup_hours || 6);
      if (hours > 0 && Date.now() - lastBackup > hours * 3600e3) {
        lastBackup = Date.now();
        console.log(`[jobs] auto backup ${writeBackupFile('auto')}`);
      }
    } catch (e) { console.error('[jobs]', e); }
  };
  tick();
  return setInterval(tick, 60e3);
}
