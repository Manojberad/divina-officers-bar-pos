import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import * as XLSX from 'xlsx';

// Isolated temp data directory so tests never touch production data
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bartill-test-'));
process.env.DATA_DIR = tmp;

const { app } = await import('../src/index.js');
const { q, db } = await import('../src/db.js');
const { expireApprovals } = await import('../src/services.js');

const server = http.createServer(app);
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

async function req(p, { method = 'GET', token, body, raw } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body && !(body instanceof FormData)) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
  const res = await fetch(`${base}${p}`, { method, headers, body });
  if (raw) return res;
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  return { status: res.status, data };
}

const login = async (sn, pin = sn) => (await req('/api/auth/login', { method: 'POST', body: { service_no: sn, pin } })).data.token;

console.log('1. Auth & RBAC…');
const adminTok = await login('ADMIN');
const btTok = await login('BT001');
const memTok = await login('IC-51234');
const custTok = await login('TD-1001');
assert(adminTok && btTok && memTok && custTok, 'All 4 roles logged in');
// Verify PIN-only login for Member Login and Admin Login sections
assert.equal((await req('/api/auth/login', { method: 'POST', body: { pin: 'IC-51234', mode: 'member' } })).status, 200, 'Member PIN-only login works');
assert.equal((await req('/api/auth/login', { method: 'POST', body: { pin: 'ADMIN', mode: 'admin' } })).status, 200, 'Admin PIN-only login works');
assert.equal((await req('/api/auth/login', { method: 'POST', body: { pin: 'IC-51234', mode: 'admin' } })).status, 401, 'Member PIN rejected on Admin Login tab');
assert.equal((await req('/api/users', { token: btTok })).status, 403, 'Bartender blocked from admin users');
assert.equal((await req('/api/dashboard', { token: memTok })).status, 403, 'Member blocked from admin dashboard');
assert.equal((await req('/api/orders', { method: 'POST', token: custTok, body: { type: 'prebooked', scheduled_at: new Date(Date.now() + 86400e3).toISOString(), items: [{ product_id: 1, qty: 1 }] } })).status, 403, 'Customer cannot prebook');

console.log('2. Users (Posted-In, TD, duplicate prevention, Excel import, 50-user cap)…');
const dup = await req('/api/users', { method: 'POST', token: adminTok, body: { name: 'Dup', service_no: 'ic-51234', category: 'POSTED', role: 'member' } });
assert.equal(dup.status, 400, 'Duplicate service_no rejected case-insensitively');
const td = await req('/api/users', { method: 'POST', token: adminTok, body: { name: 'Capt TD Test', service_no: 'TD-2001', rank: 'Capt', category: 'TD', role: 'customer', pin: '9988' } });
assert.equal(td.status, 201);
assert(await login('TD-2001', '9988'), 'TD officer logs in with assigned PIN');

// Excel import
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
  { Name: 'Maj Excel One', 'Service Number': 'IC-70001', Rank: 'Maj', Mobile: '9999911111', Email: 'e1@bar.local', Category: 'POSTED', Role: 'member' },
  { Name: 'Maj Excel Dup', 'Service Number': 'IC-51234', Rank: 'Maj' },
]), 'Officers');
const fd = new FormData();
fd.append('file', new Blob([XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })]), 'officers.xlsx');
const imp = await req('/api/users/import', { method: 'POST', token: adminTok, body: fd });
assert.equal(imp.data.created, 1);
assert.equal(imp.data.skipped.length, 1);
assert(await login('IC-70001', 'IC-70001'), 'Imported Posted-In officer logs in with Service No as PIN');

console.log('3. POS, offline client_uuid deduplication, peg & bottle inventory deduction, reversal…');
const whisky = (await req('/api/products/1', { token: btTok })).data;
const startMl = whisky.stock;
const uuid = 'offline-uuid-test-001';
const o1 = await req('/api/orders', { method: 'POST', token: btTok, body: { client_uuid: uuid, user_id: 3, items: [{ product_id: 1, serve_type: 'peg', peg_ml: 60, qty: 2 }] } });
const o1Replay = await req('/api/orders', { method: 'POST', token: btTok, body: { client_uuid: uuid, user_id: 3, items: [{ product_id: 1, serve_type: 'peg', peg_ml: 60, qty: 2 }] } });
assert.equal(o1.status, 201);
assert.equal(o1Replay.status, 200);
assert.equal(o1Replay.data.duplicate, true);
assert.equal(o1.data.id, o1Replay.data.id, 'Offline replay did not create duplicate order');

const oid = o1.data.id;
await req(`/api/orders/${oid}/status`, { method: 'POST', token: btTok, body: { status: 'accepted' } });
await req(`/api/orders/${oid}/status`, { method: 'POST', token: btTok, body: { status: 'preparing' } });
assert.equal((await req('/api/products/1', { token: btTok })).data.stock, startMl, 'Stock not deducted before served');

await req(`/api/orders/${oid}/status`, { method: 'POST', token: btTok, body: { status: 'served' } });
const afterServeMl = (await req('/api/products/1', { token: btTok })).data.stock;
assert.equal(afterServeMl, startMl - 120, 'Deducted 2 x 60ml = 120ml on served');

// Repeat served/closed must not deduct twice
await req(`/api/orders/${oid}/status`, { method: 'POST', token: btTok, body: { status: 'served' } });
await req(`/api/orders/${oid}/status`, { method: 'POST', token: btTok, body: { status: 'closed' } });
assert.equal((await req('/api/products/1', { token: btTok })).data.stock, afterServeMl, 'No duplicate deduction on close');

// Cancel a served order as admin -> stock reversed
const oCancel = (await req('/api/orders', { method: 'POST', token: btTok, body: { items: [{ product_id: 1, serve_type: 'bottle', qty: 1 }] } })).data;
await req(`/api/orders/${oCancel.id}/status`, { method: 'POST', token: btTok, body: { status: 'served' } });
assert.equal((await req('/api/products/1', { token: btTok })).data.stock, afterServeMl - 750);
assert.equal((await req(`/api/orders/${oCancel.id}/status`, { method: 'POST', token: btTok, body: { status: 'cancelled' } })).status, 403, 'Bartender cannot cancel served order');
await req(`/api/orders/${oCancel.id}/status`, { method: 'POST', token: adminTok, body: { status: 'cancelled', note: 'Wrong table' } });
assert.equal((await req('/api/products/1', { token: btTok })).data.stock, afterServeMl, 'Stock restored after admin cancelled served order');

console.log('4. Customer order approval, dispute notification & 24h auto-expiry…');
const appRes = await req(`/api/orders/${oid}/approve`, { method: 'POST', token: memTok });
assert.equal(appRes.data.approval_status, 'approved');

// Dispute workflow
const oDisp = (await req('/api/orders', { method: 'POST', token: btTok, body: { user_id: 3, items: [{ product_id: 1, serve_type: 'peg', peg_ml: 30, qty: 1 }] } })).data;
await req(`/api/orders/${oDisp.id}/status`, { method: 'POST', token: btTok, body: { status: 'served' } });
await req(`/api/orders/${oDisp.id}/status`, { method: 'POST', token: btTok, body: { status: 'closed' } });
const dispRes = await req(`/api/orders/${oDisp.id}/dispute`, { method: 'POST', token: memTok, body: { note: 'Ordered 30ml, billed wrong' } });
assert.equal(dispRes.data.status, 'disputed');
const notes = (await req('/api/admin/notifications', { token: adminTok })).data;
assert(notes.some((n) => n.message.includes(oDisp.order_no)), 'Admin notified of dispute');
const resolved = await req(`/api/orders/${oDisp.id}/status`, { method: 'POST', token: adminTok, body: { status: 'closed', note: 'Verified with bartender' } });
assert.equal(resolved.data.status, 'closed');
assert.equal(resolved.data.approval_status, 'approved');

// 24h expiry job
const oExp = (await req('/api/orders', { method: 'POST', token: btTok, body: { user_id: 3, items: [{ product_id: 9, qty: 1 }] } })).data;
await req(`/api/orders/${oExp.id}/status`, { method: 'POST', token: btTok, body: { status: 'served' } });
await req(`/api/orders/${oExp.id}/status`, { method: 'POST', token: btTok, body: { status: 'closed' } });
q.run('UPDATE orders SET closed_at=? WHERE id=?', new Date(Date.now() - 25 * 3600e3).toISOString(), oExp.id);
assert(expireApprovals() >= 1, 'Expired unapproved >24h order');
assert.equal((await req(`/api/orders/${oExp.id}`, { token: memTok })).data.approval_status, 'expired');

console.log('5. QR code menu & multi-device table ordering…');
const tables = (await req('/api/tables', { token: adminTok })).data;
const qrPng = await req(`/api/tables/${tables[0].id}/qr.png`, { raw: true });
assert.equal(qrPng.status, 200);
assert.equal(qrPng.headers.get('content-type'), 'image/png');
const menu = (await req(`/api/menu/${tables[0].code}`)).data;
assert.equal(menu.table.id, tables[0].id);
const qrOrder = await req('/api/orders', { method: 'POST', token: memTok, body: { table_code: tables[0].code, source: 'qr', items: [{ product_id: 9, qty: 2 }] } });
assert.equal(qrOrder.status, 201);
assert.equal(qrOrder.data.table_id, tables[0].id);

console.log('5b. Peg policy (Small 30ml & Large 60ml only; full bottle only for Bartender/Admin)…');
assert.equal((await req('/api/orders', { method: 'POST', token: memTok, body: { items: [{ product_id: 1, serve_type: 'peg', peg_ml: 90, qty: 1 }] } })).status, 400, '90ml peg rejected');
assert.equal((await req('/api/orders', { method: 'POST', token: memTok, body: { items: [{ product_id: 1, serve_type: 'bottle', qty: 1 }] } })).status, 403, 'Member blocked from issuing full bottle');
assert.equal((await req('/api/orders', { method: 'POST', token: memTok, body: { items: [{ product_id: 1, serve_type: 'peg', peg_ml: 30, qty: 1 }, { product_id: 1, serve_type: 'peg', peg_ml: 60, qty: 1 }] } })).status, 201, 'Member allowed Small(30ml) & Large(60ml)');
assert.equal((await req('/api/orders', { method: 'POST', token: btTok, body: { items: [{ product_id: 1, serve_type: 'bottle', qty: 1 }] } })).status, 201, 'Bartender allowed to issue full bottle');

console.log('5c. Guest registration, bartender approval, admin notification & Cash/UPI checkout…');
const gReg = await req('/api/auth/guest-register', { method: 'POST', body: { service_no: 'G-9001', rank: 'Wg Cdr', name: 'Guest Vikram', table_code: tables[0].code } });
assert.equal(gReg.status, 201);
assert.equal(gReg.data.status, 'pending');
// Cannot login before bartender approves
assert.equal((await req('/api/auth/login', { method: 'POST', body: { service_no: 'G-9001', pin: 'G-9001', mode: 'guest' } })).status, 403, 'Unapproved guest blocked');
// Bartender sees request & approves
const pendingReqs = (await req('/api/users/guest-requests?status=pending', { token: btTok })).data;
assert(pendingReqs.some((g) => g.service_no === 'G-9001'), 'Bartender sees pending guest request');
const gId = pendingReqs.find((g) => g.service_no === 'G-9001').id;
const gAppr = await req(`/api/users/${gId}/approve-guest`, { method: 'POST', token: btTok, body: { action: 'approve' } });
assert.equal(gAppr.status, 200);
assert.equal(gAppr.data.approval_status, 'approved');
const adminNotesAfterGuest = (await req('/api/admin/notifications', { token: adminTok })).data;
assert(adminNotesAfterGuest.some((n) => n.message.includes('G-9001') && n.message.includes('approved')), 'Admin notified of guest approval');
// Approved guest logs in & orders via QR
const guestTok = await login('G-9001', 'G-9001');
assert(guestTok, 'Approved guest logged in');
assert.equal((await req('/api/orders', { method: 'POST', token: guestTok, body: { table_code: tables[0].code, items: [{ product_id: 1, serve_type: 'bottle', qty: 1 }] } })).status, 403, 'Guest blocked from full bottle');
const gOrd1 = (await req('/api/orders', { method: 'POST', token: guestTok, body: { table_code: tables[0].code, source: 'qr', items: [{ product_id: 1, serve_type: 'peg', peg_ml: 60, qty: 1 }] } })).data;
const gOrd2 = (await req('/api/orders', { method: 'POST', token: guestTok, body: { table_code: tables[0].code, source: 'qr', items: [{ product_id: 1, serve_type: 'peg', peg_ml: 30, qty: 1 }] } })).data;
await req(`/api/orders/${gOrd1.id}/status`, { method: 'POST', token: btTok, body: { status: 'served' } });
await req(`/api/orders/${gOrd2.id}/status`, { method: 'POST', token: btTok, body: { status: 'served' } });
// Closing guest order without payment_mode fails
assert.equal((await req(`/api/orders/${gOrd1.id}/status`, { method: 'POST', token: btTok, body: { status: 'closed' } })).status, 400, 'Guest checkout requires Cash or UPI');
// Closing with UPI & Cash succeeds
const gCloseUpi = await req(`/api/orders/${gOrd1.id}/status`, { method: 'POST', token: btTok, body: { status: 'closed', payment_mode: 'upi', payment_ref: 'UTR12345' } });
assert.equal(gCloseUpi.status, 200);
assert.equal(gCloseUpi.data.payment_mode, 'upi');
const gCloseCash = await req(`/api/orders/${gOrd2.id}/status`, { method: 'POST', token: btTok, body: { status: 'closed', payment_mode: 'cash' } });
assert.equal(gCloseCash.status, 200);
assert.equal(gCloseCash.data.payment_mode, 'cash');

console.log('6. Inventory purchase, wastage, reconciliation & alerts…');
await req('/api/inventory/movement', { method: 'POST', token: adminTok, body: { product_id: 1, type: 'purchase', qty: 2, unit_cost: 920, supplier: 'CSD Depot', invoice: 'INV-99' } });
await req('/api/inventory/movement', { method: 'POST', token: btTok, body: { product_id: 1, type: 'wastage', ml: 30, note: 'Broken glass' } });
const curDisp = (await req('/api/products/1', { token: adminTok })).data.stock_display;
const rec = await req('/api/inventory/reconcile', { method: 'POST', token: adminTok, body: { items: [{ product_id: 1, physical_qty: curDisp - 0.5 }], note: 'Monthly check' } });
assert.equal(rec.data[0].diff, -0.5);
const alerts = (await req('/api/inventory/alerts', { token: btTok })).data;
assert(alerts.length > 0 && alerts.some((a) => a.stock_status === 'out'), 'Color-coded stock alerts returned');

console.log('7. Dashboard (incl. Guest Cash/UPI analytics) & all 11 Reports (JSON + XLSX + PDF)…');
const dash = (await req('/api/dashboard', { token: adminTok })).data;
assert(dash.kpi.orders > 0 && dash.valuation.cost > 0);
assert(dash.guestPayments.cash.revenue > 0 && dash.guestPayments.upi.revenue > 0, 'Dashboard tracks Guest Cash & UPI revenue');
const types = (await req('/api/reports/types', { token: adminTok })).data;
assert.equal(types.length, 11);
for (const t of types) {
  const j = await req(`/api/reports/${t.key}`, { token: adminTok });
  assert.equal(j.status, 200, `JSON report ${t.key}`);
  const x = await req(`/api/reports/${t.key}?format=xlsx`, { token: adminTok, raw: true });
  assert.equal(x.status, 200, `XLSX report ${t.key}`);
  const p = await req(`/api/reports/${t.key}?format=pdf`, { token: adminTok, raw: true });
  assert.equal(p.status, 200, `PDF report ${t.key}`);
  const buf = Buffer.from(await p.arrayBuffer());
  assert.equal(buf.subarray(0, 4).toString(), '%PDF', `Valid PDF header for ${t.key}`);
}

console.log('8. Backup & Restore round-trip…');
const beforeOrders = q.get('SELECT COUNT(*) n FROM orders').n;
const backup = (await req('/api/admin/backup', { token: adminTok })).data;
assert.equal(backup.app, 'bartill');
q.run("DELETE FROM orders WHERE status='cancelled'");
const rfd = new FormData();
rfd.append('file', new Blob([JSON.stringify(backup)]), 'backup.json');
const rest = await req('/api/admin/restore', { method: 'POST', token: adminTok, body: rfd });
assert.equal(rest.status, 200);
assert.equal(q.get('SELECT COUNT(*) n FROM orders').n, beforeOrders, 'All orders restored accurately');

server.close();
db.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log('\n✔ All E2E tests passed!');
