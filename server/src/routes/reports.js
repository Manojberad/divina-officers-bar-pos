import { Router } from 'express';
import * as XLSX from 'xlsx';
import PDFDocument from 'pdfkit';
import { q, getSettings } from '../db.js';
import { requireRole } from '../auth.js';
import { SOLD, range } from './dashboard.js';
import { PRODUCT_SELECT, decorate, displayQty } from '../services.js';

const r = Router();
const round = (n, d = 2) => Math.round((n || 0) * 10 ** d) / 10 ** d;
const toDisp = (p, base) => (p.is_peg && p.size_ml ? round(base / p.size_ml, 3) : round(base, 3));
const local = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { hour12: false }) : '');

const C = (key, label, type) => ({ key, label, type });

const salesGrouped = (fmt, label) => (F, T) => ({
  columns: [C('period', label), C('orders', 'Orders', 'int'), C('items', 'Items', 'num'), C('revenue', 'Revenue', 'money'), C('avg', 'Avg Order', 'money')],
  rows: q.all(`SELECT strftime('${fmt}', o.created_at,'localtime') period, COUNT(DISTINCT o.id) orders, SUM(o.total) revenue,
      (SELECT SUM(qty) FROM order_items i JOIN orders o2 ON o2.id=i.order_id WHERE o2.status IN ${SOLD} AND o2.created_at>=? AND o2.created_at<? AND strftime('${fmt}', o2.created_at,'localtime')=strftime('${fmt}', o.created_at,'localtime')) items
    FROM orders o WHERE o.status IN ${SOLD} AND o.created_at>=? AND o.created_at<? GROUP BY period ORDER BY period`, F, T, F, T)
    .map((x) => ({ ...x, revenue: round(x.revenue), avg: round(x.revenue / x.orders) })),
  sum: ['orders', 'items', 'revenue'],
});

export const REPORTS = {
  daily: { title: 'Daily Sales Report', build: salesGrouped('%Y-%m-%d', 'Date') },
  weekly: { title: 'Weekly Sales Report', build: salesGrouped('%Y-W%W', 'Week') },
  monthly: { title: 'Monthly Sales Report', build: salesGrouped('%Y-%m', 'Month') },
  customer: {
    title: 'Customer-wise Consumption',
    build: (F, T) => ({
      columns: [C('name', 'Customer'), C('service_no', 'Service No'), C('rank', 'Rank'), C('category', 'Type'), C('orders', 'Orders', 'int'), C('items', 'Drinks', 'num'), C('visits', 'Visits', 'int'), C('spent', 'Value', 'money')],
      rows: q.all(`SELECT u.id _id, u.name, u.service_no, u.rank, u.category, COUNT(DISTINCT o.id) orders, COUNT(DISTINCT date(o.created_at,'localtime')) visits,
          (SELECT SUM(i.qty) FROM order_items i JOIN orders o2 ON o2.id=i.order_id WHERE o2.user_id=u.id AND o2.status IN ${SOLD} AND o2.created_at>=? AND o2.created_at<?) items,
          SUM(o.total) spent FROM orders o JOIN users u ON u.id=o.user_id WHERE o.status IN ${SOLD} AND o.created_at>=? AND o.created_at<? GROUP BY u.id ORDER BY spent DESC`, F, T, F, T)
        .map((x) => ({ ...x, spent: round(x.spent) })),
      sum: ['orders', 'items', 'spent'],
    }),
  },
  product: {
    title: 'Product-wise Sales',
    build: (F, T) => ({
      columns: [C('name', 'Product'), C('category', 'Category'), C('serve', 'Serve'), C('qty', 'Qty', 'num'), C('volume', 'Volume (ml)', 'num'), C('revenue', 'Revenue', 'money')],
      rows: q.all(`SELECT i.product_id _id, i.name, c.name category,
          CASE WHEN i.serve_type='peg' AND i.peg_ml=30 THEN 'Small (30 ml)'
               WHEN i.serve_type='peg' AND i.peg_ml=60 THEN 'Large (60 ml)'
               WHEN i.serve_type='peg' THEN 'Peg ' || CAST(i.peg_ml AS INT) || 'ml'
               WHEN i.serve_type='bottle' THEN 'Full Bottle'
               ELSE i.serve_type END serve,
          SUM(i.qty) qty, SUM(CASE WHEN p.is_peg=1 THEN i.base_qty ELSE 0 END) volume, SUM(i.line_total) revenue
        FROM order_items i JOIN orders o ON o.id=i.order_id JOIN products p ON p.id=i.product_id LEFT JOIN categories c ON c.id=p.category_id
        WHERE o.status IN ${SOLD} AND o.created_at>=? AND o.created_at<? GROUP BY i.product_id, serve ORDER BY revenue DESC`, F, T).map((x) => ({ ...x, revenue: round(x.revenue) })),
      sum: ['qty', 'revenue'],
    }),
  },
  inventory: {
    title: 'Inventory Report (Opening / Closing Stock)',
    build: (F, T) => {
      const prods = q.all(`${PRODUCT_SELECT} WHERE p.is_recipe=0 ORDER BY c.sort, p.name`);
      const mv = (pid, from, to) => q.all('SELECT type, SUM(qty) qty FROM stock_movements WHERE product_id=? AND at>=? AND (? IS NULL OR at<?) GROUP BY type', pid, from, to, to);
      return {
        columns: [C('name', 'Product'), C('category', 'Category'), C('unit', 'Unit'), C('opening', 'Opening', 'num'), C('purchased', 'Purchased', 'num'), C('sold', 'Sold', 'num'),
          C('wastage', 'Wastage+Comp', 'num'), C('adjust', 'Adj/Recon', 'num'), C('closing', 'Closing', 'num'), C('current', 'Current', 'num'), C('status', 'Status'), C('value', 'Value @Cost', 'money')],
        rows: prods.map((p) => {
          const inR = Object.fromEntries(mv(p.id, F, T).map((m) => [m.type, m.qty]));
          const after = mv(p.id, T, null).reduce((s, m) => s + m.qty, 0);
          const inSum = Object.values(inR).reduce((s, v) => s + v, 0);
          const closing = p.stock - after, opening = closing - inSum;
          const d = decorate(p);
          return {
            _id: p.id, name: p.name, category: p.category, unit: d.stock_unit, opening: toDisp(p, opening), purchased: toDisp(p, (inR.purchase || 0) + (inR.opening || 0)),
            sold: toDisp(p, -((inR.sale || 0) + (inR.sale_reversal || 0))), wastage: toDisp(p, -((inR.wastage || 0) + (inR.complimentary || 0))),
            adjust: toDisp(p, (inR.adjustment || 0) + (inR.reconcile || 0) + (inR.removal || 0)), closing: toDisp(p, closing), current: d.stock_display,
            status: d.stock_status.toUpperCase(), value: d.stock_value,
          };
        }),
        sum: ['value'],
      };
    },
  },
  purchases: {
    title: 'Purchase Register',
    build: (F, T) => ({
      columns: [C('at', 'Date'), C('product', 'Product'), C('qty', 'Qty', 'num'), C('unit', 'Unit'), C('unit_cost', 'Unit Cost', 'money'), C('value', 'Value', 'money'), C('supplier', 'Supplier'), C('invoice', 'Invoice'), C('user', 'By')],
      rows: movements(F, T, ['purchase', 'opening']),
      sum: ['value'],
    }),
  },
  wastage: {
    title: 'Wastage & Complimentary Register',
    build: (F, T) => ({
      columns: [C('at', 'Date'), C('type', 'Type'), C('product', 'Product'), C('qty', 'Qty', 'num'), C('unit', 'Unit'), C('ml', 'ml', 'num'), C('value', 'Value @Cost', 'money'), C('note', 'Reason'), C('user', 'By')],
      rows: movements(F, T, ['wastage', 'complimentary']),
      sum: ['value'],
    }),
  },
  reconciliation: {
    title: 'Stock Reconciliation Report',
    build: (F, T) => ({
      columns: [C('at', 'Date'), C('product', 'Product'), C('system_qty', 'System', 'num'), C('physical_qty', 'Physical', 'num'), C('diff', 'Difference', 'num'), C('value', 'Value', 'money'), C('note', 'Note'), C('user', 'By')],
      rows: q.all(`SELECT r.id _id, r.at, p.name product, r.system_qty, r.physical_qty, r.diff, r.diff*p.purchase_price value, r.note, u.name user FROM reconciliations r
          JOIN products p ON p.id=r.product_id LEFT JOIN users u ON u.id=r.user_id WHERE r.at>=? AND r.at<? ORDER BY r.id`, F, T)
        .map((x) => ({ ...x, at: local(x.at), system_qty: round(x.system_qty, 3), physical_qty: round(x.physical_qty, 3), value: round(x.value) })),
      sum: ['value'],
    }),
  },
  transactions: {
    title: 'Complete Transaction History',
    build: (F, T) => ({
      columns: [C('order_no', 'Order'), C('created', 'Date'), C('customer', 'Customer'), C('role', 'Role'), C('table', 'Table'), C('items', 'Items'), C('status', 'Status'), C('payment', 'Payment'), C('approval', 'Approval'), C('total', 'Total', 'money'), C('by', 'Created By')],
      rows: q.all(`SELECT o.id _id, o.order_no, o.created_at, u.name customer, u.role customer_role, t.name tbl, o.type, o.status, o.payment_mode, o.payment_ref, o.approval_status, o.total, cb.name by_name,
          (SELECT GROUP_CONCAT(i.qty || ' x ' || i.name || CASE WHEN i.serve_type='peg' AND i.peg_ml=30 THEN ' (Small 30ml)' WHEN i.serve_type='peg' AND i.peg_ml=60 THEN ' (Large 60ml)' WHEN i.serve_type='peg' THEN ' (' || CAST(i.peg_ml AS INT) || 'ml)' ELSE '' END, '; ') FROM order_items i WHERE i.order_id=o.id) items
          FROM orders o LEFT JOIN users u ON u.id=o.user_id LEFT JOIN tables t ON t.id=o.table_id LEFT JOIN users cb ON cb.id=o.created_by
          WHERE o.created_at>=? AND o.created_at<? ORDER BY o.id`, F, T)
        .map((x) => ({
          _id: x._id, order_no: x.order_no, created: local(x.created_at), customer: x.customer || 'Walk-in', role: x.customer_role || 'walk-in', table: x.tbl || '',
          items: x.items, status: x.status, payment: x.payment_mode ? `${x.payment_mode.toUpperCase()}${x.payment_ref ? ` (${x.payment_ref})` : ''}` : 'Member Bill',
          approval: x.approval_status, total: x.status === 'cancelled' ? 0 : x.total, by: x.by_name,
        })),
      sum: ['total'],
    }),
  },
  guest_payments: {
    title: 'Guest Payment Register (Cash & UPI)',
    build: (F, T) => ({
      columns: [C('order_no', 'Order'), C('closed', 'Checkout Date'), C('guest', 'Guest Name'), C('rank', 'Rank'), C('service_no', 'Service No'), C('table', 'Table'), C('items', 'Items'), C('payment_mode', 'Payment Mode'), C('payment_ref', 'Ref / Note'), C('cash_amt', 'Cash', 'money'), C('upi_amt', 'UPI', 'money'), C('total', 'Total', 'money')],
      rows: q.all(`SELECT o.id _id, o.order_no, COALESCE(o.closed_at, o.created_at) closed, u.name guest, u.rank, u.service_no, t.name tbl, o.payment_mode, o.payment_ref, o.total,
          (SELECT GROUP_CONCAT(i.qty || ' x ' || i.name || CASE WHEN i.serve_type='peg' AND i.peg_ml=30 THEN ' (Small 30ml)' WHEN i.serve_type='peg' AND i.peg_ml=60 THEN ' (Large 60ml)' ELSE '' END, '; ') FROM order_items i WHERE i.order_id=o.id) items
          FROM orders o LEFT JOIN users u ON u.id=o.user_id LEFT JOIN tables t ON t.id=o.table_id
          WHERE (u.role='guest' OR o.payment_mode IN ('cash','upi')) AND o.status IN ${SOLD} AND o.created_at>=? AND o.created_at<? ORDER BY o.id`, F, T)
        .map((x) => ({
          _id: x._id, order_no: x.order_no, closed: local(x.closed), guest: x.guest || 'Walk-in Guest', rank: x.rank || '', service_no: x.service_no || '',
          table: x.tbl || '', items: x.items, payment_mode: x.payment_mode ? x.payment_mode.toUpperCase() : 'UNRECORDED', payment_ref: x.payment_ref || '',
          cash_amt: x.payment_mode === 'cash' ? round(x.total) : 0, upi_amt: x.payment_mode === 'upi' ? round(x.total) : 0, total: round(x.total),
        })),
      sum: ['cash_amt', 'upi_amt', 'total'],
    }),
  },
  recipe_consumption: {
    title: 'Recipe & Ingredient Consumption',
    build: (F, T) => ({
      columns: [
        C('order_no', 'Order ID'),
        C('at', 'Date'),
        C('product_name', 'Mocktail / Product'),
        C('qty_sold', 'Qty Sold', 'num'),
        C('ingredient_name', 'Ingredient'),
        C('qty_consumed', 'Consumed', 'num'),
        C('unit', 'Unit'),
        C('base_deducted', 'Stock Deducted'),
        C('ingredient_cost', 'Ingredient Cost', 'money'),
        C('total_recipe_cost', 'Total Recipe Cost', 'money'),
      ],
      rows: q.all(
        `SELECT rc.id _id, o.order_no, rc.at, rc.product_name, rc.qty_sold, rc.ingredient_name,
                rc.qty_consumed, rc.unit, rc.base_qty_consumed, ing.unit ing_unit, ing.is_peg ing_is_peg,
                rc.ingredient_cost, rc.total_recipe_cost
         FROM recipe_consumptions rc
         JOIN orders o ON o.id = rc.order_id
         JOIN products ing ON ing.id = rc.ingredient_id
         WHERE rc.reversed = 0 AND o.status IN ${SOLD} AND rc.at >= ? AND rc.at < ?
         ORDER BY rc.id`,
        F, T,
      ).map((x) => ({
        _id: x._id,
        order_no: x.order_no,
        at: local(x.at),
        product_name: x.product_name,
        qty_sold: round(x.qty_sold, 2),
        ingredient_name: x.ingredient_name,
        qty_consumed: round(x.qty_consumed, 2),
        unit: x.unit,
        base_deducted: `${round(x.base_qty_consumed, 2)} ${x.ing_is_peg ? 'ml' : (x.ing_unit || 'unit')}`,
        ingredient_cost: round(x.ingredient_cost),
        total_recipe_cost: round(x.total_recipe_cost),
      })),
      sum: ['ingredient_cost'],
    }),
  },
};

function movements(F, T, types) {
  return q.all(`SELECT m.id _id, m.at, m.type, p.name product, p.is_peg, p.size_ml, p.unit, m.qty, m.unit_cost, m.supplier, m.invoice, m.note, u.name user
      FROM stock_movements m JOIN products p ON p.id=m.product_id LEFT JOIN users u ON u.id=m.user_id
      WHERE m.type IN (${types.map(() => '?').join(',')}) AND m.at>=? AND m.at<? ORDER BY m.id`, ...types, F, T)
    .map((m) => ({
      _id: m._id, at: local(m.at), type: m.type, product: m.product, qty: toDisp(m, Math.abs(m.qty)), unit: m.is_peg ? 'bottles' : m.unit, ml: m.is_peg ? Math.abs(m.qty) : '',
      unit_cost: round(m.is_peg ? (m.unit_cost || 0) * m.size_ml : m.unit_cost), value: round(Math.abs(m.qty) * (m.unit_cost || 0)), supplier: m.supplier, invoice: m.invoice, note: m.note, user: m.user,
    }));
}

export function buildReport(type, from, to, ids) {
  const def = REPORTS[type];
  if (!def) return null;
  const [F, T] = range(from, to);
  const data = def.build(F, T);
  if (ids?.length) data.rows = data.rows.filter((x) => ids.includes(String(x._id)));
  const totals = {};
  (data.sum || []).forEach((k) => { totals[k] = round(data.rows.reduce((s, x) => s + (Number(x[k]) || 0), 0)); });
  return { type, title: def.title, from: F, to: T, columns: data.columns, rows: data.rows, totals };
}

r.get('/types', requireRole('admin'), (_req, res) => res.json(Object.entries(REPORTS).map(([k, v]) => ({ key: k, title: v.title }))));

r.get('/:type', requireRole('admin'), (req, res) => {
  const ids = req.query.ids ? String(req.query.ids).split(',') : null;
  const rep = buildReport(req.params.type, req.query.from, req.query.to, ids);
  if (!rep) return res.status(404).json({ error: 'Unknown report' });
  const fmt = req.query.format;
  const s = getSettings();
  const fname = `${req.params.type}-${new Date().toISOString().slice(0, 10)}`;
  const period = `${new Date(rep.from).toLocaleDateString('en-GB')} – ${new Date(new Date(rep.to).getTime() - 1).toLocaleDateString('en-GB')}`;
  if (fmt === 'xlsx') {
    const aoa = [[s.bar_name], [rep.title], [`Period: ${period}`], [], rep.columns.map((c) => c.label),
      ...rep.rows.map((x) => rep.columns.map((c) => x[c.key] ?? '')),
      rep.columns.map((c, i) => (i === 0 ? 'TOTAL' : rep.totals[c.key] ?? ''))];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = rep.columns.map((c) => ({ wch: Math.max(10, c.label.length + 4, c.key === 'items' ? 50 : 0) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, rep.title.slice(0, 30).replace(/[/\\?*[\]:]/g, ''));
    res.setHeader('Content-Disposition', `attachment; filename="${fname}.xlsx"`);
    return res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  }
  if (fmt === 'pdf') {
    res.setHeader('Content-Disposition', `attachment; filename="${fname}.pdf"`);
    res.type('application/pdf');
    return renderPdf(rep, s, period).pipe(res);
  }
  res.json(rep);
});

function renderPdf(rep, s, period) {
  const doc = new PDFDocument({ size: 'A4', layout: rep.columns.length > 6 ? 'landscape' : 'portrait', margin: 32 });
  const W = doc.page.width - 64;
  const weights = rep.columns.map((c) => (c.key === 'items' ? 4 : c.type ? 1 : ['name', 'product', 'customer', 'note'].includes(c.key) ? 2 : 1.2));
  const tw = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map((w) => (w / tw) * W);
  const cur = s.currency === '₹' ? 'INR' : s.currency;
  const fmt = (c, v) => (v == null ? '' : c.type === 'money' ? Number(v).toFixed(2) : c.type === 'num' ? String(round(v, 3)) : String(v));

  const header = () => {
    doc.font('Helvetica-Bold').fontSize(14).text(s.bar_name, { align: 'left' });
    doc.fontSize(11).text(rep.title);
    doc.font('Helvetica').fontSize(8).fillColor('#555').text(`Period: ${period}   ·   Amounts in ${cur}   ·   Generated ${new Date().toLocaleString('en-GB')}`);
    doc.fillColor('#000').moveDown(0.5);
    row(rep.columns.map((c) => c.label), true);
  };
  const row = (cells, bold, fill) => {
    const h = Math.max(...cells.map((t, i) => doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(7.5).heightOfString(String(t), { width: widths[i] - 4 }))) + 6;
    if (doc.y + h > doc.page.height - 40) { doc.addPage(); header(); }
    const y = doc.y;
    if (bold || fill) doc.rect(32, y, W, h).fill(bold ? '#e5e7eb' : fill).fillColor('#000');
    let x = 32;
    cells.forEach((t, i) => {
      const c = rep.columns[i];
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(7.5).text(String(t), x + 2, y + 3, { width: widths[i] - 4, align: c.type && !bold ? 'right' : 'left' });
      x += widths[i];
    });
    doc.y = y + h; doc.x = 32;
  };
  header();
  rep.rows.forEach((x, i) => row(rep.columns.map((c) => fmt(c, x[c.key])), false, i % 2 ? '#f9fafb' : null));
  if (Object.keys(rep.totals).length) row(rep.columns.map((c, i) => (i === 0 ? 'TOTAL' : rep.totals[c.key] != null ? fmt(c, rep.totals[c.key]) : '')), true);
  doc.moveDown().font('Helvetica').fontSize(7).fillColor('#777').text(`${rep.rows.length} record(s). ${s.report_footer || ''}`, 32);
  doc.end();
  return doc;
}

export default r;
