/**
 * Real OS Process Stop & Restart Persistence Test
 * Simulates Bartender A shift -> orders & stock deductions -> FULL server shutdown ->
 * brand-new server process startup -> Bartender B login & shift -> verifies 100% data recovery.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverEntry = path.resolve(__dirname, '../src/index.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'divinabar-restart-'));

function getFreePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });
}

async function req(base, p, { method = 'GET', token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }
  const res = await fetch(`${base}${p}`, { method, headers, body, cache: 'no-store' });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  return { status: res.status, data };
}

async function startServer(port, dataDir) {
  const child = spawn(process.execPath, ['--no-warnings', serverEntry], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, SEED_MODE: 'station' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', (d) => { logs += d.toString(); });
  child.stderr.on('data', (d) => { logs += d.toString(); });

  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited prematurely (${child.exitCode}):\n${logs}`);
    }
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.ok) return { child, base, getLogs: () => logs };
    } catch { /* wait for boot */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  child.kill();
  throw new Error(`Server did not become healthy in time:\n${logs}`);
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  const timer = setTimeout(() => {
    if (child.exitCode === null) child.kill();
  }, 4000);
  await exited;
  clearTimeout(timer);
}

console.log('=== Restart & Multi-Shift Persistence Integration Test ===');
const port1 = await getFreePort();
let proc1, proc2;

try {
  // ---------------- PROCESS #1: Bartender A (Sunny - 00000) ----------------
  console.log('1. Booting Process #1 (fresh persistent DATA_DIR)…');
  proc1 = await startServer(port1, tmp);
  const login1 = async (sn, pin = sn) => (await req(proc1.base, '/api/auth/login', { method: 'POST', body: { service_no: sn, pin } })).data;

  const sunny = await login1('00000');
  assert(sunny.token, 'Bartender A (Sunny) logged in');
  const btATok = sunny.token;

  const shift1 = (await req(proc1.base, '/api/shifts/start', { method: 'POST', token: btATok, body: { note: 'Shift 1 by Sunny' } })).data;
  assert.equal(shift1.status, 'open');

  const prods1 = (await req(proc1.base, '/api/products?all=1', { token: btATok })).data;
  const blueLagoon = prods1.find((p) => p.name === 'BLUE LAGOON');
  const blueCuracao = prods1.find((p) => p.name === 'BLUE CURACAO');
  const freshLime = prods1.find((p) => p.name === 'FRESH LIME');
  const coke250 = prods1.find((p) => p.name === 'Coca-Cola 250 ml');
  assert(blueLagoon && blueCuracao && freshLime && coke250, 'Station products seeded');

  const stockBefore = {
    blueCuracao: blueCuracao.stock,
    freshLime: freshLime.stock,
    coke250: coke250.stock,
  };

  // Lookup a member officer for Order 1
  const officers = (await req(proc1.base, '/api/users/lookup', { token: btATok })).data;
  const memberOfficer = officers.find((u) => u.service_no === '27415') || officers[0];

  // Place Member Order 1 (2 Blue Lagoons + 2 Coke 250ml)
  const ord1 = (await req(proc1.base, '/api/orders', {
    method: 'POST', token: btATok,
    body: { user_id: memberOfficer.id, items: [{ product_id: blueLagoon.id, qty: 2 }, { product_id: coke250.id, qty: 2 }], notes: 'Pre-restart member order' },
  })).data;
  assert.equal(ord1.shift_id, shift1.id);

  // Guest registers -> Bartender A approves -> Guest auto-claims session token -> places ongoing order (served)
  const gReg = (await req(proc1.base, '/api/auth/guest-register', {
    method: 'POST', body: { service_no: 'G-PERSIST-99', rank: 'Capt', name: 'Persistent Guest' },
  })).data;
  await req(proc1.base, `/api/users/${gReg.user.id}/approve-guest`, { method: 'POST', token: btATok, body: { action: 'approve' } });
  const gClaim = (await req(proc1.base, '/api/auth/guest-claim', {
    method: 'POST', body: { service_no: 'G-PERSIST-99', request_token: gReg.request_token },
  })).data;
  assert.equal(gClaim.status, 'approved');
  const guestTok = gClaim.token;

  const ord2 = (await req(proc1.base, '/api/orders', {
    method: 'POST', token: guestTok,
    body: { items: [{ product_id: coke250.id, qty: 1 }], notes: 'Ongoing guest order across restart' },
  })).data;
  assert.equal(ord2.status, 'served');
  assert.equal(ord2.shift_id, shift1.id);

  // Bartender A ends Shift 1 before closing the POS
  const endedShift1 = (await req(proc1.base, '/api/shifts/end', { method: 'POST', token: btATok, body: { note: 'Handover to Urvesh' } })).data;
  assert.equal(endedShift1.status, 'closed');
  assert.equal(endedShift1.billed_orders, 1);
  assert.equal(endedShift1.ongoing_orders, 1);

  console.log('2. Stopping Process #1 completely…');
  await stopServer(proc1.child);
  proc1 = null;

  // ---------------- PROCESS #2: Brand-New Server Process, Bartender B (Urvesh - 11111) ----------------
  const port2 = await getFreePort();
  console.log('3. Starting Process #2 against the SAME persistent database…');
  proc2 = await startServer(port2, tmp);

  // Persisted guest session from Process #1 STILL works seamlessly after restart!
  const guestMeAfter = await req(proc2.base, '/api/auth/me', { token: guestTok });
  assert.equal(guestMeAfter.status, 200, 'Persisted guest DB session survives full server restart');
  assert.equal(guestMeAfter.data.service_no, 'G-PERSIST-99');

  // Login as DIFFERENT Bartender B (Urvesh - 11111)
  const urvesh = (await req(proc2.base, '/api/auth/login', { method: 'POST', body: { service_no: '11111', pin: '11111' } })).data;
  assert(urvesh.token, 'Bartender B (Urvesh) logged in after restart');
  const btBTok = urvesh.token;

  // Verify ALL prior orders & ongoing guest order recovered intact
  const recoveredOrders = (await req(proc2.base, '/api/orders?limit=50', { token: btBTok })).data;
  const recOrd1 = recoveredOrders.find((o) => o.id === ord1.id);
  const recOrd2 = recoveredOrders.find((o) => o.id === ord2.id);
  assert(recOrd1 && recOrd1.order_no === ord1.order_no && recOrd1.total === ord1.total, 'Member Order 1 fully recovered after restart');
  assert(recOrd2 && recOrd2.status === 'served' && recOrd2.total === ord2.total, 'Ongoing Guest Order 2 fully recovered after restart');

  // Verify exact stock balances survived restart without reset or drift
  const prods2 = (await req(proc2.base, '/api/products?all=1', { token: btBTok })).data;
  assert.equal(prods2.find((p) => p.id === blueCuracao.id).stock, stockBefore.blueCuracao - 4, 'Blue Curacao stock persisted accurately (-4 loose / 120ml)');
  assert.equal(prods2.find((p) => p.id === freshLime.id).stock, stockBefore.freshLime - 2, 'Fresh Lime stock persisted accurately (-2)');
  assert.equal(prods2.find((p) => p.id === coke250.id).stock, stockBefore.coke250 - 3, 'Coke 250ml stock persisted accurately (-3)');

  // Verify Shift #1 history intact & Bartender B starts Shift #2
  const shiftState2 = (await req(proc2.base, '/api/shifts/current', { token: btBTok })).data;
  assert.equal(shiftState2.current, null);
  assert(shiftState2.recent.some((s) => s.id === shift1.id && s.status === 'closed'), 'Shift #1 recovered in Shift History');

  const shift2 = (await req(proc2.base, '/api/shifts/start', { method: 'POST', token: btBTok, body: { note: 'Shift 2 by Urvesh' } })).data;
  assert.equal(shift2.status, 'open');

  // Bartender B settles ongoing Guest Order 2 (from Shift 1) via UPI & places Order 3 in Shift 2
  const settled2 = await req(proc2.base, `/api/orders/${ord2.id}/status`, {
    method: 'POST', token: btBTok, body: { status: 'closed', payment_mode: 'upi', payment_ref: 'UPI-SHIFT2' },
  });
  assert.equal(settled2.status, 200);
  const ord3 = (await req(proc2.base, '/api/orders', {
    method: 'POST', token: btBTok,
    body: { user_id: memberOfficer.id, items: [{ product_id: coke250.id, qty: 2 }], notes: 'Post-restart Shift 2 order' },
  })).data;
  assert.equal(ord3.shift_id, shift2.id);

  // Admin verifies consolidated Daily Sales & Shift-wise reports across BOTH shifts
  const admin = (await req(proc2.base, '/api/auth/login', { method: 'POST', body: { service_no: '27415', pin: '27415' } })).data;
  const shiftRep = (await req(proc2.base, '/api/reports/shifts', { token: admin.token })).data;
  const dailyRep = (await req(proc2.base, '/api/reports/daily', { token: admin.token })).data;
  assert.equal(shiftRep.rows.length, 2, 'Shift report contains both Shift 1 (Sunny) and Shift 2 (Urvesh)');
  const expectedTotal = Math.round((ord1.total + ord2.total + ord3.total) * 100) / 100;
  assert.equal(dailyRep.totals.revenue, expectedTotal, `Consolidated Daily Sales matches exact sum across both shifts (₹${expectedTotal})`);
  assert.equal(dailyRep.totals.orders, 3, 'Consolidated Daily Sales counts all 3 orders across restart');

  console.log('4. Stopping Process #2 cleanly & verifying SQLite DB integrity…');
  await stopServer(proc2.child);
  proc2 = null;

  const checkDb = new DatabaseSync(path.join(tmp, 'bar.db'));
  const qc = checkDb.prepare('PRAGMA quick_check').get();
  assert.equal(qc.quick_check, 'ok', 'SQLite quick_check = ok after multi-restart lifecycle');
  checkDb.close();

  console.log('✔ Restart & Multi-Shift Persistence Integration Test PASSED!');
} finally {
  if (proc1) await stopServer(proc1.child);
  if (proc2) await stopServer(proc2.child);
  fs.rmSync(tmp, { recursive: true, force: true });
}
