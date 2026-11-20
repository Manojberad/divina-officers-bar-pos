// One-time / repeatable loader: backs up DB, applies migrations (incl. v8),
// preserves all existing Bartender accounts, clears non-bartender demo users & demo orders,
// and loads the dedicated Super Admin (ADMIN) + all 59 original Posted-in & Course officers.
import { migrate, q, tx, db } from './db.js';
import { hashPin } from './auth.js';
import { writeBackupFile } from './jobs.js';
import { STATION_OFFICERS } from './officers-data.js';

migrate();

const backupName = writeBackupFile('pre-officers-load');
console.log(`[load-officers] Safety backup saved: ${backupName}`);

// Preserve existing bartenders (and preserve Manoj 40022's existing mobile/PIN hash if customized)
const existingManoj = q.get("SELECT mobile, pin_hash FROM users WHERE service_no='40022' COLLATE NOCASE");
const bartenders = q.all("SELECT * FROM users WHERE role='bartender' ORDER BY id");

db.exec('PRAGMA foreign_keys = OFF');
try {
  tx(() => {
    // Clear old test/demo orders & logs referencing deleted demo users (products, categories, tables & settings stay intact)
    q.run('DELETE FROM order_items');
    q.run('DELETE FROM order_events');
    q.run('DELETE FROM orders');
    q.run("DELETE FROM stock_movements WHERE type IN ('sale','sale_reversal')");
    q.run('DELETE FROM notifications');
    q.run('DELETE FROM audit_logs');

    // Remove all non-bartender user entries
    q.run("DELETE FROM users WHERE role <> 'bartender'");

    // Insert dedicated Super Admin account (ID: ADMIN, PIN: ADMIN)
    q.run(
      `INSERT INTO users(name, service_no, rank, branch, tors, mobile, email, category, role, pin_hash, must_change_pin, active, approval_status)
       VALUES('Administrator', 'ADMIN', 'Super Admin', NULL, NULL, NULL, 'admin@bar.local', 'STAFF', 'superadmin', ?, 0, 1, 'approved')`,
      hashPin('ADMIN'),
    );

    // Insert all 59 original officers (numeric service_no = initial PIN)
    for (const [sn, rank, name, branch, tors, category, role] of STATION_OFFICERS) {
      const mobile = sn === '40022' && existingManoj?.mobile ? existingManoj.mobile : null;
      const pinHash = sn === '40022' && existingManoj?.pin_hash ? existingManoj.pin_hash : hashPin(sn);
      q.run(
        `INSERT INTO users(name, service_no, rank, branch, tors, mobile, email, category, role, pin_hash, must_change_pin, active, approval_status)
         VALUES(?,?,?,?,?,?,NULL,?,?,?,0,1,'approved')`,
        name, sn, rank || null, branch || null, tors || null, mobile, category, role, pinHash,
      );
    }
  });
} finally {
  db.exec('PRAGMA foreign_keys = ON');
}

const summary = q.all('SELECT role, category, COUNT(*) count FROM users GROUP BY role, category ORDER BY role, category');
console.log('[load-officers] Preserved bartenders:', bartenders.map((b) => `${b.name} (${b.service_no})`).join(', '));
console.table(summary);
console.log('[load-officers] Total users in DB:', q.get('SELECT COUNT(*) n FROM users').n);
db.close();
