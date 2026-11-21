import { Router } from 'express';
import { q, tx, now, audit } from '../db.js';
import { requireRole, isAdmin } from '../auth.js';
import { broadcast } from '../events.js';
import { SOLD } from './dashboard.js';

const r = Router();
const staff = requireRole('admin', 'bartender');
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function shiftStats(shiftId) {
  const row = q.get(
    `SELECT COUNT(*) total_orders,
            COALESCE(SUM(CASE WHEN status IN ('closed','disputed') THEN 1 ELSE 0 END), 0) billed_orders,
            COALESCE(SUM(CASE WHEN status IN ('draft','placed','accepted','preparing','served') THEN 1 ELSE 0 END), 0) ongoing_orders,
            COALESCE(SUM(CASE WHEN status IN ${SOLD} THEN total ELSE 0 END), 0) total_revenue,
            COALESCE(SUM(CASE WHEN status IN ${SOLD} AND payment_mode='cash' THEN total ELSE 0 END), 0) guest_cash,
            COALESCE(SUM(CASE WHEN status IN ${SOLD} AND payment_mode='upi' THEN total ELSE 0 END), 0) guest_upi,
            COALESCE(SUM(CASE WHEN status IN ('closed','disputed') AND payment_mode IS NULL THEN total ELSE 0 END), 0) member_bill
     FROM orders WHERE shift_id=?`,
    shiftId,
  );
  return {
    total_orders: row?.total_orders || 0,
    billed_orders: row?.billed_orders || 0,
    ongoing_orders: row?.ongoing_orders || 0,
    total_revenue: round2(row?.total_revenue),
    guest_cash: round2(row?.guest_cash),
    guest_upi: round2(row?.guest_upi),
    member_bill: round2(row?.member_bill),
  };
}

export function getActiveShift() {
  const s = q.get("SELECT * FROM shifts WHERE status='open' ORDER BY id DESC LIMIT 1");
  if (!s) return null;
  return { ...s, ...shiftStats(s.id) };
}

r.get('/current', staff, (_req, res) => {
  const current = getActiveShift();
  const recent = q.all('SELECT * FROM shifts ORDER BY id DESC LIMIT 15').map((s) => ({ ...s, ...shiftStats(s.id) }));
  res.json({ current, recent });
});

r.get('/', staff, (req, res) => {
  const where = [], p = [];
  if (req.query.from) { where.push('started_at>=?'); p.push(new Date(`${req.query.from}T00:00:00`).toISOString()); }
  if (req.query.to) { where.push('started_at<?'); p.push(new Date(new Date(`${req.query.to}T00:00:00`).getTime() + 86400e3).toISOString()); }
  const rows = q.all(`SELECT * FROM shifts ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT 200`, ...p);
  res.json(rows.map((s) => ({ ...s, ...shiftStats(s.id) })));
});

r.post('/start', staff, (req, res) => {
  const targetId = isAdmin(req.user) && req.body?.bartender_id ? Number(req.body.bartender_id) : req.user.id;
  const target = q.get('SELECT id, name, rank, role FROM users WHERE id=? AND active=1', targetId);
  if (!target) return res.status(404).json({ error: 'Bartender / staff user not found' });
  const label = `${target.rank ? `${target.rank} ` : ''}${target.name}`;
  const note = req.body?.note ? String(req.body.note).trim() : null;
  const handover = req.body?.handover === true;

  const created = tx(() => {
    const open = q.get("SELECT * FROM shifts WHERE status='open' ORDER BY id DESC LIMIT 1");
    if (open) {
      if (open.bartender_id === target.id && !handover) {
        return { shift: { ...open, ...shiftStats(open.id) }, already_open: true };
      }
      if (!handover) {
        throw Object.assign(
          new Error(`Shift #${open.id} (${open.bartender_name}) is still active. End it or choose Shift Handover to start your shift.`),
          { status: 409 },
        );
      }
      const t = now();
      q.run(
        "UPDATE shifts SET status='closed', ended_at=?, ended_by=?, closing_note=COALESCE(closing_note, ?) WHERE id=?",
        t, req.user.id, `Handover to ${label}`, open.id,
      );
      audit(req.user.id, 'shift.handover_close', 'shift', open.id, { next_bartender: label });
    }
    const t = now();
    const id = Number(
      q.run(
        "INSERT INTO shifts(bartender_id, bartender_name, started_at, status, opening_note, started_by) VALUES(?,?,?,'open',?,?)",
        target.id, label, t, note, req.user.id,
      ).lastInsertRowid,
    );
    audit(req.user.id, 'shift.start', 'shift', id, { bartender_id: target.id, bartender_name: label, note });
    return { shift: { ...q.get('SELECT * FROM shifts WHERE id=?', id), ...shiftStats(id) }, already_open: false };
  });

  broadcast('shift', { action: 'started', shift_id: created.shift.id, bartender_name: created.shift.bartender_name });
  res.status(created.already_open ? 200 : 201).json(created.shift);
});

r.post('/end', staff, (req, res) => {
  const note = req.body?.note ? String(req.body.note).trim() : null;
  const closed = tx(() => {
    const open = q.get("SELECT * FROM shifts WHERE status='open' ORDER BY id DESC LIMIT 1");
    if (!open) throw Object.assign(new Error('No active shift is currently open'), { status: 404 });
    const t = now();
    q.run(
      "UPDATE shifts SET status='closed', ended_at=?, ended_by=?, closing_note=? WHERE id=?",
      t, req.user.id, note, open.id,
    );
    const stats = shiftStats(open.id);
    audit(req.user.id, 'shift.end', 'shift', open.id, { bartender_name: open.bartender_name, ...stats, note });
    return { ...q.get('SELECT * FROM shifts WHERE id=?', open.id), ...stats };
  });

  broadcast('shift', { action: 'ended', shift_id: closed.id });
  res.json(closed);
});

export default r;
