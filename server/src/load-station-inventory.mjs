// Loads the 58 actual bar alcohol items (with cellar + loose 30ml stock & exact rates)
// into server/data/bar.db under the 3 main categories: Alcohol, Soft Drinks, Food.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate, q, tx, db, UPLOAD_DIR } from './db.js';
import { moveStock, getProduct, baseCost } from './services.js';
import { writeBackupFile } from './jobs.js';
import { STATION_ALCOHOL } from './alcohol-data.js';

migrate();

const backupName = writeBackupFile('pre-alcohol-load');
console.log(`[load-inventory] Safety backup saved: ${backupName}`);

// Ensure all local product images exist in UPLOAD_DIR
const ASSETS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets/products');
if (fs.existsSync(ASSETS_DIR)) {
  for (const f of fs.readdirSync(ASSETS_DIR)) {
    if (/\.(jpg|jpeg|png|webp|svg)$/i.test(f)) {
      fs.copyFileSync(path.join(ASSETS_DIR, f), path.join(UPLOAD_DIR, f));
    }
  }
}

const adminUser = q.get("SELECT id FROM users WHERE role='superadmin' ORDER BY id LIMIT 1") || q.get('SELECT id FROM users ORDER BY id LIMIT 1');
const adminId = adminUser?.id || null;

db.exec('PRAGMA foreign_keys = OFF');
try {
  tx(() => {
    // Ensure exactly the 3 main categories exist in exact sort order
    q.run("INSERT OR IGNORE INTO categories(name, low_threshold, critical_threshold, sort) VALUES('Alcohol', 3, 1, 1)");
    q.run("INSERT OR IGNORE INTO categories(name, low_threshold, critical_threshold, sort) VALUES('Soft Drinks', 24, 10, 2)");
    q.run("INSERT OR IGNORE INTO categories(name, low_threshold, critical_threshold, sort) VALUES('Food', 10, 4, 3)");
    q.run("UPDATE categories SET sort=1 WHERE name='Alcohol'");
    q.run("UPDATE categories SET sort=2 WHERE name='Soft Drinks'");
    q.run("UPDATE categories SET sort=3 WHERE name='Food'");

    const alcCatId = q.get("SELECT id FROM categories WHERE name='Alcohol'").id;

    // Remove previous demo alcohol products & their stock movements/reconciliations (Soft Drinks & Food preserved)
    const oldAlcIds = q.all('SELECT id FROM products WHERE category_id=?', alcCatId).map((r) => r.id);
    if (oldAlcIds.length) {
      const ph = oldAlcIds.map(() => '?').join(',');
      q.run(`DELETE FROM stock_movements WHERE product_id IN (${ph})`, ...oldAlcIds);
      q.run(`DELETE FROM reconciliations WHERE product_id IN (${ph})`, ...oldAlcIds);
      q.run(`DELETE FROM products WHERE id IN (${ph})`, ...oldAlcIds);
    }

    // Insert all 58 actual alcohol items with exact cellar + loose 30ml stock movements
    for (const [, name, subCat, cellarQty, purchaseRate, looseQty, isPeg, sizeMl, unit, desc, imgFile, fav] of STATION_ALCOHOL) {
      const pegPrice = isPeg ? Math.round((purchaseRate / 25) * 100) / 100 : 0;
      const sellingPrice = purchaseRate;
      const pid = Number(
        q.run(
          `INSERT INTO products(name, category_id, sub_category, brand, description, image, size_ml, unit, is_peg, purchase_price, selling_price, peg_price, stock, favourite, active)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,0,?,1)`,
          name, alcCatId, subCat, subCat, desc, `/uploads/${imgFile}`, sizeMl, unit, isPeg, purchaseRate, sellingPrice, pegPrice, fav,
        ).lastInsertRowid,
      );
      const p = getProduct(pid);
      const unitCost = baseCost(p);
      if (isPeg) {
        if (cellarQty > 0) {
          moveStock({
            productId: pid,
            type: 'opening',
            qty: cellarQty * sizeMl,
            unitCost,
            userId: adminId,
            note: `Opening Cellar Stock: ${cellarQty} bottle(s)`,
          });
        }
        if (looseQty > 0) {
          moveStock({
            productId: pid,
            type: 'opening',
            qty: looseQty * 30,
            unitCost,
            userId: adminId,
            note: `Opening Loose Counter Stock: ${looseQty} x 30ml pegs`,
          });
        }
      } else {
        const totalUnits = cellarQty + looseQty;
        if (totalUnits > 0) {
          moveStock({
            productId: pid,
            type: 'opening',
            qty: totalUnits,
            unitCost,
            userId: adminId,
            note: `Opening Stock: ${cellarQty} cellar + ${looseQty} counter ${unit}(s)`,
          });
        }
      }
    }
  });
} finally {
  db.exec('PRAGMA foreign_keys = ON');
}

const byCat = q.all(
  `SELECT c.name category, COALESCE(p.sub_category, '—') sub_category, COUNT(*) items,
          ROUND(SUM(CASE WHEN p.is_peg=1 AND p.size_ml>0 THEN (p.stock / p.size_ml) * p.purchase_price ELSE p.stock * p.purchase_price END), 2) stock_value
   FROM products p JOIN categories c ON c.id=p.category_id
   GROUP BY c.id, p.sub_category ORDER BY c.sort, p.sub_category`,
);
console.table(byCat);
const alcVal = q.get(
  `SELECT ROUND(SUM(CASE WHEN p.is_peg=1 AND p.size_ml>0 THEN (p.stock / p.size_ml) * p.purchase_price ELSE p.stock * p.purchase_price END), 2) total
   FROM products p JOIN categories c ON c.id=p.category_id WHERE c.name='Alcohol'`,
).total;
console.log('[load-inventory] Total Alcohol Stock Value (Cellar + Loose): ₹' + alcVal);
db.close();
