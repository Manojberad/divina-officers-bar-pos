import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, '../data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
export const BACKUP_DIR = path.join(DATA_DIR, 'backups');
for (const d of [DATA_DIR, UPLOAD_DIR, BACKUP_DIR]) fs.mkdirSync(d, { recursive: true });

export const db = new DatabaseSync(process.env.DB_FILE || path.join(DATA_DIR, 'bar.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

let depth = 0;
/** Run fn inside a transaction (nested calls join the outer transaction). */
export function tx(fn) {
  if (depth > 0) return fn();
  depth++;
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    depth--;
  }
}

export const q = {
  get: (sql, ...p) => db.prepare(sql).get(...p),
  all: (sql, ...p) => db.prepare(sql).all(...p),
  run: (sql, ...p) => db.prepare(sql).run(...p),
};

export const now = () => new Date().toISOString();

const migrations = [
  // v1 – base schema
  `
  CREATE TABLE users(
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, service_no TEXT NOT NULL UNIQUE COLLATE NOCASE,
    rank TEXT, mobile TEXT, email TEXT, category TEXT NOT NULL DEFAULT 'POSTED' CHECK(category IN ('POSTED','TD','STAFF')),
    role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('admin','member','bartender','customer')),
    pin_hash TEXT NOT NULL, must_change_pin INTEGER NOT NULL DEFAULT 1, active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
  CREATE TABLE categories(
    id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, low_threshold REAL, critical_threshold REAL, sort INTEGER DEFAULT 0);
  CREATE TABLE products(
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, category_id INTEGER REFERENCES categories(id),
    brand TEXT, description TEXT, image TEXT, size_ml REAL DEFAULT 0, unit TEXT DEFAULT 'bottle',
    is_peg INTEGER NOT NULL DEFAULT 0, purchase_price REAL NOT NULL DEFAULT 0, selling_price REAL NOT NULL DEFAULT 0,
    peg_price REAL DEFAULT 0, stock REAL NOT NULL DEFAULT 0, min_stock REAL, critical_stock REAL,
    favourite INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
  CREATE TABLE tables(id INTEGER PRIMARY KEY, name TEXT NOT NULL, code TEXT NOT NULL UNIQUE, active INTEGER NOT NULL DEFAULT 1);
  CREATE TABLE orders(
    id INTEGER PRIMARY KEY, order_no TEXT NOT NULL UNIQUE, client_uuid TEXT UNIQUE,
    user_id INTEGER REFERENCES users(id), created_by INTEGER REFERENCES users(id), table_id INTEGER REFERENCES tables(id),
    type TEXT NOT NULL DEFAULT 'ondemand' CHECK(type IN ('ondemand','prebooked')), scheduled_at TEXT,
    status TEXT NOT NULL DEFAULT 'placed' CHECK(status IN ('draft','placed','accepted','preparing','served','closed','cancelled','disputed')),
    source TEXT DEFAULT 'pos', notes TEXT, total REAL NOT NULL DEFAULT 0, stock_deducted INTEGER NOT NULL DEFAULT 0,
    approval_status TEXT NOT NULL DEFAULT 'na' CHECK(approval_status IN ('na','pending','approved','disputed','expired')),
    approval_at TEXT, dispute_note TEXT, resolution_note TEXT, closed_at TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE INDEX idx_orders_created ON orders(created_at);
  CREATE INDEX idx_orders_status ON orders(status);
  CREATE TABLE order_items(
    id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id), name TEXT NOT NULL,
    serve_type TEXT NOT NULL CHECK(serve_type IN ('bottle','peg','unit')), peg_ml REAL, qty REAL NOT NULL,
    unit_price REAL NOT NULL, line_total REAL NOT NULL, base_qty REAL NOT NULL);
  CREATE TABLE order_events(
    id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    from_status TEXT, to_status TEXT, user_id INTEGER, note TEXT, at TEXT NOT NULL);
  CREATE TABLE stock_movements(
    id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id),
    type TEXT NOT NULL CHECK(type IN ('opening','purchase','sale','sale_reversal','wastage','complimentary','adjustment','removal','reconcile')),
    qty REAL NOT NULL, unit_cost REAL, supplier TEXT, invoice TEXT, order_id INTEGER, note TEXT, user_id INTEGER, at TEXT NOT NULL);
  CREATE INDEX idx_mov_product ON stock_movements(product_id, at);
  CREATE UNIQUE INDEX uq_sale_once ON stock_movements(order_id, product_id, type) WHERE type IN ('sale','sale_reversal');
  CREATE TABLE reconciliations(
    id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id), system_qty REAL, physical_qty REAL,
    diff REAL, note TEXT, user_id INTEGER, at TEXT NOT NULL);
  CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE audit_logs(id INTEGER PRIMARY KEY, user_id INTEGER, action TEXT NOT NULL, entity TEXT, entity_id TEXT, details TEXT, at TEXT NOT NULL);
  CREATE TABLE notifications(id INTEGER PRIMARY KEY, target_role TEXT, user_id INTEGER, message TEXT NOT NULL, link TEXT, read INTEGER DEFAULT 0, at TEXT NOT NULL);
  `,
  // v2 – consolidate categories into: Alcohol, Soft Drinks, Packaged Snacks, From the Kitchen
  `
  INSERT OR IGNORE INTO categories(name, low_threshold, critical_threshold, sort) VALUES
    ('Alcohol', 3, 1, 1),
    ('Soft Drinks', 24, 10, 2),
    ('Packaged Snacks', 10, 4, 3),
    ('From the Kitchen', 10, 4, 4);
  UPDATE categories SET sort = 1 WHERE name = 'Alcohol';
  UPDATE categories SET sort = 2 WHERE name = 'Soft Drinks';
  UPDATE categories SET sort = 3 WHERE name = 'Packaged Snacks';
  UPDATE categories SET sort = 4 WHERE name = 'From the Kitchen';
  UPDATE products SET category_id = (SELECT id FROM categories WHERE name = 'Alcohol')
    WHERE category_id IN (SELECT id FROM categories WHERE name IN ('Whisky','Rum','Vodka','Gin','Beer','Wine'));
  UPDATE products SET category_id = (SELECT id FROM categories WHERE name = 'From the Kitchen')
    WHERE category_id IN (SELECT id FROM categories WHERE name = 'Snacks') AND (brand = 'Kitchen' OR name IN ('Chicken Tikka','French Fries'));
  UPDATE products SET category_id = (SELECT id FROM categories WHERE name = 'Packaged Snacks')
    WHERE category_id IN (SELECT id FROM categories WHERE name = 'Snacks');
  DELETE FROM categories WHERE name IN ('Whisky','Rum','Vodka','Gin','Beer','Wine','Snacks');
  `,
  // v3 – add 'STAFF' (Mess Staff) category to users and assign bartenders to STAFF
  `
  PRAGMA foreign_keys = OFF;
  CREATE TABLE users_new(
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, service_no TEXT NOT NULL UNIQUE COLLATE NOCASE,
    rank TEXT, mobile TEXT, email TEXT, category TEXT NOT NULL DEFAULT 'POSTED' CHECK(category IN ('POSTED','TD','STAFF')),
    role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('admin','member','bartender','customer')),
    pin_hash TEXT NOT NULL, must_change_pin INTEGER NOT NULL DEFAULT 1, active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
  INSERT INTO users_new SELECT id, name, service_no, rank, mobile, email,
    CASE WHEN role = 'bartender' THEN 'STAFF' ELSE category END,
    role, pin_hash, must_change_pin, active, created_at FROM users;
  DROP TABLE users;
  ALTER TABLE users_new RENAME TO users;
  PRAGMA foreign_keys = ON;
  `,
  // v4 – add Guest role/category with bartender approval fields, order payment_mode (cash/upi), and Small(30)/Large(60) pegs
  `
  CREATE TABLE users_v4(
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, service_no TEXT NOT NULL UNIQUE COLLATE NOCASE,
    rank TEXT, mobile TEXT, email TEXT,
    category TEXT NOT NULL DEFAULT 'POSTED' CHECK(category IN ('POSTED','TD','STAFF','GUEST')),
    role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('admin','member','bartender','customer','guest')),
    pin_hash TEXT NOT NULL, must_change_pin INTEGER NOT NULL DEFAULT 1, active INTEGER NOT NULL DEFAULT 1,
    approval_status TEXT NOT NULL DEFAULT 'approved' CHECK(approval_status IN ('pending','approved','rejected')),
    approved_by INTEGER REFERENCES users(id), approved_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
  INSERT INTO users_v4(id, name, service_no, rank, mobile, email, category, role, pin_hash, must_change_pin, active, approval_status, created_at)
    SELECT id, name, service_no, rank, mobile, email, category, role, pin_hash, must_change_pin, active, 'approved', created_at FROM users;
  DROP TABLE users;
  ALTER TABLE users_v4 RENAME TO users;
  ALTER TABLE orders ADD COLUMN payment_mode TEXT CHECK(payment_mode IN ('cash','upi') OR payment_mode IS NULL);
  ALTER TABLE orders ADD COLUMN payment_ref TEXT;
  UPDATE settings SET value='30,60' WHERE key='peg_sizes' AND value='30,60,90';
  `,
  // v5 – per-user / guest alcohol peg limit override
  `
  ALTER TABLE users ADD COLUMN alcohol_limit INTEGER;
  `,
  // v6 – TD officer custom enrollment & completion dates
  `
  ALTER TABLE users ADD COLUMN td_start_date TEXT;
  ALTER TABLE users ADD COLUMN td_end_date TEXT;
  `,
  // v7 – Veg / Non-Veg classification for Kitchen products
  `
  ALTER TABLE products ADD COLUMN food_type TEXT CHECK(food_type IN ('veg','nonveg') OR food_type IS NULL);
  UPDATE products SET food_type = 'nonveg'
    WHERE category_id = (SELECT id FROM categories WHERE name = 'From the Kitchen')
      AND (lower(name) LIKE '%chicken%' OR lower(name) LIKE '%mutton%' OR lower(name) LIKE '%fish%' OR lower(name) LIKE '%egg%' OR lower(name) LIKE '%prawn%' OR lower(name) LIKE '%meat%' OR lower(name) LIKE '%lamb%');
  UPDATE products SET food_type = 'veg'
    WHERE category_id = (SELECT id FROM categories WHERE name = 'From the Kitchen') AND food_type IS NULL;
  `,
  // v8 – Super Admin, 3 Admin-equivalent officer designations (Commanding Officer, Mess Secretary, Bar Incharge), Course Officer category, branch & TORS metadata
  `
  CREATE TABLE users_v8(
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    service_no TEXT NOT NULL UNIQUE COLLATE NOCASE,
    rank TEXT,
    branch TEXT,
    tors TEXT,
    mobile TEXT,
    email TEXT,
    category TEXT NOT NULL DEFAULT 'POSTED' CHECK(category IN ('POSTED','COURSE','TD','STAFF','GUEST')),
    role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('superadmin','commanding_officer','mess_secretary','bar_incharge','admin','member','bartender','customer','guest')),
    pin_hash TEXT NOT NULL,
    must_change_pin INTEGER NOT NULL DEFAULT 1,
    active INTEGER NOT NULL DEFAULT 1,
    approval_status TEXT NOT NULL DEFAULT 'approved' CHECK(approval_status IN ('pending','approved','rejected')),
    approved_by INTEGER REFERENCES users(id),
    approved_at TEXT,
    alcohol_limit INTEGER,
    td_start_date TEXT,
    td_end_date TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  INSERT INTO users_v8(id, name, service_no, rank, mobile, email, category, role, pin_hash, must_change_pin, active, approval_status, approved_by, approved_at, alcohol_limit, td_start_date, td_end_date, created_at)
    SELECT id, name, service_no, rank, mobile, email, category,
      CASE WHEN upper(service_no) = 'ADMIN' AND role = 'admin' THEN 'superadmin' ELSE role END,
      pin_hash, must_change_pin, active, approval_status, approved_by, approved_at, alcohol_limit, td_start_date, td_end_date, created_at
    FROM users;
  DROP TABLE users;
  ALTER TABLE users_v8 RENAME TO users;
  `,
  // v9 – Add sub_category to products and consolidate into 3 main categories: Alcohol, Soft Drinks, Food (Packed / Veg / Non-Veg)
  `
  ALTER TABLE products ADD COLUMN sub_category TEXT;
  INSERT OR IGNORE INTO categories(name, low_threshold, critical_threshold, sort) VALUES
    ('Alcohol', 3, 1, 1),
    ('Soft Drinks', 24, 10, 2),
    ('Food', 10, 4, 3);
  UPDATE categories SET sort = 1 WHERE name = 'Alcohol';
  UPDATE categories SET sort = 2 WHERE name = 'Soft Drinks';
  UPDATE categories SET sort = 3 WHERE name = 'Food';
  UPDATE products SET sub_category = 'Packed', category_id = (SELECT id FROM categories WHERE name = 'Food')
    WHERE category_id = (SELECT id FROM categories WHERE name = 'Packaged Snacks');
  UPDATE products SET sub_category = CASE WHEN food_type = 'nonveg' THEN 'Non-Veg' ELSE 'Veg' END,
    category_id = (SELECT id FROM categories WHERE name = 'Food')
    WHERE category_id = (SELECT id FROM categories WHERE name = 'From the Kitchen');
  DELETE FROM categories WHERE name IN ('Packaged Snacks', 'From the Kitchen');
  UPDATE products SET sub_category = 'Whisky' WHERE category_id = (SELECT id FROM categories WHERE name = 'Alcohol') AND sub_category IS NULL AND (lower(name) LIKE '%whisky%' OR lower(name) LIKE '%malt%' OR lower(name) LIKE '%blenders%' OR lower(name) LIKE '%oak%');
  UPDATE products SET sub_category = 'Rum' WHERE category_id = (SELECT id FROM categories WHERE name = 'Alcohol') AND sub_category IS NULL AND lower(name) LIKE '%rum%';
  UPDATE products SET sub_category = 'Vodka' WHERE category_id = (SELECT id FROM categories WHERE name = 'Alcohol') AND sub_category IS NULL AND lower(name) LIKE '%vodka%';
  UPDATE products SET sub_category = 'Gin' WHERE category_id = (SELECT id FROM categories WHERE name = 'Alcohol') AND sub_category IS NULL AND lower(name) LIKE '%gin%';
  UPDATE products SET sub_category = 'Wine' WHERE category_id = (SELECT id FROM categories WHERE name = 'Alcohol') AND sub_category IS NULL AND lower(name) LIKE '%wine%';
  UPDATE products SET sub_category = 'Beer' WHERE category_id = (SELECT id FROM categories WHERE name = 'Alcohol') AND sub_category IS NULL AND (lower(name) LIKE '%beer%' OR lower(name) LIKE '%lager%');
  `,
  // v10 – Add Cigarettes & Misc categories, category profit_margin %, Soft Drinks sub-categories (Juices/Soda/Water), and member/guest Favorite Orders table
  `
  ALTER TABLE categories ADD COLUMN profit_margin REAL NOT NULL DEFAULT 0;
  INSERT OR IGNORE INTO categories(name, low_threshold, critical_threshold, sort, profit_margin) VALUES
    ('Alcohol', 3, 1, 1, 5),
    ('Soft Drinks', 24, 10, 2, 10),
    ('Food', 10, 4, 3, 10),
    ('Cigarettes', 10, 3, 4, 7.5),
    ('Misc', 10, 3, 5, 0);
  UPDATE categories SET sort = 1, profit_margin = 5 WHERE name = 'Alcohol';
  UPDATE categories SET sort = 2, profit_margin = 10 WHERE name = 'Soft Drinks';
  UPDATE categories SET sort = 3, profit_margin = 10 WHERE name = 'Food';
  UPDATE categories SET sort = 4, profit_margin = 7.5 WHERE name = 'Cigarettes';
  UPDATE categories SET sort = 5, profit_margin = 0 WHERE name = 'Misc';
  UPDATE products SET category_id = (SELECT id FROM categories WHERE name = 'Cigarettes'), sub_category = NULL, food_type = NULL
    WHERE lower(description) LIKE '%cigarette%' OR lower(name) LIKE '%classic mild%' OR lower(name) LIKE '%classic ultra%' OR lower(name) LIKE '%gold flake%' OR lower(name) = 'wills' OR lower(name) = 'danil';
  UPDATE products SET category_id = (SELECT id FROM categories WHERE name = 'Misc'), sub_category = NULL, food_type = NULL
    WHERE lower(name) LIKE '%disposal%' OR lower(name) LIKE '%plastic glass%' OR lower(name) LIKE '%ice cube%' OR lower(name) LIKE '%fresh lime%';
  UPDATE products SET sub_category = 'Water'
    WHERE category_id = (SELECT id FROM categories WHERE name = 'Soft Drinks') AND (lower(name) LIKE '%water%' AND lower(name) NOT LIKE '%tonic%');
  UPDATE products SET sub_category = 'Juices'
    WHERE category_id = (SELECT id FROM categories WHERE name = 'Soft Drinks') AND (lower(name) LIKE '%juice%' OR lower(name) LIKE '%appy%');
  UPDATE products SET sub_category = 'Soda'
    WHERE category_id = (SELECT id FROM categories WHERE name = 'Soft Drinks') AND sub_category IS NULL;
  CREATE TABLE IF NOT EXISTS favorite_orders(
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    items_json TEXT NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_fav_orders_user ON favorite_orders(user_id);
  `,
  // v11: Rebrand report footer from BarTill to DivinaBar
  `
  UPDATE settings SET value = 'Generated by DivinaBar – offline bar management'
    WHERE key = 'report_footer' AND value LIKE '%BarTill%';
  `,
  // v12: Configurable recipe-based composite products (Mocktails: Blue Lagoon & Mint Mojito) + ingredient consumption accountability
  `
  ALTER TABLE products ADD COLUMN is_recipe INTEGER NOT NULL DEFAULT 0;
  CREATE TABLE IF NOT EXISTS product_recipes(
    id INTEGER PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    ingredient_id INTEGER NOT NULL REFERENCES products(id),
    qty REAL NOT NULL,
    display_qty REAL NOT NULL,
    display_unit TEXT NOT NULL,
    UNIQUE(product_id, ingredient_id)
  );
  CREATE INDEX IF NOT EXISTS idx_recipes_product ON product_recipes(product_id);
  CREATE TABLE IF NOT EXISTS recipe_consumptions(
    id INTEGER PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    product_name TEXT NOT NULL,
    qty_sold REAL NOT NULL,
    ingredient_id INTEGER NOT NULL REFERENCES products(id),
    ingredient_name TEXT NOT NULL,
    base_qty_consumed REAL NOT NULL,
    qty_consumed REAL NOT NULL,
    unit TEXT NOT NULL,
    ingredient_unit_cost REAL NOT NULL,
    ingredient_cost REAL NOT NULL,
    total_recipe_cost REAL NOT NULL,
    reversed INTEGER NOT NULL DEFAULT 0,
    at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_rc_order ON recipe_consumptions(order_id);
  CREATE INDEX IF NOT EXISTS idx_rc_at ON recipe_consumptions(at);
  CREATE UNIQUE INDEX IF NOT EXISTS uq_rc_order_prod_ing ON recipe_consumptions(order_id, product_id, ingredient_id);

  INSERT OR IGNORE INTO categories(name, low_threshold, critical_threshold, sort, profit_margin)
    VALUES('Mocktails', 5, 2, 2, 10);
  UPDATE categories SET sort = 1 WHERE name = 'Alcohol';
  UPDATE categories SET sort = 2, profit_margin = 10 WHERE name = 'Mocktails';
  UPDATE categories SET sort = 3 WHERE name = 'Soft Drinks';
  UPDATE categories SET sort = 4 WHERE name = 'Food';
  UPDATE categories SET sort = 5 WHERE name = 'Cigarettes';
  UPDATE categories SET sort = 6 WHERE name = 'Misc';

  -- Populate Blue Lagoon & Mint Mojito on existing station databases where ingredients exist
  INSERT INTO products(name, category_id, sub_category, brand, description, image, size_ml, unit, is_peg, is_recipe, purchase_price, selling_price, peg_price, stock, favourite, active)
  SELECT 'BLUE LAGOON', (SELECT id FROM categories WHERE name = 'Mocktails'), NULL, 'Mocktails', 'Refreshing Blue Curaçao citrus mocktail', '/uploads/real-blue-lagoon.jpg', 0, 'glass', 0, 1, 0, 69.37, 0, 0, 1, 1
  WHERE EXISTS (SELECT 1 FROM products WHERE upper(name) = 'BLUE CURACAO')
    AND EXISTS (SELECT 1 FROM products WHERE upper(name) = 'SOFT 250 ML')
    AND EXISTS (SELECT 1 FROM products WHERE upper(name) = 'SODA 300 ML')
    AND EXISTS (SELECT 1 FROM products WHERE upper(name) = 'FRESH LIME')
    AND NOT EXISTS (SELECT 1 FROM products WHERE upper(name) = 'BLUE LAGOON');

  INSERT OR IGNORE INTO product_recipes(product_id, ingredient_id, qty, display_qty, display_unit)
  SELECT p.id, i.id, 2, 60, 'ml' FROM products p, products i WHERE upper(p.name) = 'BLUE LAGOON' AND upper(i.name) = 'BLUE CURACAO';
  INSERT OR IGNORE INTO product_recipes(product_id, ingredient_id, qty, display_qty, display_unit)
  SELECT p.id, i.id, 1, 250, 'ml' FROM products p, products i WHERE upper(p.name) = 'BLUE LAGOON' AND upper(i.name) = 'SOFT 250 ML';
  INSERT OR IGNORE INTO product_recipes(product_id, ingredient_id, qty, display_qty, display_unit)
  SELECT p.id, i.id, 1, 250, 'ml' FROM products p, products i WHERE upper(p.name) = 'BLUE LAGOON' AND upper(i.name) = 'SODA 300 ML';
  INSERT OR IGNORE INTO product_recipes(product_id, ingredient_id, qty, display_qty, display_unit)
  SELECT p.id, i.id, 1, 1, 'piece' FROM products p, products i WHERE upper(p.name) = 'BLUE LAGOON' AND upper(i.name) = 'FRESH LIME';

  INSERT INTO products(name, category_id, sub_category, brand, description, image, size_ml, unit, is_peg, is_recipe, purchase_price, selling_price, peg_price, stock, favourite, active)
  SELECT 'MINT MOJITO', (SELECT id FROM categories WHERE name = 'Mocktails'), NULL, 'Mocktails', 'Chilled classic virgin mint & lime mojito', '/uploads/real-mint-mojito.jpg', 0, 'glass', 0, 1, 0, 76.39, 0, 0, 1, 1
  WHERE EXISTS (SELECT 1 FROM products WHERE upper(name) = 'MINT SYRUP')
    AND EXISTS (SELECT 1 FROM products WHERE upper(name) = 'SOFT 250 ML')
    AND EXISTS (SELECT 1 FROM products WHERE upper(name) = 'SODA 300 ML')
    AND EXISTS (SELECT 1 FROM products WHERE upper(name) = 'FRESH LIME')
    AND NOT EXISTS (SELECT 1 FROM products WHERE upper(name) = 'MINT MOJITO');

  INSERT OR IGNORE INTO product_recipes(product_id, ingredient_id, qty, display_qty, display_unit)
  SELECT p.id, i.id, 2, 60, 'ml' FROM products p, products i WHERE upper(p.name) = 'MINT MOJITO' AND upper(i.name) = 'MINT SYRUP';
  INSERT OR IGNORE INTO product_recipes(product_id, ingredient_id, qty, display_qty, display_unit)
  SELECT p.id, i.id, 1, 250, 'ml' FROM products p, products i WHERE upper(p.name) = 'MINT MOJITO' AND upper(i.name) = 'SOFT 250 ML';
  INSERT OR IGNORE INTO product_recipes(product_id, ingredient_id, qty, display_qty, display_unit)
  SELECT p.id, i.id, 1, 250, 'ml' FROM products p, products i WHERE upper(p.name) = 'MINT MOJITO' AND upper(i.name) = 'SODA 300 ML';
  INSERT OR IGNORE INTO product_recipes(product_id, ingredient_id, qty, display_qty, display_unit)
  SELECT p.id, i.id, 1, 1, 'piece' FROM products p, products i WHERE upper(p.name) = 'MINT MOJITO' AND upper(i.name) = 'FRESH LIME';
  `,
  // v13: Party-only packaged beverages (Coke/Sprite 250ml & 750ml, Tonic Water can ₹88, Lime ₹13) + Locally Purchased Miscellaneous products with dynamic cost+margin pricing & profit ledger
  `
  ALTER TABLE products ADD COLUMN party_only INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE products ADD COLUMN is_local_purchase INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE orders ADD COLUMN is_party INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE order_items ADD COLUMN purchase_cost REAL;

  CREATE TABLE IF NOT EXISTS misc_transactions(
    id INTEGER PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    product_name TEXT NOT NULL,
    qty REAL NOT NULL,
    unit_purchase_cost REAL NOT NULL,
    total_purchase_cost REAL NOT NULL,
    margin_pct REAL NOT NULL,
    unit_selling_price REAL NOT NULL,
    total_selling_value REAL NOT NULL,
    profit REAL NOT NULL,
    reversed INTEGER NOT NULL DEFAULT 0,
    user_id INTEGER REFERENCES users(id),
    at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_misc_tx_order ON misc_transactions(order_id);
  CREATE INDEX IF NOT EXISTS idx_misc_tx_at ON misc_transactions(at);

  -- Rename Misc category to Miscellaneous with default 10% local-purchase profit margin
  UPDATE categories SET name = 'Miscellaneous', profit_margin = 10 WHERE name = 'Misc'
    AND NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Miscellaneous');
  INSERT OR IGNORE INTO categories(name, low_threshold, critical_threshold, sort, profit_margin)
    VALUES('Miscellaneous', 10, 3, 6, 10);
  UPDATE categories SET sort = 6, profit_margin = CASE WHEN profit_margin = 0 THEN 10 ELSE profit_margin END
    WHERE name = 'Miscellaneous';

  -- Reuse existing Tonic Water (complete can @ ₹88) and Fresh Lime (₹13 reference/purchase cost) without duplicating
  UPDATE products SET unit = 'can', selling_price = 88, description = 'Tonic Water · Complete Can'
    WHERE upper(name) = 'TONIC WATER';
  UPDATE products SET purchase_price = 13, selling_price = 13, description = 'Fresh Lime · Complete Piece'
    WHERE upper(name) = 'FRESH LIME';

  -- Add Coke & Sprite 250 ml (regular + party) and 750 ml (Party Use Only) on existing station DBs
  INSERT INTO products(name, category_id, sub_category, brand, description, image, size_ml, unit, is_peg, is_recipe, party_only, is_local_purchase, purchase_price, selling_price, peg_price, stock, favourite, active)
  SELECT 'Coca-Cola 250 ml', (SELECT id FROM categories WHERE name = 'Soft Drinks'), 'Soda', 'Coca-Cola', 'Chilled Coca-Cola · 250 ml Bottle', '/uploads/real-coca-cola-250-ml.jpg', 250, 'bottle', 0, 0, 0, 0, 18, 20, 0, 30, 1, 1
  WHERE EXISTS (SELECT 1 FROM products WHERE upper(name) = 'SOFT 250 ML')
    AND NOT EXISTS (SELECT 1 FROM products WHERE upper(name) = 'COCA-COLA 250 ML');

  INSERT INTO stock_movements(product_id, type, qty, unit_cost, note, at)
  SELECT id, 'opening', 30, 18, 'Opening Stock: 30 bottle(s)', strftime('%Y-%m-%dT%H:%M:%fZ','now')
  FROM products WHERE upper(name) = 'COCA-COLA 250 ML'
    AND NOT EXISTS (SELECT 1 FROM stock_movements WHERE product_id = products.id);

  INSERT INTO products(name, category_id, sub_category, brand, description, image, size_ml, unit, is_peg, is_recipe, party_only, is_local_purchase, purchase_price, selling_price, peg_price, stock, favourite, active)
  SELECT 'Coca-Cola 750 ml', (SELECT id FROM categories WHERE name = 'Soft Drinks'), 'Soda', 'Coca-Cola', 'Coca-Cola · 750 ml Bottle (Party Use Only)', '/uploads/real-coca-cola-750-ml.jpg', 750, 'bottle', 0, 0, 1, 0, 36, 40, 0, 24, 0, 1
  WHERE EXISTS (SELECT 1 FROM products WHERE upper(name) = 'SOFT 250 ML')
    AND NOT EXISTS (SELECT 1 FROM products WHERE upper(name) = 'COCA-COLA 750 ML');

  INSERT INTO stock_movements(product_id, type, qty, unit_cost, note, at)
  SELECT id, 'opening', 24, 36, 'Opening Stock: 24 bottle(s)', strftime('%Y-%m-%dT%H:%M:%fZ','now')
  FROM products WHERE upper(name) = 'COCA-COLA 750 ML'
    AND NOT EXISTS (SELECT 1 FROM stock_movements WHERE product_id = products.id);

  INSERT INTO products(name, category_id, sub_category, brand, description, image, size_ml, unit, is_peg, is_recipe, party_only, is_local_purchase, purchase_price, selling_price, peg_price, stock, favourite, active)
  SELECT 'Sprite 250 ml', (SELECT id FROM categories WHERE name = 'Soft Drinks'), 'Soda', 'Sprite', 'Chilled Sprite · 250 ml Bottle', '/uploads/real-sprite-250-ml.jpg', 250, 'bottle', 0, 0, 0, 0, 18, 20, 0, 30, 1, 1
  WHERE EXISTS (SELECT 1 FROM products WHERE upper(name) = 'SOFT 250 ML')
    AND NOT EXISTS (SELECT 1 FROM products WHERE upper(name) = 'SPRITE 250 ML');

  INSERT INTO stock_movements(product_id, type, qty, unit_cost, note, at)
  SELECT id, 'opening', 30, 18, 'Opening Stock: 30 bottle(s)', strftime('%Y-%m-%dT%H:%M:%fZ','now')
  FROM products WHERE upper(name) = 'SPRITE 250 ML'
    AND NOT EXISTS (SELECT 1 FROM stock_movements WHERE product_id = products.id);

  INSERT INTO products(name, category_id, sub_category, brand, description, image, size_ml, unit, is_peg, is_recipe, party_only, is_local_purchase, purchase_price, selling_price, peg_price, stock, favourite, active)
  SELECT 'Sprite 750 ml', (SELECT id FROM categories WHERE name = 'Soft Drinks'), 'Soda', 'Sprite', 'Sprite · 750 ml Bottle (Party Use Only)', '/uploads/real-sprite-750-ml.jpg', 750, 'bottle', 0, 0, 1, 0, 36, 40, 0, 24, 0, 1
  WHERE EXISTS (SELECT 1 FROM products WHERE upper(name) = 'SOFT 250 ML')
    AND NOT EXISTS (SELECT 1 FROM products WHERE upper(name) = 'SPRITE 750 ML');

  INSERT INTO stock_movements(product_id, type, qty, unit_cost, note, at)
  SELECT id, 'opening', 24, 36, 'Opening Stock: 24 bottle(s)', strftime('%Y-%m-%dT%H:%M:%fZ','now')
  FROM products WHERE upper(name) = 'SPRITE 750 ML'
    AND NOT EXISTS (SELECT 1 FROM stock_movements WHERE product_id = products.id);

  -- Add initial locally purchased Miscellaneous products (no fixed selling price, on-demand purchase cost + margin)
  INSERT INTO products(name, category_id, sub_category, brand, description, image, size_ml, unit, is_peg, is_recipe, party_only, is_local_purchase, purchase_price, selling_price, peg_price, stock, favourite, active)
  SELECT 'Coconut Water', (SELECT id FROM categories WHERE name = 'Miscellaneous'), NULL, 'Local Purchase', 'Fresh tender coconut water (locally purchased on demand)', '/uploads/real-coconut-water.jpg', 0, 'unit', 0, 0, 0, 1, 0, 0, 0, 0, 0, 1
  WHERE EXISTS (SELECT 1 FROM products WHERE upper(name) = 'SOFT 250 ML')
    AND NOT EXISTS (SELECT 1 FROM products WHERE upper(name) = 'COCONUT WATER');

  INSERT INTO products(name, category_id, sub_category, brand, description, image, size_ml, unit, is_peg, is_recipe, party_only, is_local_purchase, purchase_price, selling_price, peg_price, stock, favourite, active)
  SELECT 'Fresh Fruit Juices', (SELECT id FROM categories WHERE name = 'Miscellaneous'), NULL, 'Local Purchase', 'Fresh seasonal fruit juice (locally purchased on demand)', '/uploads/real-fresh-fruit-juices.jpg', 0, 'glass', 0, 0, 0, 1, 0, 0, 0, 0, 0, 1
  WHERE EXISTS (SELECT 1 FROM products WHERE upper(name) = 'SOFT 250 ML')
    AND NOT EXISTS (SELECT 1 FROM products WHERE upper(name) = 'FRESH FRUIT JUICES');

  INSERT INTO products(name, category_id, sub_category, brand, description, image, size_ml, unit, is_peg, is_recipe, party_only, is_local_purchase, purchase_price, selling_price, peg_price, stock, favourite, active)
  SELECT 'Sugarcane Juice', (SELECT id FROM categories WHERE name = 'Miscellaneous'), NULL, 'Local Purchase', 'Fresh sugarcane juice (locally purchased on demand)', '/uploads/real-sugarcane-juice.jpg', 0, 'glass', 0, 0, 0, 1, 0, 0, 0, 0, 0, 1
  WHERE EXISTS (SELECT 1 FROM products WHERE upper(name) = 'SOFT 250 ML')
    AND NOT EXISTS (SELECT 1 FROM products WHERE upper(name) = 'SUGARCANE JUICE');
  `,
];

export function migrate() {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, at TEXT)');
  const cur = q.get('SELECT MAX(version) v FROM schema_migrations')?.v || 0;
  migrations.forEach((sql, i) => {
    const v = i + 1;
    if (v <= cur) return;
    db.exec('PRAGMA foreign_keys = OFF');
    try {
      tx(() => {
        db.exec(sql);
        q.run('INSERT INTO schema_migrations(version, at) VALUES(?,?)', v, now());
      });
    } finally {
      db.exec('PRAGMA foreign_keys = ON');
    }
    console.log(`[db] migration v${v} applied`);
  });
}

export const DEFAULT_SETTINGS = {
  bar_name: "DIVINA OFFICERS' BAR",
  bar_address: '',
  bar_phone: '',
  currency: '₹',
  logo: '/Login_logo.png',
  background: '/Login_bg.webp',
  theme: 'dark',
  accent: '#f59e0b',
  approval_hours: '24',
  peg_sizes: '30,60',
  guest_alcohol_limit: '3',
  member_alcohol_limit: '0',
  alcohol_limit_scope: 'day',
  alcohol_limit_unit: 'pegs',
  deduct_on: 'served',
  allow_negative_stock: '0',
  report_footer: 'Generated by DivinaBar – offline bar management',
  auto_backup_hours: '6',
  backup_keep: '20',
};

export function getSettings() {
  const rows = q.all('SELECT key, value FROM settings');
  const s = { ...DEFAULT_SETTINGS };
  for (const r of rows) s[r.key] = r.value;
  return s;
}

export const ALL_TABLES = [
  'users', 'categories', 'products', 'product_recipes', 'tables', 'orders', 'order_items', 'order_events',
  'recipe_consumptions', 'misc_transactions', 'stock_movements', 'reconciliations', 'favorite_orders', 'settings', 'audit_logs', 'notifications',
];

export function audit(userId, action, entity, entityId, details) {
  q.run('INSERT INTO audit_logs(user_id, action, entity, entity_id, details, at) VALUES(?,?,?,?,?,?)',
    userId ?? null, action, entity ?? null, entityId == null ? null : String(entityId),
    details == null ? null : typeof details === 'string' ? details : JSON.stringify(details), now());
}

export function notify(targetRole, userId, message, link) {
  q.run('INSERT INTO notifications(target_role, user_id, message, link, at) VALUES(?,?,?,?,?)',
    targetRole ?? null, userId ?? null, message, link ?? null, now());
}
