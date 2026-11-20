// Loads the 54 actual Bar Sundries items (Soft Drinks, Juices, Syrups/Mixers,
// Cigarettes, Fresh Lime, Ice, Packed/Veg/Non-Veg Food) into server/data/bar.db,
// replacing the old demo Soft Drinks & Food items while preserving the 58 Alcohol items.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate, q, tx, db, UPLOAD_DIR } from './db.js';
import { moveStock, getProduct, baseCost } from './services.js';
import { writeBackupFile } from './jobs.js';
import { STATION_SUNDRIES } from './sundries-data.js';

migrate();

const backupName = writeBackupFile('pre-sundries-load');
console.log(`[load-sundries] Safety backup saved: ${backupName}`);

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
    const softCatId = q.get("SELECT id FROM categories WHERE name='Soft Drinks'").id;
    const foodCatId = q.get("SELECT id FROM categories WHERE name='Food'").id;
    const catMap = { 'Soft Drinks': softCatId, Food: foodCatId };

    // Remove previous demo Soft Drinks & Food products (preserve Alcohol!)
    const oldIds = q.all('SELECT id FROM products WHERE category_id IN (?,?)', softCatId, foodCatId).map((r) => r.id);
    if (oldIds.length) {
      const ph = oldIds.map(() => '?').join(',');
      q.run(`DELETE FROM stock_movements WHERE product_id IN (${ph})`, ...oldIds);
      q.run(`DELETE FROM reconciliations WHERE product_id IN (${ph})`, ...oldIds);
      q.run(`DELETE FROM products WHERE id IN (${ph})`, ...oldIds);
    }

    for (const [, catName, subCat, foodType, name, unit, qty, purchaseRate, desc, imgFile, fav] of STATION_SUNDRIES) {
      const pid = Number(
        q.run(
          `INSERT INTO products(name, category_id, sub_category, food_type, brand, description, image, size_ml, unit, is_peg, purchase_price, selling_price, peg_price, stock, favourite, active)
           VALUES(?,?,?,?,?,?,?,0,?,0,?,?,0,0,?,1)`,
          name, catMap[catName], subCat, foodType, subCat || catName, desc, `/uploads/${imgFile}`, unit, purchaseRate, purchaseRate, fav,
        ).lastInsertRowid,
      );
      if (qty > 0) {
        const p = getProduct(pid);
        moveStock({
          productId: pid,
          type: 'opening',
          qty,
          unitCost: baseCost(p),
          userId: adminId,
          note: `Opening Sundries Stock: ${qty} ${unit}`,
        });
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
const totals = q.get(
  `SELECT COUNT(*) total_items,
          ROUND(SUM(CASE WHEN p.is_peg=1 AND p.size_ml>0 THEN (p.stock / p.size_ml) * p.purchase_price ELSE p.stock * p.purchase_price END), 2) total_value
   FROM products p`,
);
console.log(`[load-sundries] Grand Total Inventory: ${totals.total_items} products | Stock Value: ₹${totals.total_value}`);
db.close();
