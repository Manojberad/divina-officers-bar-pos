import crypto from 'node:crypto';
import { q, tx, now, getSettings, audit, notify } from './db.js';
import { broadcast } from './events.js';
import { localToday, tdValidity, STAFF, isAdmin } from './auth.js';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/* ---------------- Stock helpers ---------------- */
export const displayQty = (p) => (p.is_peg && p.size_ml > 0 ? p.stock / p.size_ml : p.stock);
export const baseCost = (p) => (p.is_peg && p.size_ml > 0 ? p.purchase_price / p.size_ml : p.purchase_price);
export const toBase = (p, qty) => (p.is_peg && p.size_ml > 0 ? qty * p.size_ml : qty);

export function thresholds(p) {
  const low = p.min_stock ?? p.cat_low ?? 3;
  const crit = p.critical_stock ?? p.cat_critical ?? 1;
  return { low, crit };
}

export function stockStatus(p) {
  const d = displayQty(p);
  const { low, crit } = thresholds(p);
  if (d <= 0) return 'out';
  if (d <= crit) return 'critical';
  if (d <= low) return 'low';
  return 'healthy';
}

export const PRODUCT_SELECT = `SELECT p.*, c.name category, c.low_threshold cat_low, c.critical_threshold cat_critical
  FROM products p LEFT JOIN categories c ON c.id = p.category_id`;

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export function getRecipe(productId) {
  return q.all(
    `SELECT r.id, r.product_id, r.ingredient_id, r.qty, r.display_qty, r.display_unit,
            p.name ingredient_name, p.unit ingredient_unit, p.is_peg ingredient_is_peg,
            p.size_ml ingredient_size_ml, p.purchase_price ingredient_purchase_price, p.stock ingredient_stock
     FROM product_recipes r
     JOIN products p ON p.id = r.ingredient_id
     WHERE r.product_id = ?
     ORDER BY r.id`,
    productId,
  );
}

export function computeRecipeMetrics(productId) {
  const rows = getRecipe(productId);
  const ingredients = rows.map((r) => {
    const unitCost = r.ingredient_is_peg && r.ingredient_size_ml > 0
      ? r.ingredient_purchase_price / r.ingredient_size_ml
      : r.ingredient_purchase_price;
    const lineCost = round2(r.qty * unitCost);
    const makeable = r.qty > 0 ? Math.floor(Math.max(0, r.ingredient_stock) / r.qty) : 0;
    return {
      id: r.id,
      ingredient_id: r.ingredient_id,
      ingredient_name: r.ingredient_name,
      qty: r.qty,
      display_qty: r.display_qty,
      display_unit: r.display_unit,
      ingredient_unit: r.ingredient_is_peg ? 'ml' : r.ingredient_unit || 'unit',
      ingredient_stock: round2(r.ingredient_stock),
      unit_cost: Math.round(unitCost * 10000) / 10000,
      line_cost: lineCost,
      makeable,
    };
  });
  const recipe_cost = round2(ingredients.reduce((s, i) => s + i.line_cost, 0));
  const max_makeable = ingredients.length ? Math.min(...ingredients.map((i) => i.makeable)) : 0;
  const limiting = ingredients.find((i) => i.makeable === max_makeable)?.ingredient_name || null;
  return { ingredients, recipe_cost, max_makeable, limiting_ingredient: limiting };
}

export function decorate(p) {
  if (!p) return p;
  const { low, crit } = thresholds(p);
  if (p.is_recipe) {
    const m = computeRecipeMetrics(p.id);
    const st = m.max_makeable <= 0 ? 'out' : m.max_makeable <= crit ? 'critical' : m.max_makeable <= low ? 'low' : 'healthy';
    return {
      ...p,
      is_peg: false,
      is_recipe: true,
      favourite: !!p.favourite,
      active: !!p.active,
      sub_category: p.sub_category || null,
      recipe: m.ingredients,
      recipe_cost: m.recipe_cost,
      limiting_ingredient: m.limiting_ingredient,
      stock_display: m.max_makeable,
      stock_unit: p.unit || 'glass',
      full_bottles: m.max_makeable,
      loose_pegs_30ml: 0,
      low_level: low,
      critical_level: crit,
      stock_status: st,
      stock_value: 0, // Physical stock value is accounted on raw ingredients to prevent double counting
    };
  }
  const fullBottles = p.is_peg && p.size_ml > 0 ? Math.floor(Math.max(0, p.stock) / p.size_ml) : Math.floor(Math.max(0, p.stock));
  const looseMl = p.is_peg && p.size_ml > 0 ? Math.round((Math.max(0, p.stock) - fullBottles * p.size_ml) * 100) / 100 : 0;
  const loosePegs = p.is_peg && p.size_ml > 0 ? Math.round((looseMl / 30) * 100) / 100 : 0;
  return {
    ...p,
    is_peg: !!p.is_peg,
    is_recipe: false,
    favourite: !!p.favourite,
    active: !!p.active,
    sub_category: p.sub_category || null,
    recipe: [],
    recipe_cost: null,
    stock_display: Math.round(displayQty(p) * 100) / 100,
    stock_unit: p.is_peg ? 'bottles' : p.unit || 'units',
    full_bottles: fullBottles,
    loose_pegs_30ml: loosePegs,
    low_level: low,
    critical_level: crit,
    stock_status: stockStatus(p),
    stock_value: Math.round(displayQty(p) * p.purchase_price * 100) / 100,
  };
}

export function getProduct(id) {
  return q.get(`${PRODUCT_SELECT} WHERE p.id=?`, id);
}

/** Record a stock movement and update the product stock atomically. qty in base units (signed). */
export function moveStock({ productId, type, qty, unitCost = null, supplier = null, invoice = null, orderId = null, note = null, userId = null, at }) {
  return tx(() => {
    const p = getProduct(productId);
    if (!p) throw new HttpError(404, 'Product not found');
    const allowNeg = getSettings().allow_negative_stock === '1';
    if (!allowNeg && p.stock + qty < -1e-9) {
      throw new HttpError(409, `Insufficient stock for ${p.name} (available ${decorate(p).stock_display} ${decorate(p).stock_unit})`);
    }
    q.run(`INSERT INTO stock_movements(product_id, type, qty, unit_cost, supplier, invoice, order_id, note, user_id, at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`, productId, type, qty, unitCost, supplier, invoice, orderId, note, userId, at || now());
    q.run('UPDATE products SET stock = stock + ? WHERE id=?', qty, productId);
    return getProduct(productId);
  });
}

/* ---------------- Orders ---------------- */
export const FLOW = ['draft', 'placed', 'accepted', 'preparing', 'served', 'closed'];
const ALLOWED_PEGS = [30, 60];

export function priceItem(p, item, _settings, isStaff) {
  const qty = Number(item.qty);
  if (!(qty > 0)) throw new HttpError(400, 'Quantity must be positive');
  let serve = item.serve_type || (p.is_peg ? (isStaff ? 'bottle' : 'peg') : 'unit');
  let pegMl = null, unitPrice, base;
  if (serve === 'peg') {
    if (!p.is_peg) throw new HttpError(400, `${p.name} cannot be served by peg`);
    pegMl = Number(item.peg_ml || 30);
    if (!ALLOWED_PEGS.includes(pegMl)) throw new HttpError(400, 'Only Small (30 ml) and Large (60 ml) pegs are allowed');
    unitPrice = Math.round((p.peg_price * pegMl) / 30 * 100) / 100;
    base = qty * pegMl;
  } else {
    if (p.is_peg) {
      if (!isStaff) throw new HttpError(403, 'Only Bartender or Admin can issue a full bottle');
      serve = 'bottle';
    } else {
      serve = 'unit';
    }
    unitPrice = p.selling_price;
    base = p.is_peg ? qty * p.size_ml : qty;
  }
  if (isStaff && item.unit_price != null && item.unit_price !== '' && Number(item.unit_price) >= 0) unitPrice = Number(item.unit_price);
  return { product_id: p.id, name: p.name, serve_type: serve, peg_ml: pegMl, qty, unit_price: unitPrice, line_total: Math.round(unitPrice * qty * 100) / 100, base_qty: base };
}

export function loadOrder(id) {
  const o = q.get(`SELECT o.*, u.name customer_name, u.service_no customer_service_no, u.rank customer_rank,
      u.role customer_role, u.category customer_category, t.name table_name, cb.name created_by_name
    FROM orders o LEFT JOIN users u ON u.id=o.user_id LEFT JOIN tables t ON t.id=o.table_id
    LEFT JOIN users cb ON cb.id=o.created_by WHERE o.id=?`, id);
  if (!o) return null;
  o.items = q.all('SELECT * FROM order_items WHERE order_id=?', id);
  return o;
}

function nextOrderNo() {
  const d = new Date();
  const prefix = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const last = q.get("SELECT order_no FROM orders WHERE order_no LIKE ? ORDER BY id DESC LIMIT 1", `${prefix}-%`);
  const n = last ? Number(last.order_no.split('-')[1]) + 1 : 1;
  return `${prefix}-${String(n).padStart(4, '0')}`;
}

export function getAlcoholUsage(targetUser, settings = getSettings()) {
  if (!targetUser) return { limit: 0, used: 0, scope: settings.alcohol_limit_scope || 'day', unit: settings.alcohol_limit_unit || 'pegs' };
  const scope = settings.alcohol_limit_scope === 'order' ? 'order' : 'day';
  const unit = settings.alcohol_limit_unit === 'small_eq' ? 'small_eq' : 'pegs';
  let limit = 0;
  if (targetUser.alcohol_limit != null && targetUser.alcohol_limit !== '') {
    limit = Math.max(0, Number(targetUser.alcohol_limit) || 0);
  } else if (targetUser.role === 'guest') {
    limit = Math.max(0, Number(settings.guest_alcohol_limit || 0));
  } else if (['member', 'customer'].includes(targetUser.role)) {
    limit = Math.max(0, Number(settings.member_alcohol_limit || 0));
  }
  let used = 0;
  if (limit > 0 && scope === 'day') {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const expr = unit === 'small_eq' ? 'CASE WHEN i.serve_type=\'peg\' THEN i.qty * (COALESCE(i.peg_ml, 30) / 30.0) ELSE 0 END' : 'CASE WHEN i.serve_type=\'peg\' THEN i.qty ELSE 0 END';
    const row = q.get(
      `SELECT COALESCE(SUM(${expr}), 0) n
       FROM order_items i JOIN orders o ON o.id=i.order_id
       WHERE o.user_id=? AND o.status NOT IN ('cancelled','draft') AND o.created_at>=?`,
      targetUser.id, startOfDay.toISOString(),
    );
    used = Math.round((row?.n || 0) * 100) / 100;
  }
  return { limit, used, remaining: limit > 0 ? Math.max(0, Math.round((limit - used) * 100) / 100) : null, scope, unit };
}

export function createOrder(body, user) {
  const settings = getSettings();
  const isStaff = user && STAFF.includes(user.role);
  if (body.client_uuid) {
    const dup = q.get('SELECT id FROM orders WHERE client_uuid=?', body.client_uuid);
    if (dup) return { order: loadOrder(dup.id), duplicate: true };
  }
  if (!Array.isArray(body.items) || body.items.length === 0) throw new HttpError(400, 'Order has no items');
  let userId = user?.id ?? null;
  if (isStaff) userId = body.user_id ? Number(body.user_id) : null;
  const targetUser = userId ? q.get("SELECT id, name, role, category, alcohol_limit, td_start_date, td_end_date FROM users WHERE id=? AND active=1 AND approval_status='approved'", userId) : null;
  if (userId && !targetUser) throw new HttpError(400, 'Unknown or unapproved customer');
  if (targetUser) {
    const tdv = tdValidity(targetUser);
    if (!tdv.ok) throw new HttpError(403, tdv.message);
  }
  let tableId = body.table_id ? Number(body.table_id) : null;
  if (body.table_code) {
    const t = q.get('SELECT id FROM tables WHERE code=? AND active=1', body.table_code);
    if (!t) throw new HttpError(400, 'Table QR code is not active');
    tableId = t.id;
  }
  const type = body.type === 'prebooked' ? 'prebooked' : 'ondemand';
  if (type === 'prebooked') {
    if (!body.scheduled_at || isNaN(Date.parse(body.scheduled_at))) throw new HttpError(400, 'Pre-booked orders need a valid date/time');
    if (['customer', 'guest'].includes(user?.role)) throw new HttpError(403, 'Only members can pre-book orders');
  }
  const isDraft = body.status === 'draft' || type === 'prebooked';
  const normPay = body.payment_mode ? String(body.payment_mode).toLowerCase() : null;
  if (normPay && !['cash', 'upi'].includes(normPay)) throw new HttpError(400, 'Payment mode must be Cash or UPI');

  // Streamlined single-bartender flow: on-demand orders are auto-accepted & billed immediately
  // (Guest orders without payment_mode are auto-accepted & stock-deducted as 'served' awaiting 1-tap Cash/UPI)
  const autoGuestServed = !isDraft && targetUser?.role === 'guest' && !normPay;
  const status = isDraft ? 'draft' : autoGuestServed ? 'served' : 'closed';

  const items = body.items.map((it) => {
    const p = getProduct(Number(it.product_id));
    if (!p || !p.active) throw new HttpError(400, 'Product unavailable');
    return priceItem(p, it, settings, isStaff);
  });

  // Enforce alcohol order limit (for Guests and/or Members as configured by Admin)
  if (targetUser && status !== 'draft' && !(isAdmin(user) && body.override_limit)) {
    const usage = getAlcoholUsage(targetUser, settings);
    if (usage.limit > 0) {
      const incoming = items.reduce((sum, i) => {
        if (i.serve_type !== 'peg') return sum;
        return sum + (usage.unit === 'small_eq' ? i.qty * ((i.peg_ml || 30) / 30) : i.qty);
      }, 0);
      if (incoming > 0 && usage.used + incoming > usage.limit + 1e-9) {
        const unitLabel = usage.unit === 'small_eq' ? 'Small (30 ml) equivalents' : 'Small/Large pegs';
        const scopeLabel = usage.scope === 'day' ? 'per day' : 'per order';
        const roleLabel = targetUser.role === 'guest' ? 'Guest' : 'Member';
        throw new HttpError(
          400,
          `${roleLabel} alcohol limit exceeded: maximum ${usage.limit} ${unitLabel} ${scopeLabel} allowed${usage.used > 0 ? ` (already ordered: ${usage.used}, requested: ${incoming})` : ` (requested: ${incoming})`}.`,
        );
      }
    }
  }
  // Availability check (expands recipe products into exact ingredient requirements & aggregates across entire order)
  const expanded = expandStockRequirements(items);
  validateStockRequirements(expanded.stockByProduct, settings.allow_negative_stock === '1');
  const total = Math.round(items.reduce((s, i) => s + i.line_total, 0) * 100) / 100;

  const id = tx(() => {
    const t = now();
    const closedAt = status === 'closed' ? t : null;
    const approvalStatus = status === 'closed' ? (userId ? 'pending' : 'na') : 'na';
    const r = q.run(
      `INSERT INTO orders(order_no, client_uuid, user_id, created_by, table_id, type, scheduled_at, status, source, notes, total, payment_mode, payment_ref, closed_at, approval_status, created_at, updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      nextOrderNo(), body.client_uuid || crypto.randomUUID(), userId, user?.id ?? null, tableId,
      type, type === 'prebooked' ? new Date(body.scheduled_at).toISOString() : null, status, body.source || (isStaff ? 'pos' : 'self'),
      body.notes || null, total, normPay, body.payment_ref ? String(body.payment_ref).trim() : null, closedAt, approvalStatus, t, t,
    );
    const oid = Number(r.lastInsertRowid);
    for (const i of items) {
      q.run(`INSERT INTO order_items(order_id, product_id, name, serve_type, peg_ml, qty, unit_price, line_total, base_qty) VALUES(?,?,?,?,?,?,?,?,?)`,
        oid, i.product_id, i.name, i.serve_type, i.peg_ml, i.qty, i.unit_price, i.line_total, i.base_qty);
    }
    const evNote = isDraft ? 'pre-order / draft created' : autoGuestServed ? 'auto-accepted (guest awaiting Cash/UPI)' : 'auto-accepted & billed';
    q.run('INSERT INTO order_events(order_id, from_status, to_status, user_id, note, at) VALUES(?,?,?,?,?,?)', oid, null, status, user?.id ?? null, evNote, t);
    if (!isDraft) {
      const created = loadOrder(oid);
      deduct(created, user?.id ?? null);
    }
    return oid;
  });
  const order = loadOrder(id);
  broadcast('order', { id, user_id: order.user_id, status: order.status, action: 'created' });
  return { order, duplicate: false };
}

/** Bartender or Admin edits items/quantities of an order (e.g. item unavailable) with atomic stock adjustment. */
export function editOrderItems(orderId, rawItems, notes, user, reason = null) {
  if (!user || !STAFF.includes(user.role)) throw new HttpError(403, 'Only bartender or admin can edit orders');
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new HttpError(400, 'Order must keep at least one item — cancel the order to remove all items');
  }
  const settings = getSettings();
  const updated = tx(() => {
    const o = loadOrder(orderId);
    if (!o) throw new HttpError(404, 'Order not found');
    if (o.status === 'cancelled') throw new HttpError(409, 'Cannot edit a cancelled order');

    const newItems = rawItems.map((it) => {
      const p = getProduct(Number(it.product_id));
      if (!p) throw new HttpError(400, 'Product not found');
      return priceItem(p, it, settings, true);
    });

    const t = now();
    if (o.stock_deducted) {
      const oldRows = q.all("SELECT product_id, SUM(ABS(qty)) qty FROM stock_movements WHERE order_id=? AND type='sale' GROUP BY product_id", o.id);
      const oldMap = new Map(oldRows.map((r) => [Number(r.product_id), Number(r.qty)]));
      const newExpanded = expandStockRequirements(newItems);
      const newMap = new Map([...newExpanded.stockByProduct.entries()].map(([pid, info]) => [pid, info.qty]));
      const allPids = new Set([...oldMap.keys(), ...newMap.keys()]);
      const allowNeg = settings.allow_negative_stock === '1';
      for (const pid of allPids) {
        const oldQty = oldMap.get(pid) || 0;
        const newQty = newMap.get(pid) || 0;
        const delta = newQty - oldQty; // positive = deduct more; negative = return stock
        const p = getProduct(pid);
        if (Math.abs(delta) > 1e-9) {
          if (!allowNeg && p.stock - delta < -1e-9) {
            const info = newExpanded.stockByProduct.get(pid);
            const srcNote = info?.sources?.size ? ` (required for ${[...info.sources].join(', ')})` : '';
            throw new HttpError(409, `Insufficient stock for ${p.name}${srcNote}`);
          }
          q.run('UPDATE products SET stock = stock - ? WHERE id=?', delta, pid);
        }
        const info = newExpanded.stockByProduct.get(pid);
        const noteStr = info?.notes?.length ? `Order ${o.order_no} (edited; ${info.notes.join('; ')})` : `Order ${o.order_no} (edited)`;
        if (newQty <= 1e-9) {
          q.run("DELETE FROM stock_movements WHERE order_id=? AND product_id=? AND type='sale'", o.id, pid);
        } else if (oldQty <= 1e-9) {
          q.run(
            `INSERT INTO stock_movements(product_id, type, qty, unit_cost, order_id, note, user_id, at)
             VALUES(?, 'sale', ?, ?, ?, ?, ?, ?)`,
            pid, -newQty, baseCost(p), o.id, noteStr, user.id, t,
          );
        } else {
          q.run(
            "UPDATE stock_movements SET qty=?, unit_cost=?, note=?, user_id=?, at=? WHERE order_id=? AND product_id=? AND type='sale'",
            -newQty, baseCost(p), noteStr, user.id, t, o.id, pid,
          );
        }
      }
      // Refresh ingredient-level recipe accountability records atomically
      q.run('DELETE FROM recipe_consumptions WHERE order_id=?', o.id);
      recordRecipeConsumptions(o.id, newExpanded.consumptions, t);
    }

    const total = Math.round(newItems.reduce((s, i) => s + i.line_total, 0) * 100) / 100;
    q.run('DELETE FROM order_items WHERE order_id=?', o.id);
    for (const i of newItems) {
      q.run(`INSERT INTO order_items(order_id, product_id, name, serve_type, peg_ml, qty, unit_price, line_total, base_qty) VALUES(?,?,?,?,?,?,?,?,?)`,
        o.id, i.product_id, i.name, i.serve_type, i.peg_ml, i.qty, i.unit_price, i.line_total, i.base_qty);
    }
    const nextNotes = notes !== undefined ? (notes || null) : o.notes;
    const nextApproval = o.status === 'closed' && o.user_id ? 'pending' : o.approval_status;
    q.run('UPDATE orders SET total=?, notes=?, approval_status=?, updated_at=? WHERE id=?', total, nextNotes, nextApproval, t, o.id);
    const evMsg = `Edited by ${user.name}${reason ? `: ${reason}` : ''} (₹${o.total} → ₹${total})`;
    q.run('INSERT INTO order_events(order_id, from_status, to_status, user_id, note, at) VALUES(?,?,?,?,?,?)', o.id, o.status, o.status, user.id, evMsg, t);
    audit(user.id, 'order.edit', 'order', o.id, { old_total: o.total, new_total: total, reason });
    return loadOrder(o.id);
  });
  broadcast('order', { id: orderId, user_id: updated.user_id, status: updated.status, action: 'edited' });
  return updated;
}

/**
 * Expands an order's line items into:
 *  - stockByProduct: exact aggregated inventory base-unit deductions (resolving recipe products to their ingredients)
 *  - consumptions: ingredient-level accountability records for every recipe-based product sold
 */
export function expandStockRequirements(items) {
  const stockByProduct = new Map();
  const addStockNeed = (pid, qty, note, sourceName) => {
    const cur = stockByProduct.get(pid) || { qty: 0, notes: [], sources: new Set() };
    cur.qty += qty;
    if (note) cur.notes.push(note);
    if (sourceName) cur.sources.add(sourceName);
    stockByProduct.set(pid, cur);
  };

  // Aggregate recipe items by product_id first so duplicate lines in one cart combine cleanly
  const recipeQtyByProd = new Map();
  const prodCache = new Map();
  const loadProd = (pid) => {
    if (!prodCache.has(pid)) prodCache.set(pid, getProduct(pid));
    return prodCache.get(pid);
  };

  for (const i of items) {
    const p = loadProd(Number(i.product_id));
    if (!p) throw new HttpError(400, 'Product not found');
    if (p.is_recipe) {
      recipeQtyByProd.set(p.id, (recipeQtyByProd.get(p.id) || 0) + Number(i.qty));
    } else {
      addStockNeed(p.id, Number(i.base_qty), null, null);
    }
  }

  const consumptions = [];
  for (const [prodId, qtySold] of recipeQtyByProd.entries()) {
    const p = loadProd(prodId);
    const recipe = getRecipe(prodId);
    if (!recipe.length) throw new HttpError(400, `Recipe for ${p.name} has no ingredients configured`);

    const lineEntries = recipe.map((r) => {
      const baseConsumed = Math.round(r.qty * qtySold * 10000) / 10000;
      const dispConsumed = Math.round(r.display_qty * qtySold * 10000) / 10000;
      const unitCost = r.ingredient_is_peg && r.ingredient_size_ml > 0
        ? r.ingredient_purchase_price / r.ingredient_size_ml
        : r.ingredient_purchase_price;
      const ingredientCost = round2(baseConsumed * unitCost);
      addStockNeed(r.ingredient_id, baseConsumed, `via ${qtySold} x ${p.name}`, p.name);
      return {
        product_id: p.id,
        product_name: p.name,
        qty_sold: qtySold,
        ingredient_id: r.ingredient_id,
        ingredient_name: r.ingredient_name,
        base_qty_consumed: baseConsumed,
        qty_consumed: dispConsumed,
        unit: r.display_unit,
        ingredient_unit_cost: Math.round(unitCost * 10000) / 10000,
        ingredient_cost: ingredientCost,
      };
    });
    const totalRecipeCost = round2(lineEntries.reduce((s, e) => s + e.ingredient_cost, 0));
    for (const e of lineEntries) consumptions.push({ ...e, total_recipe_cost: totalRecipeCost });
  }

  return { stockByProduct, consumptions };
}

function validateStockRequirements(stockByProduct, allowNeg) {
  if (allowNeg) return;
  for (const [pid, req] of stockByProduct.entries()) {
    const p = getProduct(pid);
    if (!p) throw new HttpError(404, 'Ingredient / product not found');
    if (p.stock < req.qty - 1e-9) {
      const unitLabel = p.is_peg ? 'ml' : p.unit || 'units';
      const needDisp = round2(req.qty);
      const availDisp = round2(Math.max(0, p.stock));
      const forSrc = req.sources?.size ? ` required for ${[...req.sources].join(', ')}` : '';
      throw new HttpError(409, `Insufficient stock for ${p.name}${forSrc} (needed ${needDisp} ${unitLabel}, available ${availDisp} ${unitLabel})`);
    }
  }
}

function recordRecipeConsumptions(orderId, consumptions, atIso) {
  for (const c of consumptions) {
    q.run(
      `INSERT INTO recipe_consumptions(
         order_id, product_id, product_name, qty_sold, ingredient_id, ingredient_name,
         base_qty_consumed, qty_consumed, unit, ingredient_unit_cost, ingredient_cost, total_recipe_cost, reversed, at
       ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,0,?)`,
      orderId, c.product_id, c.product_name, c.qty_sold, c.ingredient_id, c.ingredient_name,
      c.base_qty_consumed, c.qty_consumed, c.unit, c.ingredient_unit_cost, c.ingredient_cost, c.total_recipe_cost, atIso,
    );
  }
}

function deduct(order, userId) {
  const live = q.get('SELECT stock_deducted FROM orders WHERE id=?', order.id);
  if (order.stock_deducted || live?.stock_deducted) return; // strict idempotent guard
  const { stockByProduct, consumptions } = expandStockRequirements(order.items);
  validateStockRequirements(stockByProduct, getSettings().allow_negative_stock === '1');
  const t = now();
  for (const [productId, req] of stockByProduct.entries()) {
    const p = getProduct(productId);
    const note = req.notes.length ? `Order ${order.order_no} (${req.notes.join('; ')})` : `Order ${order.order_no}`;
    moveStock({ productId, type: 'sale', qty: -req.qty, unitCost: baseCost(p), orderId: order.id, userId, note, at: t });
  }
  recordRecipeConsumptions(order.id, consumptions, t);
  q.run('UPDATE orders SET stock_deducted=1 WHERE id=?', order.id);
}

function reverse(order, userId) {
  const live = q.get('SELECT stock_deducted FROM orders WHERE id=?', order.id);
  if (!order.stock_deducted && !live?.stock_deducted) return;
  if (q.get("SELECT 1 FROM stock_movements WHERE order_id=? AND type='sale_reversal' LIMIT 1", order.id)) return; // prevent duplicate restoration
  const deducted = q.all(
    "SELECT product_id, SUM(ABS(qty)) qty, MAX(unit_cost) unit_cost FROM stock_movements WHERE order_id=? AND type='sale' GROUP BY product_id",
    order.id,
  );
  for (const row of deducted) {
    moveStock({ productId: row.product_id, type: 'sale_reversal', qty: row.qty, unitCost: row.unit_cost, orderId: order.id, userId, note: `Cancelled ${order.order_no}` });
  }
  q.run('UPDATE recipe_consumptions SET reversed=1 WHERE order_id=?', order.id);
  q.run('UPDATE orders SET stock_deducted=0 WHERE id=?', order.id);
}

export function transition(orderId, to, user, note, paymentMode = null, paymentRef = null) {
  const settings = getSettings();
  const result = tx(() => {
    const o = loadOrder(orderId);
    if (!o) throw new HttpError(404, 'Order not found');
    const from = o.status;
    const isStaff = STAFF.includes(user.role);
    const isOwner = o.user_id === user.id;
    const normPay = paymentMode ? String(paymentMode).toLowerCase() : null;
    if (normPay && !['cash', 'upi'].includes(normPay)) throw new HttpError(400, 'Payment mode must be Cash or UPI');
    if (from === to) return o;

    if (to === 'cancelled') {
      if (from === 'cancelled') throw new HttpError(409, 'Order is already cancelled');
      if (from === 'disputed' && !isAdmin(user)) throw new HttpError(403, 'Only admin can cancel a disputed order');
      if (!isStaff && !(isOwner && ['draft', 'placed'].includes(from))) throw new HttpError(403, 'Not allowed to cancel this order');
      reverse(o, user.id);
    } else if (FLOW.includes(to)) {
      const fi = FLOW.indexOf(from), ti = FLOW.indexOf(to);
      if (from === 'disputed' && to === 'closed') {
        if (!isAdmin(user)) throw new HttpError(403, 'Only admin resolves disputes');
      } else {
        if (fi < 0 || ti <= fi) throw new HttpError(409, `Invalid transition ${from} → ${to}`);
        if (!isStaff && !(isOwner && from === 'draft' && to === 'placed')) throw new HttpError(403, 'Not allowed');
      }
      if (to === 'closed' && from !== 'disputed' && o.customer_role === 'guest') {
        if (!normPay && !o.payment_mode) {
          throw new HttpError(400, 'Select payment mode (Cash or UPI) to checkout a Guest order');
        }
      }
      const deductIdx = FLOW.indexOf(settings.deduct_on === 'accepted' ? 'accepted' : 'served');
      if (ti >= deductIdx) deduct(o, user.id);
    } else throw new HttpError(400, 'Unknown status');

    const t = now();
    const sets = ['status=?', 'updated_at=?'];
    const vals = [to, t];
    let eventNote = note || null;
    if (normPay) {
      sets.push('payment_mode=?', 'payment_ref=?');
      vals.push(normPay, paymentRef ? String(paymentRef).trim() : null);
      const payLabel = `Paid via ${normPay.toUpperCase()}${paymentRef ? ` (${String(paymentRef).trim()})` : ''}`;
      eventNote = eventNote ? `${eventNote} · ${payLabel}` : payLabel;
    }
    if (to === 'closed') {
      if (from === 'disputed') { sets.push("approval_status='approved'", 'resolution_note=?', 'approval_at=?'); vals.push(note || 'Resolved by admin', t); }
      else { sets.push('closed_at=?', 'approval_status=?'); vals.push(t, o.user_id ? 'pending' : 'na'); }
    }
    q.run(`UPDATE orders SET ${sets.join(', ')} WHERE id=?`, ...vals, orderId);
    q.run('INSERT INTO order_events(order_id, from_status, to_status, user_id, note, at) VALUES(?,?,?,?,?,?)', orderId, from, to, user.id, eventNote, t);
    if (to === 'closed' && o.customer_role === 'guest') {
      audit(user.id, 'order.guest_checkout', 'order', orderId, { payment_mode: normPay || o.payment_mode, payment_ref: paymentRef || null, total: o.total });
    }
    if (to === 'cancelled') audit(user.id, 'order.cancel', 'order', orderId, { from, note });
    if (from === 'disputed') audit(user.id, 'order.dispute_resolved', 'order', orderId, { note });
    return loadOrder(orderId);
  });
  broadcast('order', { id: orderId, user_id: result.user_id, status: result.status, action: 'status' });
  return result;
}

export function approve(orderId, user, action, note) {
  const settings = getSettings();
  const r = tx(() => {
    const o = loadOrder(orderId);
    if (!o) throw new HttpError(404, 'Order not found');
    if (o.user_id !== user.id) throw new HttpError(403, 'You can only approve your own orders');
    if (o.status !== 'closed' || o.approval_status !== 'pending') throw new HttpError(409, 'Order is not awaiting approval');
    const hours = Number(settings.approval_hours || 24);
    if (Date.now() - Date.parse(o.closed_at) > hours * 3600e3) {
      q.run("UPDATE orders SET approval_status='expired' WHERE id=?", orderId);
      throw new HttpError(409, 'Approval window has expired');
    }
    const t = now();
    if (action === 'approve') {
      q.run("UPDATE orders SET approval_status='approved', approval_at=?, updated_at=? WHERE id=?", t, t, orderId);
      q.run('INSERT INTO order_events(order_id, from_status, to_status, user_id, note, at) VALUES(?,?,?,?,?,?)', orderId, 'closed', 'closed', user.id, 'approved by customer', t);
    } else {
      if (!note) throw new HttpError(400, 'Please describe the discrepancy');
      q.run("UPDATE orders SET approval_status='disputed', status='disputed', dispute_note=?, approval_at=?, updated_at=? WHERE id=?", note, t, t, orderId);
      q.run('INSERT INTO order_events(order_id, from_status, to_status, user_id, note, at) VALUES(?,?,?,?,?,?)', orderId, 'closed', 'disputed', user.id, note, t);
      notify('admin', null, `Order ${o.order_no} disputed by ${user.name}: ${note}`, `/orders?id=${orderId}`);
      audit(user.id, 'order.dispute', 'order', orderId, { note });
    }
    return loadOrder(orderId);
  });
  broadcast('order', { id: orderId, user_id: r.user_id, status: r.status, action: 'approval' });
  broadcast('notification', {});
  return r;
}

export function expireApprovals() {
  const hours = Number(getSettings().approval_hours || 24);
  const cutoff = new Date(Date.now() - hours * 3600e3).toISOString();
  const r = q.run("UPDATE orders SET approval_status='expired' WHERE status='closed' AND approval_status='pending' AND closed_at < ?", cutoff);
  return Number(r.changes);
}

/** Notify bartender on delivery day and 1 hour before scheduled time for Pre-Orders in Draft. */
export function checkPreorderReminders() {
  const rows = q.all(
    `SELECT o.id, o.order_no, o.scheduled_at, u.name customer_name, u.rank customer_rank
     FROM orders o LEFT JOIN users u ON u.id=o.user_id
     WHERE o.type='prebooked' AND o.status IN ('draft','placed','accepted') AND o.scheduled_at IS NOT NULL`,
  );
  const nowMs = Date.now();
  const todayStr = new Date().toLocaleDateString('en-CA');
  let sent = 0;
  for (const o of rows) {
    const dueMs = Date.parse(o.scheduled_at);
    if (isNaN(dueMs)) continue;
    const dueDate = new Date(dueMs);
    const dueStr = dueDate.toLocaleDateString('en-CA');
    const timeLabel = dueDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
    const who = `${o.customer_rank ? `${o.customer_rank} ` : ''}${o.customer_name || 'Member'}`;

    // 1. Delivery-day notification
    if (dueStr === todayStr) {
      const dayTag = `Pre-Order #${o.order_no} is due TODAY`;
      if (!q.get("SELECT id FROM notifications WHERE target_role='bartender' AND message LIKE ?", `${dayTag}%`)) {
        notify('bartender', null, `${dayTag} at ${timeLabel} for ${who}`, '/orders');
        sent++;
      }
    }
    // 2. 1-hour-before notification (move to Preparing)
    const minsLeft = (dueMs - nowMs) / 60000;
    if (minsLeft <= 60 && minsLeft >= -180) {
      const hrTag = `⏰ Pre-Order #${o.order_no} due soon`;
      if (!q.get("SELECT id FROM notifications WHERE target_role='bartender' AND message LIKE ?", `${hrTag}%`)) {
        notify('bartender', null, `${hrTag} (${timeLabel} · ${who}) — move to Preparing now!`, '/orders');
        sent++;
      }
    }
  }
  if (sent > 0) broadcast('notification', {});
  return sent;
}

/** Auto-deactivate expired TD Officers and notify Admin of expiring/expired TD tenures. */
export function checkTdExpiries() {
  const today = localToday();
  const [y, m, d] = today.split('-').map(Number);
  const soonCutoff = new Date(Date.UTC(y, m - 1, d + 2)).toISOString().slice(0, 10);
  const rows = q.all("SELECT id, name, rank, service_no, td_start_date, td_end_date, active FROM users WHERE category='TD' AND td_end_date IS NOT NULL");
  let sent = 0;
  for (const u of rows) {
    const label = `${u.rank ? `${u.rank} ` : ''}${u.name} (${u.service_no})`;
    if (u.td_end_date < today) {
      if (u.active) {
        q.run('UPDATE users SET active=0 WHERE id=?', u.id);
        audit(null, 'user.td_expired', 'user', u.id, { td_end_date: u.td_end_date });
      }
      const tag = `🔴 TD Officer ${label} expired on ${u.td_end_date}`;
      if (!q.get("SELECT id FROM notifications WHERE target_role='admin' AND message LIKE ?", `${tag}%`)) {
        notify('admin', null, `${tag} — open Users to extend membership.`, '/users');
        sent++;
      }
    } else if (u.active && u.td_end_date <= soonCutoff) {
      const tag = `⏳ TD Officer ${label} expires on ${u.td_end_date}`;
      if (!q.get("SELECT id FROM notifications WHERE target_role='admin' AND message LIKE ?", `${tag}%`)) {
        notify('admin', null, `${tag} — extend membership if TD is continuing.`, '/users');
        sent++;
      }
    }
  }
  if (sent > 0) broadcast('notification', {});
  return sent;
}
