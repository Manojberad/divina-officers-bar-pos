import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { q, tx, migrate, ALL_TABLES, UPLOAD_DIR, db } from './db.js';
import { hashPin } from './auth.js';
import { createOrder, transition, moveStock, getProduct, toBase, baseCost } from './services.js';

const svg = (label, color, kind) => {
  const shape = kind === 'bottle'
    ? `<path d="M88 20h24v38c0 6 18 14 18 34v118c0 8-6 14-14 14H84c-8 0-14-6-14-14V92c0-20 18-28 18-34z" fill="${color}" opacity=".9"/><rect x="74" y="120" width="52" height="54" rx="6" fill="#fff" opacity=".85"/>`
    : kind === 'can'
      ? `<rect x="64" y="46" width="72" height="170" rx="16" fill="${color}"/><rect x="64" y="110" width="72" height="50" fill="#fff" opacity=".85"/>`
      : kind === 'glass'
        ? `<path d="M60 50h80l-12 160H72z" fill="${color}" opacity=".85"/><path d="M64 70h72" stroke="#fff" stroke-width="6" opacity=".7"/>`
        : `<circle cx="100" cy="130" r="70" fill="${color}"/><circle cx="100" cy="130" r="48" fill="#fff" opacity=".3"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 260"><rect width="200" height="260" fill="#1f2937"/>${shape}
  <text x="100" y="${kind === 'snack' ? 140 : kind === 'bottle' ? 152 : 142}" font-family="Arial,sans-serif" font-size="18" font-weight="700" text-anchor="middle" fill="#111">${label}</text></svg>`;
};

const CATS = [
  ['Alcohol', 3, 1, 5],
  ['Soft Drinks', 24, 10, 10],
  ['Food', 10, 4, 10],
  ['Cigarettes', 10, 3, 7.5],
  ['Misc', 10, 3, 0],
];
// name, cat, sub_category, brand, size, unit, is_peg, purchase, selling(bottle/unit), peg_price(30ml), stock(bottles/units), color, kind, desc
const PRODUCTS = [
  ['Royal Oak Reserve', 'Alcohol', 'Whisky', 'Royal Oak', 750, 'bottle', 1, 900, 1400, 70, 12, '#b45309', 'bottle', 'Smooth blended whisky'],
  ['Highland Single Malt 12Y', 'Alcohol', 'Whisky', 'Highland', 750, 'bottle', 1, 3200, 4500, 220, 4, '#92400e', 'bottle', 'Aged 12 years, honeyed finish'],
  ['Blenders Choice', 'Alcohol', 'Whisky', 'Blenders', 750, 'bottle', 1, 750, 1100, 55, 2, '#a16207', 'bottle', 'Everyday blended whisky'],
  ['Old Navy XXX Rum', 'Alcohol', 'Rum', 'Old Navy', 750, 'bottle', 1, 450, 700, 35, 15, '#7c2d12', 'bottle', 'Dark rum, classic'],
  ['Coconut White Rum', 'Alcohol', 'Rum', 'Island', 750, 'bottle', 1, 600, 950, 45, 1, '#e5e7eb', 'bottle', 'Light rum with coconut notes'],
  ['Arctic Vodka', 'Alcohol', 'Vodka', 'Arctic', 750, 'bottle', 1, 700, 1100, 55, 8, '#93c5fd', 'bottle', 'Triple distilled vodka'],
  ['Citrus Vodka', 'Alcohol', 'Vodka', 'Arctic', 750, 'bottle', 1, 750, 1150, 58, 0, '#fde047', 'bottle', 'Lemon infused vodka'],
  ['London Dry Gin', 'Alcohol', 'Gin', 'Kingsway', 750, 'bottle', 1, 900, 1400, 70, 6, '#a7f3d0', 'bottle', 'Juniper forward dry gin'],
  ['Premium Lager 650ml', 'Alcohol', 'Beer', 'Brewhouse', 650, 'bottle', 0, 110, 180, 0, 96, '#facc15', 'bottle', 'Crisp lager'],
  ['Strong Beer 500ml Can', 'Alcohol', 'Beer', 'Brewhouse', 500, 'can', 0, 95, 160, 0, 20, '#ef4444', 'can', '8% strong beer'],
  ['Wheat Beer 330ml', 'Alcohol', 'Beer', 'Bavaria', 330, 'bottle', 0, 120, 200, 0, 48, '#fb923c', 'bottle', 'Cloudy wheat ale'],
  ['Red Wine Shiraz', 'Alcohol', 'Wine', 'Valley', 750, 'bottle', 1, 800, 1300, 90, 5, '#7f1d1d', 'bottle', 'Full bodied shiraz (glass = 30ml multiples)'],
  ['White Wine Chenin', 'Alcohol', 'Wine', 'Valley', 750, 'bottle', 1, 750, 1200, 85, 2, '#fef08a', 'bottle', 'Crisp chenin blanc'],
  ['Cola 300ml', 'Soft Drinks', 'Soda', 'Fizz', 300, 'unit', 0, 20, 40, 0, 120, '#991b1b', 'can', 'Chilled cola'],
  ['Soda 750ml', 'Soft Drinks', 'Soda', 'Fizz', 750, 'unit', 0, 18, 35, 0, 80, '#d1d5db', 'bottle', 'Club soda'],
  ['Tonic Water', 'Soft Drinks', 'Soda', 'Fizz', 300, 'unit', 0, 35, 60, 0, 9, '#cffafe', 'can', 'Indian tonic water'],
  ['Mineral Water 1L', 'Soft Drinks', 'Water', 'Pure', 1000, 'unit', 0, 15, 30, 0, 60, '#60a5fa', 'bottle', 'Packaged drinking water'],
  ['Roasted Peanuts', 'Food', 'Packed', 'House', 0, 'packet', 0, 30, 80, 0, 40, '#d97706', 'snack', 'Salted & masala peanuts'],
  ['Chicken Tikka', 'Food', 'Non-Veg', 'Kitchen', 0, 'plate', 0, 120, 250, 0, 25, '#dc2626', 'snack', '6 pieces, mint chutney'],
  ['French Fries', 'Food', 'Veg', 'Kitchen', 0, 'plate', 0, 40, 120, 0, 3, '#fbbf24', 'snack', 'Salted fries'],
];

const USERS = [
  ['Administrator', 'ADMIN', 'Super Admin', '9000000000', 'admin@bar.local', 'STAFF', 'superadmin'],
  ['Ravi Kumar', 'BT001', 'Bartender', '9000000001', '', 'STAFF', 'bartender'],
  ['Lt Col A. Sharma', 'IC-51234', 'Lt Col', '9811111111', 'sharma@mail.local', 'POSTED', 'member'],
  ['Maj R. Singh', 'IC-62345', 'Maj', '9822222222', 'singh@mail.local', 'POSTED', 'member'],
  ['Capt P. Nair', 'SS-41234', 'Capt', '9833333333', 'nair@mail.local', 'POSTED', 'member'],
  ['Col V. Rao', 'IC-40001', 'Col', '9844444444', '', 'POSTED', 'member'],
  ['Maj K. Das (TD)', 'TD-1001', 'Maj', '9855555555', 'das@mail.local', 'TD', 'customer'],
  ['Capt S. Iyer (TD)', 'TD-1002', 'Capt', '9866666666', '', 'TD', 'customer'],
];

export function seed({ withOrders = true } = {}) {
  console.log('[seed] loading sample data…');
  const ids = {};
  tx(() => {
    for (const [name, sn, rank, mob, email, cat, role] of USERS) {
      ids[sn] = Number(q.run('INSERT INTO users(name, service_no, rank, mobile, email, category, role, pin_hash, must_change_pin) VALUES(?,?,?,?,?,?,?,?,0)',
        name, sn, rank, mob, email || null, cat, role, hashPin(sn)).lastInsertRowid);
    }
    CATS.forEach(([n, l, c, m], i) => q.run('INSERT OR IGNORE INTO categories(name, low_threshold, critical_threshold, sort, profit_margin) VALUES(?,?,?,?,?)', n, l, c, i + 1, m));
    for (let i = 1; i <= 6; i++) q.run('INSERT INTO tables(name, code) VALUES(?,?)', `Table ${i}`, `t${i}${Math.random().toString(36).slice(2, 8)}`);
  });
  const backdate = (d) => new Date(Date.now() - d * 86400e3).toISOString();
  const admin = { id: ids.ADMIN, role: 'admin', name: 'Administrator' };
  const ASSETS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets/products');
  for (const [name, cat, subCat, brand, size, unit, peg, pp, sp, pegp, stock, color, kind, desc] of PRODUCTS) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const jpgName = `prod-${slug}.jpg`;
    const jpgAsset = path.join(ASSETS_DIR, jpgName);
    let file;
    if (fs.existsSync(jpgAsset)) {
      file = jpgName;
      fs.copyFileSync(jpgAsset, path.join(UPLOAD_DIR, file));
    } else {
      file = `sample-${slug}.svg`;
      const label = name.split(' ').slice(0, 2).join(' ').slice(0, 14);
      fs.writeFileSync(path.join(UPLOAD_DIR, file), svg(label, color, kind));
    }
    const catId = q.get('SELECT id FROM categories WHERE name=?', cat).id;
    const foodType = subCat === 'Non-Veg' ? 'nonveg' : subCat === 'Veg' ? 'veg' : null;
    const id = Number(q.run(`INSERT INTO products(name, category_id, sub_category, brand, description, image, size_ml, unit, is_peg, purchase_price, selling_price, peg_price, food_type, favourite)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, name, catId, subCat, brand, desc, `/uploads/${file}`, size, unit, peg, pp, sp, pegp, foodType, ['Royal Oak Reserve', 'Premium Lager 650ml', 'Old Navy XXX Rum', 'Cola 300ml'].includes(name) ? 1 : 0).lastInsertRowid);
    const p = getProduct(id);
    // Opening + purchase history so the dashboard has data. Extra stock is consumed by sample orders (keep 0/1/2-stock demo items intact).
    const extra = withOrders && stock > 3 ? (peg ? 3 : unit === 'plate' ? 15 : 24) : 0;
    if (stock + extra > 0) {
      moveStock({ productId: id, type: 'opening', qty: toBase(p, stock + extra), unitCost: baseCost(p), userId: admin.id, note: 'Opening stock', at: backdate(35) });
    }
  }
  if (!withOrders) return;

  const members = ['IC-51234', 'IC-62345', 'SS-41234', 'IC-40001', 'TD-1001', 'TD-1002'].map((s) => ids[s]);
  const prods = q.all('SELECT * FROM products');
  const tables = q.all('SELECT id FROM tables');
  let rnd = 7;
  const rand = (n) => { rnd = (rnd * 9301 + 49297) % 233280; return Math.floor((rnd / 233280) * n); };
  const pegSizes = [30, 60];
  for (let k = 0; k < 60; k++) {
    const daysAgo = 29 - Math.floor(k / 2);
    const items = [];
    const n = 1 + rand(3);
    for (let j = 0; j < n; j++) {
      const p = prods[rand(prods.length)];
      const cur = getProduct(p.id);
      const it = p.is_peg ? { product_id: p.id, serve_type: 'peg', peg_ml: pegSizes[rand(2)], qty: 1 } : { product_id: p.id, serve_type: 'unit', qty: 1 + rand(2) };
      const need = p.is_peg ? it.peg_ml : it.qty;
      if (cur.stock - need > toBase(cur, 1)) items.push(it);
    }
    if (!items.length) continue;
    try {
      const { order } = createOrder({ user_id: members[rand(members.length)], table_id: tables[rand(tables.length)].id, items }, { id: ids.BT001, role: 'bartender' });
      const at = new Date(Date.now() - daysAgo * 86400e3 - rand(5) * 3600e3).toISOString();
      const bt = { id: ids.BT001, role: 'bartender' };
      if (k % 17 === 5) transition(order.id, 'cancelled', bt, 'Customer left');
      else {
        if (order.status !== 'closed') {
          transition(order.id, 'served', bt);
          transition(order.id, 'closed', bt);
        }
        const appr = k % 9 === 0 ? 'expired' : 'approved';
        q.run('UPDATE orders SET approval_status=?, approval_at=? WHERE id=?', appr, appr === 'approved' ? at : null, order.id);
      }
      q.run('UPDATE orders SET created_at=?, updated_at=?, closed_at=CASE WHEN closed_at IS NULL THEN NULL ELSE ? END WHERE id=?', at, at, at, order.id);
      q.run('UPDATE order_events SET at=? WHERE order_id=?', at, order.id);
      q.run('UPDATE stock_movements SET at=? WHERE order_id=?', at, order.id);
    } catch (e) { /* skip unavailable */ }
  }
  // Some wastage/complimentary + live orders for the bartender board
  const ro = q.get("SELECT id FROM products WHERE name='Royal Oak Reserve'").id;
  moveStock({ productId: ro, type: 'wastage', qty: -30, unitCost: baseCost(getProduct(ro)), userId: admin.id, note: 'Spilled peg', at: backdate(3) });
  moveStock({ productId: ro, type: 'complimentary', qty: -60, unitCost: baseCost(getProduct(ro)), userId: admin.id, note: 'Guest of honour', at: backdate(2) });
  const lager = q.get("SELECT id FROM products WHERE name='Premium Lager 650ml'").id;
  createOrder({ user_id: ids['IC-51234'], table_id: tables[0].id, items: [{ product_id: ro, serve_type: 'peg', peg_ml: 60, qty: 2 }, { product_id: lager, qty: 1 }], notes: 'Less ice' }, { id: ids.BT001, role: 'bartender' });
  createOrder({ table_code: q.get('SELECT code FROM tables WHERE id=?', tables[2].id).code, items: [{ product_id: lager, qty: 2 }], source: 'qr' }, { id: ids['IC-62345'], role: 'member' });
  const tomorrow = new Date(Date.now() + 86400e3); tomorrow.setHours(20, 0, 0, 0);
  createOrder({ type: 'prebooked', scheduled_at: tomorrow.toISOString(), items: [{ product_id: ro, serve_type: 'peg', peg_ml: 60, qty: 4 }], notes: 'Birthday party, 6 guests' }, { id: ids['IC-40001'], role: 'member' });
  // One auto-billed order awaiting approval for Lt Col Sharma
  createOrder({ user_id: ids['IC-51234'], items: [{ product_id: lager, qty: 2 }] }, { id: ids.BT001, role: 'bartender' });
  console.log('[seed] done');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  migrate();
  if (process.argv.includes('--force')) {
    db.exec('PRAGMA foreign_keys = OFF');
    tx(() => [...ALL_TABLES].reverse().forEach((t) => q.run(`DELETE FROM ${t}`)));
    db.exec('PRAGMA foreign_keys = ON');
  }
  if (q.get('SELECT id FROM users LIMIT 1')) console.log('Database already has data. Use --force to reset.');
  else seed({ withOrders: !process.argv.includes('--empty') });
}
