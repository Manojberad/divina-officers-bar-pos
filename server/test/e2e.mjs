import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import * as XLSX from 'xlsx';

// Isolated temp data directory so tests never touch production data
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'divinabar-test-'));
process.env.DATA_DIR = tmp;
process.env.SEED_MODE = 'demo';

const { app } = await import('../src/index.js');
const { q, db } = await import('../src/db.js');
const { expireApprovals, checkTdExpiries } = await import('../src/services.js');

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
const td = await req('/api/users', { method: 'POST', token: adminTok, body: { name: 'Capt TD Test', service_no: 'TD-2001', rank: 'Capt', category: 'TD', role: 'customer', pin: '9988', td_start_date: '2026-01-01', td_end_date: '2026-02-02' } });
assert.equal(td.status, 201);
// Past completion date -> login blocked, expiry job notifies admin & deactivates
assert.equal((await req('/api/auth/login', { method: 'POST', body: { service_no: 'TD-2001', pin: '9988', mode: 'member' } })).status, 403, 'Expired TD officer blocked from login');
assert(checkTdExpiries() >= 1, 'Admin notified of expired TD officer');
assert((await req('/api/admin/notifications', { token: adminTok })).data.some((n) => n.message.includes('TD-2001') && n.message.includes('expired')), 'Admin notification logged for TD expiry');
// Admin extends TD membership by 15 custom days -> reactivates & allows login
const ext = await req(`/api/users/${td.data.id}/extend-td`, { method: 'POST', token: adminTok, body: { days: 15 } });
assert.equal(ext.status, 200);
assert.equal(ext.data.active, 1);
assert(await login('TD-2001', '9988'), 'Extended TD officer logs in with assigned PIN');

// Excel import (also strips trailing alphabetic suffix like 27415-T -> 27415 & supports COURSE)
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
  { Name: 'Maj Excel One', 'Service Number': 'IC-70001', Rank: 'Maj', Mobile: '9999911111', Email: 'e1@bar.local', Category: 'POSTED', Role: 'member' },
  { Name: 'Fg Offr Course One', 'Service Number': '40999-B', Rank: 'Fg Offr', Branch: 'AE(L)', 'List Type': 'Posted Course Officers' },
  { Name: 'Maj Excel Dup', 'Service Number': 'IC-51234', Rank: 'Maj' },
]), 'Officers');
const fd = new FormData();
fd.append('file', new Blob([XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })]), 'officers.xlsx');
const imp = await req('/api/users/import', { method: 'POST', token: adminTok, body: fd });
assert.equal(imp.data.created, 2);
assert.equal(imp.data.skipped.length, 1);
assert(await login('IC-70001', 'IC-70001'), 'Imported Posted-In officer logs in with Service No as PIN');
const courseTok = await login('40999', '40999');
assert(courseTok, 'Course officer suffix stripped (40999-B -> 40999) & logs in');
const courseMe = (await req('/api/auth/me', { token: courseTok })).data;
assert.equal(courseMe.category, 'COURSE');
assert.equal(courseMe.role, 'member');
assert.equal(courseMe.branch, 'AE(L)');

console.log('2b. Super Admin role assignment & 3 Admin-equivalent officer designations…');
const allUsers = (await req('/api/users', { token: adminTok })).data;
const off1 = allUsers.find((u) => u.service_no === 'IC-62345');
const off2 = allUsers.find((u) => u.service_no === 'SS-41234');
const off3 = allUsers.find((u) => u.service_no === 'IC-40001');
const coAssign = await req(`/api/users/${off1.id}/assign-role`, { method: 'POST', token: adminTok, body: { role: 'commanding_officer' } });
assert.equal(coAssign.status, 200);
assert.equal(coAssign.data.designation, 'Commanding Officer');
const msAssign = await req(`/api/users/${off2.id}/assign-role`, { method: 'POST', token: adminTok, body: { role: 'mess_secretary' } });
assert.equal(msAssign.status, 200);
assert.equal(msAssign.data.designation, 'Mess Secretary');
const biAssign = await req(`/api/users/${off3.id}/assign-role`, { method: 'POST', token: adminTok, body: { role: 'bar_incharge' } });
assert.equal(biAssign.status, 200);
assert.equal(biAssign.data.designation, 'Bar Incharge');
// All 3 can sign in on EITHER Member tab or Admin tab and get full Admin rights + official designation
const coLogin = await req('/api/auth/login', { method: 'POST', body: { service_no: 'IC-62345', pin: 'IC-62345', mode: 'member' } });
assert.equal(coLogin.status, 200);
assert.equal(coLogin.data.user.designation, 'Commanding Officer');
const coTok = coLogin.data.token;
assert.equal((await req('/api/auth/login', { method: 'POST', body: { service_no: 'SS-41234', pin: 'SS-41234', mode: 'admin' } })).status, 200, 'Mess Secretary logs in on Admin tab');
const biTok = await login('IC-40001');
assert.equal((await req('/api/dashboard', { token: coTok })).status, 200, 'Commanding Officer accesses Dashboard');
assert.equal((await req('/api/reports/types', { token: biTok })).status, 200, 'Bar Incharge accesses Reports');
assert.equal((await req('/api/users', { token: coTok })).status, 200, 'Commanding Officer views Users');
// Non-SuperAdmin privileged officer CANNOT assign privileged roles or edit Super Admin
assert.equal((await req(`/api/users/${off3.id}/assign-role`, { method: 'POST', token: coTok, body: { role: 'member' } })).status, 403, 'CO cannot assign privileged roles');
assert.equal((await req('/api/users/1', { method: 'PUT', token: coTok, body: { name: 'Hacked' } })).status, 403, 'CO cannot modify Super Admin');
// Revert test officers back to member via Super Admin so subsequent tests stay clean
await req(`/api/users/${off1.id}/assign-role`, { method: 'POST', token: adminTok, body: { role: 'member' } });
await req(`/api/users/${off2.id}/assign-role`, { method: 'POST', token: adminTok, body: { role: 'member' } });
await req(`/api/users/${off3.id}/assign-role`, { method: 'POST', token: adminTok, body: { role: 'member' } });

console.log('3. Auto-accept/auto-bill POS, bartender edit/cancel with stock reversal, Favorite Orders & Category Profit Margins…');
const whisky = (await req('/api/products/1', { token: btTok })).data;
const startMl = whisky.stock;
const uuid = 'offline-uuid-test-001';
const o1 = await req('/api/orders', { method: 'POST', token: btTok, body: { client_uuid: uuid, user_id: 3, items: [{ product_id: 1, serve_type: 'peg', peg_ml: 60, qty: 2 }] } });
const o1Replay = await req('/api/orders', { method: 'POST', token: btTok, body: { client_uuid: uuid, user_id: 3, items: [{ product_id: 1, serve_type: 'peg', peg_ml: 60, qty: 2 }] } });
assert.equal(o1.status, 201);
assert.equal(o1.data.status, 'closed', 'On-demand order auto-accepted & auto-billed immediately');
assert.equal(o1Replay.status, 200);
assert.equal(o1Replay.data.duplicate, true);
assert.equal(o1.data.id, o1Replay.data.id, 'Offline replay did not create duplicate order');

const oid = o1.data.id;
const afterAutoBillMl = (await req('/api/products/1', { token: btTok })).data.stock;
assert.equal(afterAutoBillMl, startMl - 120, 'Deducted 2 x 60ml = 120ml immediately on auto-bill');

// Bartender edits an auto-billed order (reduces 2x60ml -> 1x30ml) -> 90ml restored atomically
const edited = await req(`/api/orders/${oid}/items`, { method: 'PUT', token: btTok, body: { items: [{ product_id: 1, serve_type: 'peg', peg_ml: 30, qty: 1 }], reason: 'Reduced qty' } });
assert.equal(edited.status, 200);
assert.equal((await req('/api/products/1', { token: btTok })).data.stock, startMl - 30, 'Stock adjusted cleanly on bartender order edit');
// Restore back to 2x60ml for rest of test
await req(`/api/orders/${oid}/items`, { method: 'PUT', token: btTok, body: { items: [{ product_id: 1, serve_type: 'peg', peg_ml: 60, qty: 2 }] } });
assert.equal((await req('/api/products/1', { token: btTok })).data.stock, afterAutoBillMl);

// Bartender cancels an auto-billed full-bottle order (e.g. item unavailable) -> stock restored automatically
const oCancel = (await req('/api/orders', { method: 'POST', token: btTok, body: { items: [{ product_id: 1, serve_type: 'bottle', qty: 1 }] } })).data;
assert.equal((await req('/api/products/1', { token: btTok })).data.stock, afterAutoBillMl - 750);
assert.equal((await req(`/api/orders/${oCancel.id}/status`, { method: 'POST', token: btTok, body: { status: 'cancelled', note: 'Item unavailable' } })).status, 200, 'Bartender can cancel auto-billed order');
assert.equal((await req('/api/products/1', { token: btTok })).data.stock, afterAutoBillMl, 'Stock restored after bartender cancelled order');

// Member Favorite Orders (create + list + 1-tap repeat)
const favCreate = await req('/api/orders/favorites', { method: 'POST', token: memTok, body: { name: 'My Evening Usual', items: [{ product_id: 1, serve_type: 'peg', peg_ml: 30, qty: 1 }] } });
assert.equal(favCreate.status, 201);
const favList = (await req('/api/orders/favorites', { token: memTok })).data;
assert(favList.some((f) => f.name === 'My Evening Usual' && f.live_total > 0), 'Member sees saved Favorite Order');
const favRepeat = await req(`/api/orders/favorites/${favCreate.data.id}/reorder`, { method: 'POST', token: memTok, body: {} });
assert.equal(favRepeat.status, 201);
assert.equal(favRepeat.data.status, 'closed', 'Repeat Favorite Order auto-accepted & billed');

// Category Profit Margin % recalculates selling & peg prices
const catsList = (await req('/api/categories', { token: adminTok })).data;
assert(catsList.some((c) => c.name === 'Cigarettes' && Number(c.profit_margin) === 7.5), 'Cigarettes category present with 7.5% margin');
assert(catsList.some((c) => c.name === 'Miscellaneous' && Number(c.profit_margin) === 10), 'Miscellaneous category present with 10% default margin');
const alcCat = catsList.find((c) => c.name === 'Alcohol');
const marginUpd = await req(`/api/categories/${alcCat.id}`, { method: 'PUT', token: adminTok, body: { profit_margin: 5, apply_margin: true } });
assert.equal(marginUpd.status, 200);
assert(marginUpd.data.updated_products > 0, 'Alcohol profit margin applied to products');

console.log('4. Customer order approval, dispute notification & 24h auto-expiry…');
const appRes = await req(`/api/orders/${oid}/approve`, { method: 'POST', token: memTok });
assert.equal(appRes.data.approval_status, 'approved');

// Dispute workflow
const oDisp = (await req('/api/orders', { method: 'POST', token: btTok, body: { user_id: 3, items: [{ product_id: 1, serve_type: 'peg', peg_ml: 30, qty: 1 }] } })).data;
const dispRes = await req(`/api/orders/${oDisp.id}/dispute`, { method: 'POST', token: memTok, body: { note: 'Ordered 30ml, billed wrong' } });
assert.equal(dispRes.data.status, 'disputed');
const notes = (await req('/api/admin/notifications', { token: adminTok })).data;
assert(notes.some((n) => n.message.includes(oDisp.order_no)), 'Admin notified of dispute');
const resolved = await req(`/api/orders/${oDisp.id}/status`, { method: 'POST', token: adminTok, body: { status: 'closed', note: 'Verified with bartender' } });
assert.equal(resolved.data.status, 'closed');
assert.equal(resolved.data.approval_status, 'approved');

// 24h expiry job
const oExp = (await req('/api/orders', { method: 'POST', token: btTok, body: { user_id: 3, items: [{ product_id: 9, qty: 1 }] } })).data;
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
const multiServe = await req('/api/orders', { method: 'POST', token: memTok, body: { items: [{ product_id: 1, serve_type: 'peg', peg_ml: 30, qty: 1 }, { product_id: 1, serve_type: 'peg', peg_ml: 60, qty: 1 }] } });
assert.equal(multiServe.status, 201, 'Member allowed Small(30ml) & Large(60ml) and auto-billed without UNIQUE constraint error');
assert.equal(multiServe.data.status, 'closed');
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

console.log('5d. Alcohol order limits (Admin configurable 3/4 Small/Large pegs for Guests & Members)…');
// Guest already ordered 2 pegs today; default guest_alcohol_limit is 3 -> requesting 2 more (total 4 > 3) must fail
assert.equal(
  (await req('/api/orders', { method: 'POST', token: guestTok, body: { table_code: tables[0].code, items: [{ product_id: 1, serve_type: 'peg', peg_ml: 30, qty: 2 }] } })).status,
  400,
  'Guest blocked from exceeding default 3-peg alcohol limit',
);
// Admin updates guest_alcohol_limit to 4 and member_alcohol_limit to 3
assert.equal((await req('/api/admin/settings', { method: 'PUT', token: adminTok, body: { guest_alcohol_limit: '4', member_alcohol_limit: '3' } })).status, 200);
// Now Guest ordering 2 more (total 4 <= 4) succeeds, and 1 more (total 5 > 4) fails
assert.equal(
  (await req('/api/orders', { method: 'POST', token: guestTok, body: { table_code: tables[0].code, items: [{ product_id: 1, serve_type: 'peg', peg_ml: 60, qty: 2 }] } })).status,
  201,
  'Guest allowed up to updated 4-peg limit',
);
assert.equal(
  (await req('/api/orders', { method: 'POST', token: guestTok, body: { table_code: tables[0].code, items: [{ product_id: 1, serve_type: 'peg', peg_ml: 30, qty: 1 }] } })).status,
  400,
  'Guest blocked on 5th peg when limit is 4',
);
// Member trying to order 4 pegs when member_alcohol_limit is 3 fails
assert.equal(
  (await req('/api/orders', { method: 'POST', token: memTok, body: { items: [{ product_id: 1, serve_type: 'peg', peg_ml: 30, qty: 4 }] } })).status,
  400,
  'Member blocked from exceeding configured 3-peg limit',
);
// Reset member limit back to 0 (unlimited)
await req('/api/admin/settings', { method: 'PUT', token: adminTok, body: { member_alcohol_limit: '0' } });

console.log('6. Inventory purchase, wastage, reconciliation, Excel product import & alerts…');
const pTpl = await req('/api/products/template', { token: adminTok, raw: true });
assert.equal(pTpl.status, 200, 'Products Excel template downloadable');
const pwb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(pwb, XLSX.utils.json_to_sheet([
  { Name: 'Paneer Tikka', Category: 'Food', 'Sub Category': 'Veg', 'Food Type': 'Veg', Unit: 'plate', 'Is Peg': 'No', 'Purchase Price': 100, 'Selling Price': 220, 'Opening Stock': 10 },
  { Name: 'Filter Coffee', Category: 'Hot Beverages', Unit: 'cup', 'Is Peg': 'No', 'Purchase Price': 20, 'Selling Price': 50, 'Opening Stock': 25 },
]), 'Products');
const pfd = new FormData();
pfd.append('file', new Blob([XLSX.write(pwb, { type: 'buffer', bookType: 'xlsx' })]), 'products.xlsx');
const pImp = await req('/api/products/import', { method: 'POST', token: adminTok, body: pfd });
assert.equal(pImp.status, 200);
assert.equal(pImp.data.created, 2, 'Imported 2 products from Excel');
assert.equal(pImp.data.categories_created, 1, 'Auto-created new category from Excel');
const allProds = (await req('/api/products?all=1', { token: adminTok })).data;
assert.equal(allProds.find((p) => p.name === 'Paneer Tikka')?.food_type, 'veg', 'Veg food_type saved');
assert.equal(allProds.find((p) => p.name === 'Chicken Tikka')?.food_type, 'nonveg', 'Non-Veg food_type saved');
await req('/api/inventory/movement', { method: 'POST', token: adminTok, body: { product_id: 1, type: 'purchase', qty: 2, unit_cost: 920, supplier: 'CSD Depot', invoice: 'INV-99' } });
await req('/api/inventory/movement', { method: 'POST', token: btTok, body: { product_id: 1, type: 'wastage', ml: 30, note: 'Broken glass' } });
const curDisp = (await req('/api/products/1', { token: adminTok })).data.stock_display;
const rec = await req('/api/inventory/reconcile', { method: 'POST', token: adminTok, body: { items: [{ product_id: 1, physical_qty: curDisp - 0.5 }], note: 'Monthly check' } });
assert.equal(rec.data[0].diff, -0.5);
const alerts = (await req('/api/inventory/alerts', { token: btTok })).data;
assert(alerts.length > 0 && alerts.some((a) => a.stock_status === 'out'), 'Color-coded stock alerts returned');

console.log('6b. Recipe-based Mocktails (Blue Lagoon & Mint Mojito): dynamic cost, atomic deduction, rollback, idempotency, edit, cancel & reporting…');
const mockCatId = (await req('/api/categories', { token: adminTok })).data.find((c) => c.name === 'Mocktails').id;
const softCatId = (await req('/api/categories', { token: adminTok })).data.find((c) => c.name === 'Soft Drinks').id;
const miscCatId = (await req('/api/categories', { token: adminTok })).data.find((c) => c.name === 'Miscellaneous').id;

const mkProd = async (body) => (await req('/api/products', { method: 'POST', token: adminTok, body })).data;
const blueCuracao = await mkProd({ name: 'BLUE CURACAO', category_id: softCatId, sub_category: 'Soda', unit: 'loose', is_peg: false, purchase_price: 11.2, selling_price: 12.32, opening_stock: 42 });
const mintSyrup = await mkProd({ name: 'MINT SYRUP', category_id: softCatId, sub_category: 'Soda', unit: 'loose', is_peg: false, purchase_price: 11.96, selling_price: 13.16, opening_stock: 63 });
const soft250 = await mkProd({ name: 'SOFT 250 ML', category_id: softCatId, sub_category: 'Soda', unit: 'bottle', is_peg: false, purchase_price: 18, selling_price: 19.8, opening_stock: 57 });
const soda300 = await mkProd({ name: 'SODA 300 ML', category_id: softCatId, sub_category: 'Soda', unit: 'bottle', is_peg: false, purchase_price: 9.15, selling_price: 10.07, opening_stock: 56 });
const freshLime = await mkProd({ name: 'FRESH LIME', category_id: miscCatId, unit: 'each', is_peg: false, purchase_price: 15.5, selling_price: 15.5, opening_stock: 20 });

const blueLagoon = await mkProd({ name: 'BLUE LAGOON', category_id: mockCatId, unit: 'glass', is_peg: false, is_recipe: true, selling_price: 69.37 });
const mintMojito = await mkProd({ name: 'MINT MOJITO', category_id: mockCatId, unit: 'glass', is_peg: false, is_recipe: true, selling_price: 76.39 });

const blRecRes = await req(`/api/products/${blueLagoon.id}/recipe`, {
  method: 'PUT', token: adminTok,
  body: {
    ingredients: [
      { ingredient_id: blueCuracao.id, qty: 2, display_qty: 60, display_unit: 'ml' },
      { ingredient_id: soft250.id, qty: 1, display_qty: 250, display_unit: 'ml' },
      { ingredient_id: soda300.id, qty: 1, display_qty: 250, display_unit: 'ml' },
      { ingredient_id: freshLime.id, qty: 1, display_qty: 1, display_unit: 'piece' },
    ],
  },
});
assert.equal(blRecRes.status, 200);
assert.equal(blRecRes.data.recipe_cost, 65.05, 'Blue Lagoon dynamic recipe cost = 22.40 + 18 + 9.15 + 15.50');
assert.equal(blRecRes.data.stock_display, 20, 'Blue Lagoon makeable qty limited by 20 limes');

const mmRecRes = await req(`/api/products/${mintMojito.id}/recipe`, {
  method: 'PUT', token: adminTok,
  body: {
    ingredients: [
      { ingredient_id: mintSyrup.id, qty: 2, display_qty: 60, display_unit: 'ml' },
      { ingredient_id: soft250.id, qty: 1, display_qty: 250, display_unit: 'ml' },
      { ingredient_id: soda300.id, qty: 1, display_qty: 250, display_unit: 'ml' },
      { ingredient_id: freshLime.id, qty: 1, display_qty: 1, display_unit: 'piece' },
    ],
  },
});
assert.equal(mmRecRes.status, 200);
assert.equal(mmRecRes.data.recipe_cost, 66.57, 'Mint Mojito dynamic recipe cost = 23.92 + 18 + 9.15 + 15.50');

// Customer/public POS view sees finished mocktails & selling prices only (no recipe internals)
const pubProds = (await req('/api/products', { token: memTok })).data;
const pubBL = pubProds.find((x) => x.id === blueLagoon.id);
assert.equal(pubBL.selling_price, 69.37);
assert.equal(pubBL.available, true);
assert.equal(pubBL.recipe, undefined, 'Public POS hides recipe internals');

// Dynamic cost updates when ingredient purchase price changes, while selling price stays independent
await req(`/api/products/${freshLime.id}`, { method: 'PUT', token: adminTok, body: { purchase_price: 13 } });
const blAfterPrice = (await req(`/api/products/${blueLagoon.id}`, { token: adminTok })).data;
assert.equal(blAfterPrice.recipe_cost, 62.55, 'Blue Lagoon recipe cost updated dynamically when Lime price changed to ₹13');
assert.equal(blAfterPrice.selling_price, 69.37, 'Mocktail selling price remains independent of ingredient cost');
// Restore Lime price to 15.50
await req(`/api/products/${freshLime.id}`, { method: 'PUT', token: adminTok, body: { purchase_price: 15.5 } });

// Proportional deduction: 3 Blue Lagoons -> 6 loose (180ml) Blue Curacao, 3 Soft, 3 Soda, 3 Limes
const stockOf = (id) => q.get('SELECT stock FROM products WHERE id=?', id).stock;
const blUuid = 'recipe-test-bl-3-uuid';
const blOrd = await req('/api/orders', { method: 'POST', token: memTok, body: { client_uuid: blUuid, items: [{ product_id: blueLagoon.id, qty: 3 }] } });
assert.equal(blOrd.status, 201);
assert.equal(blOrd.data.total, 208.11, '3 x 69.37 = 208.11');
assert.equal(stockOf(blueCuracao.id), 36, 'Blue Curacao: 42 - 6 loose (180ml) = 36');
assert.equal(stockOf(soft250.id), 54, 'Soft 250ml: 57 - 3 = 54');
assert.equal(stockOf(soda300.id), 53, 'Soda 300ml: 56 - 3 = 53');
assert.equal(stockOf(freshLime.id), 17, 'Fresh Lime: 20 - 3 = 17');

// Idempotency: duplicate client_uuid retry must NOT double-deduct
const blRetry = await req('/api/orders', { method: 'POST', token: memTok, body: { client_uuid: blUuid, items: [{ product_id: blueLagoon.id, qty: 3 }] } });
assert.equal(blRetry.status, 200);
assert.equal(stockOf(blueCuracao.id), 36, 'Retry did not double-deduct Blue Curacao');
assert.equal(stockOf(freshLime.id), 17, 'Retry did not double-deduct Fresh Lime');

// Bartender edits 3 Blue Lagoons -> 2 Blue Lagoons (restores exactly 1 drink's ingredients atomically)
const blEdit = await req(`/api/orders/${blOrd.data.id}/items`, { method: 'PUT', token: btTok, body: { items: [{ product_id: blueLagoon.id, qty: 2 }], reason: 'Reduced qty' } });
assert.equal(blEdit.status, 200);
assert.equal(stockOf(blueCuracao.id), 38, 'Edit restored 2 loose (60ml) Blue Curacao');
assert.equal(stockOf(soft250.id), 55);
assert.equal(stockOf(soda300.id), 54);
assert.equal(stockOf(freshLime.id), 18);

// Cancel Blue Lagoon order -> restores exact remaining 2 drinks' ingredients ONCE (no duplicate restore)
const blCancel = await req(`/api/orders/${blOrd.data.id}/status`, { method: 'POST', token: btTok, body: { status: 'cancelled', note: 'Test cancel' } });
assert.equal(blCancel.status, 200);
assert.equal(stockOf(blueCuracao.id), 42, 'Cancel restored full Blue Curacao stock');
assert.equal(stockOf(soft250.id), 57, 'Cancel restored full Soft 250ml stock');
assert.equal(stockOf(soda300.id), 56, 'Cancel restored full Soda 300ml stock');
assert.equal(stockOf(freshLime.id), 20, 'Cancel restored full Fresh Lime stock');
const blCancel2 = await req(`/api/orders/${blOrd.data.id}/status`, { method: 'POST', token: btTok, body: { status: 'cancelled' } });
assert([200, 409].includes(blCancel2.status), 'Second cancel is idempotent / blocked');
assert.equal(stockOf(blueCuracao.id), 42, 'No duplicate restoration for Blue Curacao');
assert.equal(stockOf(soft250.id), 57, 'No duplicate restoration for Soft 250ml');
assert.equal(stockOf(soda300.id), 56, 'No duplicate restoration for Soda 300ml');
assert.equal(stockOf(freshLime.id), 20, 'No duplicate restoration for Fresh Lime');
assert.equal(q.get("SELECT COUNT(*) n FROM stock_movements WHERE order_id=? AND type='sale_reversal'", blOrd.data.id).n, 4, 'Exactly 4 reversal rows recorded once');

// Order 5 Blue Lagoons + 2 Mint Mojitos (checks both recipes + combined consumption reporting)
const bl5 = await req('/api/orders', { method: 'POST', token: memTok, body: { items: [{ product_id: blueLagoon.id, qty: 5 }] } });
assert.equal(bl5.status, 201);
const mm2 = await req('/api/orders', { method: 'POST', token: guestTok, body: { table_code: tables[0].code, items: [{ product_id: mintMojito.id, qty: 2 }] } });
assert.equal(mm2.status, 201);
assert.equal(mm2.data.status, 'served', 'Guest mocktail order auto-accepted & deducted awaiting Cash/UPI');
assert.equal(stockOf(blueCuracao.id), 32, '5 Blue Lagoons deducted 10 loose (300ml) Blue Curacao');
assert.equal(stockOf(mintSyrup.id), 59, '2 Mint Mojitos deducted 4 loose (120ml) Mint Syrup');
assert.equal(stockOf(soft250.id), 50, '5 + 2 mocktails deducted 7 Soft 250ml (1750ml)');
assert.equal(stockOf(soda300.id), 49, '5 + 2 mocktails deducted 7 Soda 300ml (1750ml)');
assert.equal(stockOf(freshLime.id), 13, '5 + 2 mocktails deducted 7 Fresh Limes');

// Guest payment status transition (served -> closed via UPI) must NOT double-deduct ingredients
const mmPay = await req(`/api/orders/${mm2.data.id}/status`, { method: 'POST', token: btTok, body: { status: 'closed', payment_mode: 'upi', payment_ref: 'UPI-MOCK-1' } });
assert.equal(mmPay.status, 200);
assert.equal(stockOf(mintSyrup.id), 59, 'Payment settlement did not double-deduct Mint Syrup');
assert.equal(stockOf(freshLime.id), 13, 'Payment settlement did not double-deduct Fresh Lime');

// Stock validation & atomic rollback: combined order needing 14 Limes when only 13 left must FAIL cleanly with 0 partial deductions
const overLimit = await req('/api/orders', {
  method: 'POST', token: memTok,
  body: { items: [{ product_id: blueLagoon.id, qty: 8 }, { product_id: mintMojito.id, qty: 6 }] },
});
assert.equal(overLimit.status, 409, 'Insufficient shared ingredient blocks order');
assert(/FRESH LIME/i.test(overLimit.data.error), `Error names unavailable ingredient (got: ${overLimit.data.error})`);
assert.equal(stockOf(blueCuracao.id), 32, 'Rollback preserved Blue Curacao');
assert.equal(stockOf(mintSyrup.id), 59, 'Rollback preserved Mint Syrup');
assert.equal(stockOf(soft250.id), 50, 'Rollback preserved Soft 250ml');
assert.equal(stockOf(soda300.id), 49, 'Rollback preserved Soda 300ml');
assert.equal(stockOf(freshLime.id), 13, 'Rollback preserved Fresh Lime');

// Verify Sales Report lists BLUE LAGOON (not ingredients) & Recipe Consumption Report records exact 5-Blue-Lagoon consumption
const prodRep = (await req('/api/reports/product', { token: adminTok })).data;
assert(prodRep.rows.some((r) => r.name === 'BLUE LAGOON' && r.qty === 5), 'Sales report lists 5 BLUE LAGOON');
assert(!prodRep.rows.some((r) => r.name === 'BLUE CURACAO'), 'Sales report does not list raw recipe ingredients as sold items');
const rcRep = (await req('/api/reports/recipe_consumption', { token: adminTok })).data;
const bl5Rows = rcRep.rows.filter((r) => r.order_no === bl5.data.order_no);
assert.equal(bl5Rows.length, 4, '4 ingredient rows recorded for 5 Blue Lagoons');
assert.equal(bl5Rows.find((r) => r.ingredient_name === 'BLUE CURACAO').qty_consumed, 300, '5 Blue Lagoons -> 300 ml Blue Curacao');
assert.equal(bl5Rows.find((r) => r.ingredient_name === 'SOFT 250 ML').qty_consumed, 1250, '5 Blue Lagoons -> 1250 ml Soft Drink');
assert.equal(bl5Rows.find((r) => r.ingredient_name === 'SODA 300 ML').qty_consumed, 1250, '5 Blue Lagoons -> 1250 ml Soda');
assert.equal(bl5Rows.find((r) => r.ingredient_name === 'FRESH LIME').qty_consumed, 5, '5 Blue Lagoons -> 5 piece Lime');

console.log('6c. Coke & Sprite (250ml regular / 750ml Party Only), Tonic Water Can (₹88), Lime (₹13) & Local-Purchase Miscellaneous (dynamic cost+10% pricing & profit)…');
const coke250 = await mkProd({ name: 'Coca-Cola 250 ml', category_id: softCatId, sub_category: 'Soda', brand: 'Coca-Cola', size_ml: 250, unit: 'bottle', is_peg: false, party_only: false, purchase_price: 18, selling_price: 20, opening_stock: 30 });
const coke750 = await mkProd({ name: 'Coca-Cola 750 ml', category_id: softCatId, sub_category: 'Soda', brand: 'Coca-Cola', size_ml: 750, unit: 'bottle', is_peg: false, party_only: true, purchase_price: 36, selling_price: 40, opening_stock: 24 });
const sprite250 = await mkProd({ name: 'Sprite 250 ml', category_id: softCatId, sub_category: 'Soda', brand: 'Sprite', size_ml: 250, unit: 'bottle', is_peg: false, party_only: false, purchase_price: 18, selling_price: 20, opening_stock: 30 });
const sprite750 = await mkProd({ name: 'Sprite 750 ml', category_id: softCatId, sub_category: 'Soda', brand: 'Sprite', size_ml: 750, unit: 'bottle', is_peg: false, party_only: true, purchase_price: 36, selling_price: 40, opening_stock: 24 });
const tonicCan = (await req('/api/products?all=1', { token: adminTok })).data.find((x) => /tonic water/i.test(x.name));
await req(`/api/products/${tonicCan.id}`, { method: 'PUT', token: adminTok, body: { unit: 'can', purchase_price: 60, selling_price: 88 } });
await req('/api/inventory/movement', { method: 'POST', token: adminTok, body: { product_id: tonicCan.id, type: 'purchase', qty: 10, unit_cost: 60, note: 'Restock cans' } });

const coconutWater = await mkProd({ name: 'Coconut Water', category_id: miscCatId, unit: 'unit', is_peg: false, is_local_purchase: true });
const freshFruitJuice = await mkProd({ name: 'Fresh Fruit Juices', category_id: miscCatId, unit: 'glass', is_peg: false, is_local_purchase: true });
const sugarcaneJuice = await mkProd({ name: 'Sugarcane Juice', category_id: miscCatId, unit: 'glass', is_peg: false, is_local_purchase: true });

// Public / regular customer product list hides 750ml Party Only variants & bartender local-purchase items
const regList = (await req('/api/products', { token: memTok })).data;
assert(regList.some((x) => x.id === coke250.id && x.selling_price === 20), 'Regular customer sees Coke 250ml @ ₹20');
assert(regList.some((x) => x.id === sprite250.id && x.selling_price === 20), 'Regular customer sees Sprite 250ml @ ₹20');
assert(!regList.some((x) => x.id === coke750.id || x.id === sprite750.id), '750ml Party-Only variants hidden from regular customers');
assert(!regList.some((x) => x.id === coconutWater.id), 'Bartender local-purchase items hidden from regular customer catalog');

// Backend enforces Party-Only restriction & whole-unit packaging
assert.equal((await req('/api/orders', { method: 'POST', token: memTok, body: { items: [{ product_id: coke750.id, qty: 1 }] } })).status, 403, 'Member blocked from ordering Coke 750ml');
assert.equal((await req('/api/orders', { method: 'POST', token: memTok, body: { is_party: true, items: [{ product_id: coke750.id, qty: 1 }] } })).status, 403, 'Member cannot forge Party Order flag');
assert.equal((await req('/api/orders', { method: 'POST', token: btTok, body: { is_party: false, items: [{ product_id: sprite750.id, qty: 1 }] } })).status, 403, 'Regular bartender order blocked from Sprite 750ml');
assert.equal((await req('/api/orders', { method: 'POST', token: memTok, body: { items: [{ product_id: coke250.id, qty: 0.5 }] } })).status, 400, 'Partial bottle splitting rejected');

// Regular order: 3 Coke 250ml (₹60), 2 Sprite 250ml (₹40), 2 Tonic Water cans (₹176)
const tonicBefore = stockOf(tonicCan.id);
const bevOrd = await req('/api/orders', {
  method: 'POST', token: memTok,
  body: { items: [{ product_id: coke250.id, qty: 3 }, { product_id: sprite250.id, qty: 2 }, { product_id: tonicCan.id, qty: 2 }] },
});
assert.equal(bevOrd.status, 201);
assert.equal(bevOrd.data.total, 276, '3*20 + 2*20 + 2*88 = 276');
assert.equal(stockOf(coke250.id), 27, '3 complete Coke 250ml bottles deducted');
assert.equal(stockOf(sprite250.id), 28, '2 complete Sprite 250ml bottles deducted');
assert.equal(stockOf(tonicCan.id), tonicBefore - 2, '2 complete Tonic Water cans deducted');

// Admin configures Coke 750ml price (₹40 -> ₹45) & places Party Order with both 250ml and 750ml
await req(`/api/products/${coke750.id}`, { method: 'PUT', token: adminTok, body: { selling_price: 45 } });
const partyOrd = await req('/api/orders', {
  method: 'POST', token: btTok,
  body: { user_id: 3, is_party: true, items: [{ product_id: coke250.id, qty: 2 }, { product_id: coke750.id, qty: 3 }, { product_id: sprite750.id, qty: 2 }] },
});
assert.equal(partyOrd.status, 201);
assert.equal(partyOrd.data.is_party, 1);
assert.equal(partyOrd.data.total, 255, '2*20 + 3*45 + 2*40 = 255');
assert.equal(stockOf(coke250.id), 25);
assert.equal(stockOf(coke750.id), 21);
assert.equal(stockOf(sprite750.id), 22);

// Insufficient stock on 750ml Party Order rejected cleanly without deducting anything
assert.equal((await req('/api/orders', { method: 'POST', token: btTok, body: { is_party: true, items: [{ product_id: coke750.id, qty: 99 }] } })).status, 409);
assert.equal(stockOf(coke750.id), 21);

// Cancel Party Order & verify exact stock restoration (plus keep a fresh smaller Party Order for reports)
await req(`/api/orders/${partyOrd.data.id}/status`, { method: 'POST', token: btTok, body: { status: 'cancelled', note: 'Party postponed' } });
assert.equal(stockOf(coke250.id), 27, 'Cancelled party order restored Coke 250ml');
assert.equal(stockOf(coke750.id), 24, 'Cancelled party order restored Coke 750ml');
assert.equal(stockOf(sprite750.id), 24, 'Cancelled party order restored Sprite 750ml');
const partyOrd2 = await req('/api/orders', {
  method: 'POST', token: btTok,
  body: { user_id: 3, is_party: true, items: [{ product_id: coke750.id, qty: 2 }, { product_id: sprite750.id, qty: 1 }] },
});
assert.equal(partyOrd2.status, 201);

// Locally Purchased Miscellaneous items: dynamic pricing formula (+10%), no inventory deduction, cost hidden from customers!
assert.equal((await req('/api/orders', { method: 'POST', token: memTok, body: { items: [{ product_id: coconutWater.id, qty: 1, purchase_cost: 50 }] } })).status, 403, 'Customer cannot directly submit local-purchase misc item');
assert.equal((await req('/api/orders', { method: 'POST', token: btTok, body: { items: [{ product_id: coconutWater.id, qty: 1 }] } })).status, 400, 'Purchase cost required for local-purchase misc item');

const miscOrd = await req('/api/orders', {
  method: 'POST', token: btTok,
  body: {
    user_id: 3,
    items: [
      { product_id: coconutWater.id, qty: 1, purchase_cost: 30 },     // 30 -> 33
      { product_id: freshFruitJuice.id, qty: 1, purchase_cost: 75 },  // 75 -> 82.50
      { product_id: sugarcaneJuice.id, qty: 2, purchase_cost: 50 },   // 50 -> 55 x 2 = 110
    ],
  },
});
assert.equal(miscOrd.status, 201);
assert.equal(miscOrd.data.total, 225.5, '33 + 82.50 + 110 = 225.50');
assert.equal(q.get('SELECT COUNT(*) n FROM stock_movements WHERE product_id IN (?,?,?)', coconutWater.id, freshFruitJuice.id, sugarcaneJuice.id).n, 0, 'Local-purchase items never touch stocked inventory');

// Customer-facing bill hides purchase_cost while staff sees it
const custView = (await req(`/api/orders/${miscOrd.data.id}`, { token: memTok })).data;
assert(custView.items.every((i) => i.purchase_cost === undefined), 'Customer bill never exposes purchase cost or margin');
const staffView = (await req(`/api/orders/${miscOrd.data.id}`, { token: btTok })).data;
assert.equal(staffView.items.find((i) => i.product_id === freshFruitJuice.id).purchase_cost, 75, 'Staff view retains purchase cost');

// Admin changes Miscellaneous default profit margin (10% -> 20%), orders ₹50 -> ₹60, then cancels & restores 10%
await req(`/api/categories/${miscCatId}`, { method: 'PUT', token: adminTok, body: { profit_margin: 20 } });
const miscOrd20 = await req('/api/orders', { method: 'POST', token: btTok, body: { user_id: 3, items: [{ product_id: coconutWater.id, qty: 1, purchase_cost: 50 }] } });
assert.equal(miscOrd20.status, 201);
assert.equal(miscOrd20.data.total, 60, 'Updated 20% margin: ₹50 -> ₹60');
await req(`/api/orders/${miscOrd20.data.id}/status`, { method: 'POST', token: btTok, body: { status: 'cancelled' } });
assert.equal(q.get('SELECT reversed FROM misc_transactions WHERE order_id=?', miscOrd20.data.id).reversed, 1, 'Cancelled misc order marked reversed');
await req(`/api/categories/${miscCatId}`, { method: 'PUT', token: adminTok, body: { profit_margin: 10 } });

// Verify Packaged Beverages & Miscellaneous Profit reports
const bevRep = (await req('/api/reports/packaged_beverages', { token: adminTok })).data;
assert.equal(bevRep.rows.find((r) => r.name === 'Coca-Cola 250 ml').regular_qty, 3);
assert.equal(bevRep.rows.find((r) => r.name === 'Coca-Cola 750 ml').party_qty, 2);
assert.equal(bevRep.rows.find((r) => r.name === 'Sprite 250 ml').regular_qty, 2);
assert.equal(bevRep.rows.find((r) => r.name === 'Sprite 750 ml').party_qty, 1);
assert(bevRep.rows.find((r) => /tonic water/i.test(r.name)).total_qty >= 2, 'Tonic Water cans included in Packaged Beverages report');
const miscRep = (await req('/api/reports/misc_local', { token: adminTok })).data;
assert.equal(miscRep.totals.total_purchase_cost, 205, '30 + 75 + 100 = 205 (cancelled excluded)');
assert.equal(miscRep.totals.total_selling_value, 225.5, '33 + 82.50 + 110 = 225.50');
assert.equal(miscRep.totals.profit, 20.5, '10% profit earned = ₹20.50');

console.log('6d. Guest Auto-Login Approval, Edit Order (All Users + Audit), Shifts & Repeat Drinks/Order…');
// 1) Guest Auto-Login on Bartender Approval + Session Revocation
const gAutoReg = await req('/api/auth/guest-register', {
  method: 'POST',
  body: { service_no: 'G-AUTO-1', rank: 'Maj', name: 'Auto Login Guest', mobile: '9000011111' },
});
assert.equal(gAutoReg.status, 201);
assert.equal(gAutoReg.data.status, 'pending');
assert(gAutoReg.data.request_token, 'Pending guest receives secure claim token');

const claimBefore = await req('/api/auth/guest-claim', {
  method: 'POST',
  body: { service_no: 'G-AUTO-1', request_token: gAutoReg.data.request_token },
});
assert.equal(claimBefore.status, 200);
assert.equal(claimBefore.data.status, 'pending');
assert.equal(claimBefore.data.token, undefined, 'Pending guest does not get auth token before approval');

const gAutoApprove = await req(`/api/users/${gAutoReg.data.user.id}/approve-guest`, {
  method: 'POST', token: btTok, body: { action: 'approve', alcohol_limit: 4 },
});
assert.equal(gAutoApprove.status, 200);

const claimAfter = await req('/api/auth/guest-claim', {
  method: 'POST',
  body: { service_no: 'G-AUTO-1', request_token: gAutoReg.data.request_token },
});
assert.equal(claimAfter.status, 200);
assert.equal(claimAfter.data.status, 'approved');
assert(claimAfter.data.token, 'Approved guest automatically receives live session token');
assert.equal(claimAfter.data.message, 'Your access has been approved. Welcome!');
const autoGuestTok = claimAfter.data.token;
assert.equal((await req('/api/auth/me', { token: autoGuestTok })).status, 200, 'Auto-logged-in guest session works immediately');
assert.equal((await req('/api/dashboard', { token: autoGuestTok })).status, 403, 'Auto-logged-in guest retains role restrictions');

// 2) Edit Order Option for Every User (Guest on unsettled order + Member on unapproved order + Lock rules + Audit Trail)
const blStock0 = stockOf(blueCuracao.id);
const limeStock0 = stockOf(freshLime.id);
const cokeStock0 = stockOf(coke250.id);
const spriteStock0 = stockOf(sprite250.id);

const gAutoOrd = await req('/api/orders', {
  method: 'POST', token: autoGuestTok,
  body: { items: [{ product_id: blueLagoon.id, qty: 1 }, { product_id: coke250.id, qty: 1 }], notes: 'Initial guest order' },
});
assert.equal(gAutoOrd.status, 201);
assert.equal(gAutoOrd.data.status, 'served');
assert.equal(gAutoOrd.data.can_edit, true, 'Guest can edit their unsettled order');

// Non-owner member cannot edit guest's order
assert.equal((await req(`/api/orders/${gAutoOrd.data.id}/items`, {
  method: 'PUT', token: memTok, body: { items: [{ product_id: coke250.id, qty: 1 }] },
})).status, 403, 'Non-owner blocked from editing another user order');

// Guest cannot add Party-Only 750ml or full alcohol bottle during edit
assert.equal((await req(`/api/orders/${gAutoOrd.data.id}/items`, {
  method: 'PUT', token: autoGuestTok, body: { items: [{ product_id: coke750.id, qty: 1 }] },
})).status, 403, 'Guest blocked from adding party-only 750ml via Edit Order');
assert.equal((await req(`/api/orders/${gAutoOrd.data.id}/items`, {
  method: 'PUT', token: autoGuestTok, body: { items: [{ product_id: 1, serve_type: 'bottle', qty: 1 }] },
})).status, 403, 'Guest blocked from adding full alcohol bottle via Edit Order');

// Guest edits order: 1 -> 2 Blue Lagoon, keeps 1 Coke 250ml, adds 1 Sprite 250ml
const gEdit1 = await req(`/api/orders/${gAutoOrd.data.id}/items`, {
  method: 'PUT', token: autoGuestTok,
  body: {
    items: [
      { product_id: blueLagoon.id, qty: 2 },
      { product_id: coke250.id, qty: 1 },
      { product_id: sprite250.id, qty: 1 },
    ],
    notes: 'Added extra Blue Lagoon & Sprite',
    reason: 'Guest added drinks',
  },
});
assert.equal(gEdit1.status, 200);
assert.equal(gEdit1.data.total, 178.74, '2*69.37 + 20 + 20 = 178.74');
assert.equal(stockOf(blueCuracao.id), blStock0 - 4, 'Exact delta: 2 Blue Lagoons deducted 4 loose (120ml) Blue Curacao');
assert.equal(stockOf(freshLime.id), limeStock0 - 2, 'Exact delta: 2 Fresh Limes deducted');
assert.equal(stockOf(coke250.id), cokeStock0 - 1, 'Coke 250ml NOT double-deducted');
assert.equal(stockOf(sprite250.id), spriteStock0 - 1, 'Sprite 250ml deducted by 1');

// Guest edits AGAIN: reduces Blue Lagoon 2 -> 1 and removes Sprite 250ml -> restores exact delta (no duplicate deductions!)
const gEdit2 = await req(`/api/orders/${gAutoOrd.data.id}/items`, {
  method: 'PUT', token: autoGuestTok,
  body: {
    items: [{ product_id: blueLagoon.id, qty: 1 }, { product_id: coke250.id, qty: 1 }],
    notes: 'Reverted to 1 each',
  },
});
assert.equal(gEdit2.status, 200);
assert.equal(gEdit2.data.total, 89.37);
assert.equal(stockOf(blueCuracao.id), blStock0 - 2, 'Restored 2 loose (60ml) Blue Curacao');
assert.equal(stockOf(freshLime.id), limeStock0 - 1, 'Restored 1 Fresh Lime');
assert.equal(stockOf(coke250.id), cokeStock0 - 1, 'Coke 250ml still exact -1');
assert.equal(stockOf(sprite250.id), spriteStock0, 'Sprite 250ml completely restored');

// Verify audit trail records modifier & timestamps
const gDetail = (await req(`/api/orders/${gAutoOrd.data.id}`, { token: autoGuestTok })).data;
assert(gDetail.events.some((ev) => /Edited by Auto Login Guest \(Guest\)/.test(ev.note)), 'Order audit trail records who modified & when');

// Once settled via Cash, guest can NO LONGER edit the closed/settled order (409)
await req(`/api/orders/${gAutoOrd.data.id}/status`, { method: 'POST', token: btTok, body: { status: 'closed', payment_mode: 'cash' } });
assert.equal((await req(`/api/orders/${gAutoOrd.data.id}`, { token: autoGuestTok })).data.can_edit, false, 'Settled guest order marked locked');
assert.equal((await req(`/api/orders/${gAutoOrd.data.id}/items`, {
  method: 'PUT', token: autoGuestTok, body: { items: [{ product_id: coke250.id, qty: 2 }] },
})).status, 409, 'Guest blocked from editing settled order');

// Member edits own unapproved auto-billed order -> succeeds; after approving -> locked (409)
const foodProd = (await req('/api/products?all=1', { token: adminTok })).data.find((x) => x.category === 'Food' && x.active && x.stock > 2);
assert(foodProd, 'Seeded Food item exists for repeat-drinks filtering test');
const mOrd = await req('/api/orders', {
  method: 'POST', token: memTok,
  body: {
    items: [
      { product_id: 1, serve_type: 'peg', peg_ml: 30, qty: 1 },
      { product_id: blueLagoon.id, qty: 1 },
      { product_id: coke250.id, qty: 1 },
      { product_id: foodProd.id, qty: 1 },
    ],
  },
});
assert.equal(mOrd.status, 201);
assert.equal(mOrd.data.can_edit, true, 'Member can edit unapproved pending order');
const mEdit = await req(`/api/orders/${mOrd.data.id}/items`, {
  method: 'PUT', token: memTok,
  body: {
    items: [
      { product_id: 1, serve_type: 'peg', peg_ml: 30, qty: 2 },
      { product_id: blueLagoon.id, qty: 1 },
      { product_id: coke250.id, qty: 1 },
      { product_id: foodProd.id, qty: 1 },
    ],
    reason: 'Added second peg',
  },
});
assert.equal(mEdit.status, 200);
await req(`/api/orders/${mOrd.data.id}/approve`, { method: 'POST', token: memTok });
assert.equal((await req(`/api/orders/${mOrd.data.id}`, { token: memTok })).data.can_edit, false, 'Approved member order is locked');
assert.equal((await req(`/api/orders/${mOrd.data.id}/items`, {
  method: 'PUT', token: memTok, body: { items: [{ product_id: coke250.id, qty: 1 }] },
})).status, 409, 'Member blocked from editing approved order');

// 3) Repeat Order / Repeat Drinks (live pricing, category filter, out-of-stock handling, new order ID, idempotency)
// Update Coke 250ml price 20 -> 25 to verify live price recalculation (never stale historical price)
await req(`/api/products/${coke250.id}`, { method: 'PUT', token: adminTok, body: { selling_price: 25 } });
const prevDrinks = (await req(`/api/orders/${mOrd.data.id}/repeat-preview?mode=drinks`, { token: memTok })).data;
assert.equal(prevDrinks.items.length, 3, 'Repeat Drinks returns only the 3 drinks (Alcohol, Mocktail, Soft Drink)');
assert.equal(prevDrinks.excluded_count, 1, 'Repeat Drinks excludes the 1 Food item');
assert.equal(prevDrinks.excluded_items[0].name, foodProd.name);
const prevCoke = prevDrinks.items.find((i) => i.product_id === coke250.id);
assert.equal(prevCoke.current_unit_price, 25, 'Repeat preview uses live current price ₹25');
assert.equal(prevCoke.prev_unit_price, 20, 'Repeat preview reports previous price ₹20');
assert.equal(prevCoke.price_changed, true);

const prevFull = (await req(`/api/orders/${mOrd.data.id}/repeat-preview?mode=full`, { token: memTok })).data;
assert.equal(prevFull.items.length, 4, 'Repeat Entire Order includes all 4 items including Food');
assert.equal(prevFull.excluded_count, 0);

// Out-of-stock notification in Repeat preview
const cokeStockBeforeOos = stockOf(coke250.id);
q.run('UPDATE products SET stock=0 WHERE id=?', coke250.id);
const prevOos = (await req(`/api/orders/${mOrd.data.id}/repeat-preview?mode=drinks`, { token: memTok })).data;
assert.equal(prevOos.has_unavailable, true, 'Out-of-stock item flagged in repeat preview');
assert.equal(prevOos.items.find((i) => i.product_id === coke250.id).available, false);
q.run('UPDATE products SET stock=? WHERE id=?', cokeStockBeforeOos, coke250.id);

// Submit Repeat Drinks -> creates BRAND NEW order with new ID, live price, does NOT touch historical order, idempotent on retry
const repUuid = 'repeat-drinks-idempotent-uuid';
const repOrd = await req('/api/orders', {
  method: 'POST', token: memTok,
  body: {
    client_uuid: repUuid,
    source: 'repeat_drinks',
    items: prevDrinks.items.map((i) => ({ product_id: i.product_id, serve_type: i.serve_type, peg_ml: i.peg_ml, qty: i.qty })),
    notes: `Repeat drinks from ${mOrd.data.order_no}`,
  },
});
assert.equal(repOrd.status, 201);
assert.notEqual(repOrd.data.id, mOrd.data.id, 'Repeat creates a brand new order ID');
assert.equal(repOrd.data.items.find((i) => i.product_id === coke250.id).unit_price, 25, 'New repeat order uses live ₹25 price');
const origCheck = (await req(`/api/orders/${mOrd.data.id}`, { token: memTok })).data;
assert.equal(origCheck.items.find((i) => i.product_id === coke250.id).unit_price, 20, 'Original historical order price untouched');
const repDup = await req('/api/orders', {
  method: 'POST', token: memTok,
  body: { client_uuid: repUuid, source: 'repeat_drinks', items: [{ product_id: coke250.id, qty: 1 }] },
});
assert.equal(repDup.status, 200);
assert.equal(repDup.data.id, repOrd.data.id, 'Repeated click / retry with same client_uuid never creates duplicate order');
await req(`/api/products/${coke250.id}`, { method: 'PUT', token: adminTok, body: { selling_price: 20 } });

// Revoke Auto-Login Guest -> live session token & claim token immediately invalidated!
await req(`/api/users/${gAutoReg.data.user.id}`, { method: 'PUT', token: adminTok, body: { active: 0 } });
assert.equal((await req('/api/auth/me', { token: autoGuestTok })).status, 401, 'Revoked guest session immediately invalidated');
assert.equal((await req('/api/auth/guest-claim', { method: 'POST', body: { service_no: 'G-AUTO-1', request_token: gAutoReg.data.request_token } })).status, 403, 'Revoked guest claim blocked');

// 4) Bartender Shift Management & Handover (Shift A -> Handover to Bartender B -> End Shift -> Shift Report)
const bt2Res = await req('/api/users', { method: 'POST', token: adminTok, body: { name: 'Urvesh Shift2', service_no: 'BT002', category: 'STAFF', role: 'bartender', pin: 'BT002' } });
assert.equal(bt2Res.status, 201);
const bt2Tok = await login('BT002', 'BT002');
// Close any auto-started shift first so we test explicit Start -> Handover -> End cleanly
const curSh = (await req('/api/shifts/current', { token: btTok })).data;
if (curSh.current) await req('/api/shifts/end', { method: 'POST', token: btTok, body: { note: 'Pre-test close' } });

const sh1 = await req('/api/shifts/start', { method: 'POST', token: btTok, body: { note: 'Evening Shift A' } });
assert.equal(sh1.status, 201);
const sh1Ord = await req('/api/orders', { method: 'POST', token: btTok, body: { user_id: 3, items: [{ product_id: coke250.id, qty: 1 }] } });
assert.equal(sh1Ord.data.shift_id, sh1.data.id, 'Order automatically linked to active Shift A');

// Bartender B without handover=true is warned (409)
assert.equal((await req('/api/shifts/start', { method: 'POST', token: bt2Tok, body: { note: 'Overlap attempt' } })).status, 409, 'Overlapping shift requires explicit handover');

// Bartender B performs clean Shift Handover
const sh2 = await req('/api/shifts/start', { method: 'POST', token: bt2Tok, body: { handover: true, note: 'Night Shift B takeover' } });
assert.equal(sh2.status, 201);
assert.notEqual(sh2.data.id, sh1.data.id);
const sh2Ord = await req('/api/orders', { method: 'POST', token: bt2Tok, body: { user_id: 3, items: [{ product_id: sprite250.id, qty: 2 }] } });
assert.equal(sh2Ord.data.shift_id, sh2.data.id, 'New order linked to Shift B after handover');
const sh2End = await req('/api/shifts/end', { method: 'POST', token: bt2Tok, body: { note: 'Night shift closed' } });
assert.equal(sh2End.status, 200);
assert.equal(sh2End.data.status, 'closed');
assert.equal(sh2End.data.billed_orders, 1);
assert.equal(sh2End.data.total_revenue, 40);

const shiftsRep = (await req('/api/reports/shifts', { token: adminTok })).data;
assert(shiftsRep.rows.some((r) => r.shift_id === sh1.data.id && r.revenue >= 20), 'Shift-wise report captures Shift A sales');
assert(shiftsRep.rows.some((r) => r.shift_id === sh2.data.id && r.revenue === 40), 'Shift-wise report captures Shift B sales');

console.log('7. Dashboard (incl. Guest Cash/UPI analytics) & all 16 Reports (JSON + XLSX + PDF)…');
const dash = (await req('/api/dashboard', { token: adminTok })).data;
assert(dash.kpi.orders > 0 && dash.valuation.cost > 0);
assert(dash.guestPayments.cash.revenue > 0 && dash.guestPayments.upi.revenue > 0, 'Dashboard tracks Guest Cash & UPI revenue');
const types = (await req('/api/reports/types', { token: adminTok })).data;
assert.equal(types.length, 16);
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
assert.equal(backup.app, 'divinabar');
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
