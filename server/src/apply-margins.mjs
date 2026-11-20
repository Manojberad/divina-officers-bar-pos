// Applies migration v10 (Cigarettes, Misc, Soft Drinks sub-categories, profit_margin, favorite_orders)
// and recalculates selling & 30 ml peg prices for all products based on category profit margins:
// Alcohol = 5%, Cigarettes = 7.5%, Soft Drinks = 10%, Food = 10%, Misc = 0%.
import { migrate, q, tx, db } from './db.js';
import { applyCategoryMargin } from './routes/catalog.js';
import { writeBackupFile } from './jobs.js';

migrate();
const bkp = writeBackupFile('pre-margins-v10');
console.log(`[apply-margins] Safety backup saved: ${bkp}`);

tx(() => {
  const cats = q.all('SELECT id, name, profit_margin FROM categories ORDER BY sort, name');
  for (const c of cats) {
    const n = applyCategoryMargin(c.id, c.profit_margin);
    console.log(`[apply-margins] ${c.name} (${c.profit_margin}% margin) -> recalculated ${n} products`);
  }
});

const summary = q.all(
  `SELECT c.name category, c.profit_margin margin_pct, COALESCE(p.sub_category, '—') sub_category, COUNT(*) items
   FROM categories c LEFT JOIN products p ON p.category_id = c.id
   GROUP BY c.id, p.sub_category ORDER BY c.sort, p.sub_category`,
);
console.table(summary);

const sample = q.all(
  `SELECT p.name, c.name category, c.profit_margin margin, p.purchase_price purchase, p.selling_price selling, p.peg_price peg30
   FROM products p JOIN categories c ON c.id=p.category_id
   WHERE p.name IN ('TEACHERS','BLACK DOG CENTEN','OLD MONK (OLD)','GIN JAISALMER','CLASSIC MILD DOUBLE BURST','SODA 750 ML','REAL JUICE PINEAPPLE 01 LTR','SNACKS 60 GM','DISPOSAL GLASS')
   ORDER BY c.sort, p.name`,
);
console.table(sample);
db.close();
