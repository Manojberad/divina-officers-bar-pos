import { Router } from 'express';
import { q } from '../db.js';
import { requireRole } from '../auth.js';
import { PRODUCT_SELECT, decorate } from '../services.js';

const r = Router();
export const SOLD = "('served','closed','disputed')";
const round = (n) => Math.round((n || 0) * 100) / 100;

export function range(from, to) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const f = from ? new Date(`${from}T00:00:00`) : new Date(today.getTime() - 29 * 86400e3);
  const t = to ? new Date(new Date(`${to}T00:00:00`).getTime() + 86400e3) : new Date(today.getTime() + 86400e3);
  return [f.toISOString(), t.toISOString()];
}

r.get('/', requireRole('admin'), (req, res) => {
  const [F, T] = range(req.query.from, req.query.to);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const tIso = today.toISOString();
  const sum = (from, to) => q.get(`SELECT COALESCE(SUM(total),0) revenue, COUNT(*) orders FROM orders WHERE status IN ${SOLD} AND created_at>=? AND created_at<?`, from, to);
  const day = 86400e3;
  const weekStart = new Date(today.getTime() - ((today.getDay() + 6) % 7) * day).toISOString();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString();
  const end = new Date(today.getTime() + day).toISOString();

  const kpi = q.get(`SELECT COALESCE(SUM(total),0) revenue, COUNT(*) orders, COALESCE(AVG(total),0) avg FROM orders WHERE status IN ${SOLD} AND created_at>=? AND created_at<?`, F, T);
  const drinks = q.get(`SELECT COALESCE(SUM(i.qty),0) n FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.status IN ${SOLD} AND o.created_at>=? AND o.created_at<?`, F, T).n;
  const statusCounts = q.all('SELECT status, COUNT(*) n FROM orders WHERE created_at>=? AND created_at<? GROUP BY status', F, T);

  const daily = q.all(`SELECT date(created_at,'localtime') d, SUM(total) revenue, COUNT(*) orders FROM orders WHERE status IN ${SOLD} AND created_at>=? AND created_at<? GROUP BY d ORDER BY d`, F, T);
  const weekly = q.all(`SELECT strftime('%Y-W%W', created_at,'localtime') w, SUM(total) revenue, COUNT(*) orders FROM orders WHERE status IN ${SOLD} AND created_at>=? AND created_at<? GROUP BY w ORDER BY w`, F, T);
  const monthly = q.all(`SELECT strftime('%Y-%m', created_at,'localtime') m, SUM(total) revenue, COUNT(*) orders FROM orders WHERE status IN ${SOLD} GROUP BY m ORDER BY m DESC LIMIT 12`).reverse();

  const topProducts = q.all(`SELECT i.product_id, i.name, SUM(i.qty) qty, SUM(i.line_total) revenue FROM order_items i JOIN orders o ON o.id=i.order_id
    WHERE o.status IN ${SOLD} AND o.created_at>=? AND o.created_at<? GROUP BY i.product_id ORDER BY revenue DESC LIMIT 10`, F, T);
  const categories = q.all(`SELECT COALESCE(c.name,'Uncategorised') category, SUM(i.line_total) revenue, SUM(i.qty) qty FROM order_items i JOIN orders o ON o.id=i.order_id
    JOIN products p ON p.id=i.product_id LEFT JOIN categories c ON c.id=p.category_id WHERE o.status IN ${SOLD} AND o.created_at>=? AND o.created_at<? GROUP BY category ORDER BY revenue DESC`, F, T);
  const customers = q.all(`SELECT u.id, u.name, u.rank, COUNT(o.id) orders, SUM(o.total) spent, COUNT(DISTINCT date(o.created_at,'localtime')) visits FROM orders o JOIN users u ON u.id=o.user_id
    WHERE o.status IN ${SOLD} AND o.created_at>=? AND o.created_at<? GROUP BY u.id ORDER BY spent DESC LIMIT 10`, F, T);
  const visitors = [...customers].sort((a, b) => b.visits - a.visits).slice(0, 10);

  const products = q.all(`${PRODUCT_SELECT} WHERE p.active=1`).map(decorate);
  const physicalProducts = products.filter((p) => !p.is_recipe);
  const valuation = {
    cost: round(physicalProducts.reduce((s, p) => s + p.stock_value, 0)),
    retail: round(physicalProducts.reduce((s, p) => s + p.stock_display * p.selling_price, 0)),
    items: products.length,
  };
  const alerts = products.filter((p) => p.stock_status !== 'healthy').sort((a, b) => a.stock_display - b.stock_display);

  const mv = q.all(`SELECT date(at,'localtime') d, type, SUM(ABS(qty)*COALESCE(unit_cost,0)) value FROM stock_movements WHERE at>=? AND at<? GROUP BY d, type ORDER BY d`, F, T);
  // Consumption value at cost (sales have no cost stored; compute from product purchase price)
  const consumption = q.all(`SELECT date(m.at,'localtime') d, SUM(-m.qty * CASE WHEN p.is_peg=1 AND p.size_ml>0 THEN p.purchase_price/p.size_ml ELSE p.purchase_price END) value
    FROM stock_movements m JOIN products p ON p.id=m.product_id WHERE m.type IN ('sale','sale_reversal') AND m.at>=? AND m.at<? GROUP BY d`, F, T);
  const days = [...new Set([...mv.map((m) => m.d), ...consumption.map((c) => c.d)])].sort();
  const purchaseVsConsumption = days.map((d) => ({
    d, purchase: round(mv.filter((m) => m.d === d && ['purchase', 'opening'].includes(m.type)).reduce((s, m) => s + m.value, 0)),
    consumption: round(consumption.find((c) => c.d === d)?.value || 0),
  }));
  const losses = q.get(`SELECT
      COALESCE(SUM(CASE WHEN type='wastage' THEN ABS(qty)*COALESCE(unit_cost,0) END),0) wastage,
      COALESCE(SUM(CASE WHEN type='complimentary' THEN ABS(qty)*COALESCE(unit_cost,0) END),0) complimentary,
      COALESCE(SUM(CASE WHEN type IN ('reconcile','adjustment') AND qty<0 THEN ABS(qty)*COALESCE(unit_cost,0) END),0) shortage,
      COALESCE(SUM(CASE WHEN type IN ('reconcile','adjustment') AND qty>0 THEN qty*COALESCE(unit_cost,0) END),0) excess
    FROM stock_movements WHERE at>=? AND at<?`, F, T);
  const discrepancies = q.all(`SELECT r.*, p.name product FROM reconciliations r JOIN products p ON p.id=r.product_id WHERE r.diff<>0 AND r.at>=? AND r.at<? ORDER BY r.id DESC LIMIT 10`, F, T);
  const tdSoon = new Date(Date.now() + 3 * 86400e3 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const pending = {
    active: q.get("SELECT COUNT(*) n FROM orders WHERE status IN ('placed','accepted','preparing','served')").n,
    disputed: q.get("SELECT COUNT(*) n FROM orders WHERE status='disputed'").n,
    awaiting_approval: q.get("SELECT COUNT(*) n FROM orders WHERE approval_status='pending'").n,
    prebooked: q.get("SELECT COUNT(*) n FROM orders WHERE type='prebooked' AND status IN ('placed','accepted','draft') AND scheduled_at>=?", tIso).n,
    guest_requests: q.get("SELECT COUNT(*) n FROM users WHERE role='guest' AND approval_status='pending'").n,
    td_expiring: q.get("SELECT COUNT(*) n FROM users WHERE category='TD' AND td_end_date IS NOT NULL AND td_end_date<=?", tdSoon).n,
  };

  const gpRows = q.all(`SELECT
      CASE WHEN o.payment_mode IN ('cash','upi') THEN o.payment_mode ELSE 'member_bill' END mode,
      COUNT(*) orders, COALESCE(SUM(o.total),0) revenue
    FROM orders o LEFT JOIN users u ON u.id=o.user_id
    WHERE o.status IN ${SOLD} AND o.created_at>=? AND o.created_at<?
    GROUP BY mode`, F, T);
  const byMode = Object.fromEntries(gpRows.map((x) => [x.mode, { orders: x.orders, revenue: round(x.revenue) }]));
  const guestCash = byMode.cash || { orders: 0, revenue: 0 };
  const guestUpi = byMode.upi || { orders: 0, revenue: 0 };
  const memberBill = byMode.member_bill || { orders: 0, revenue: 0 };
  const guestPayments = {
    cash: guestCash,
    upi: guestUpi,
    total: { orders: guestCash.orders + guestUpi.orders, revenue: round(guestCash.revenue + guestUpi.revenue) },
    memberBill,
  };

  res.json({
    today: sum(tIso, end), week: sum(weekStart, end), month: sum(monthStart, end),
    kpi: { revenue: round(kpi.revenue), orders: kpi.orders, avg: round(kpi.avg), drinks }, statusCounts,
    daily, weekly, monthly, topProducts, categories, customers, visitors, valuation, alerts,
    purchaseVsConsumption, losses: Object.fromEntries(Object.entries(losses).map(([k, v]) => [k, round(v)])), discrepancies, pending, guestPayments,
  });
});

export default r;
