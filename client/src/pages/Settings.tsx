import { useEffect, useState } from 'react';
import { api, download } from '../lib/api';
import { useApp } from '../lib/app';
import { Button, Card, Field, Input, Select, fmtDate } from '../components/ui';

export default function Settings() {
  const { reloadSettings, toast } = useApp();
  const [s, setS] = useState<any>(null);
  const [backups, setBackups] = useState<any[]>([]);
  const [audit, setAudit] = useState<any[]>([]);
  const [tab, setTab] = useState<'general' | 'backup' | 'audit'>('general');

  const load = () => {
    api('/admin/settings', { cache: false }).then(setS);
    api('/admin/backups', { cache: false }).then(setBackups);
    api('/admin/audit?limit=200', { cache: false }).then(setAudit);
  };
  useEffect(load, []);
  if (!s) return <div className="p-6">Loading…</div>;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    await api('/admin/settings', { method: 'PUT', body: s });
    await reloadSettings();
    toast('Settings saved');
  };

  const uploadImg = async (kind: 'logo' | 'background', file?: File) => {
    const fd = new FormData(); if (file) fd.append('image', file);
    const u = await api(`/admin/settings/image/${kind}`, { method: 'POST', body: fd });
    setS(u); reloadSettings(); toast('Updated');
  };

  const restoreFile = async (file?: File) => {
    if (!file || !confirm('Restore this backup? Current database will be backed up first and then replaced.')) return;
    const fd = new FormData(); fd.append('file', file);
    try { await api('/admin/restore', { method: 'POST', body: fd }); toast('Database restored'); reloadSettings(); load(); } catch (e: any) { toast(e.message, 'error'); }
  };

  return (
    <div className="space-y-4 p-4">
      <div className="flex gap-2">
        {(['general', 'backup', 'audit'] as const).map((t) => <Button key={t} variant={tab === t ? 'primary' : 'subtle'} onClick={() => setTab(t)}>{t === 'general' ? 'Settings & Customisation' : t === 'backup' ? 'Database Backup & Restore' : 'Security Audit Log'}</Button>)}
      </div>

      {tab === 'general' && (
        <form onSubmit={save} className="space-y-4">
          <Card title="Bar Information & Branding">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Bar / Business name"><Input value={s.bar_name} onChange={(e) => setS({ ...s, bar_name: e.target.value })} /></Field>
              <Field label="Phone"><Input value={s.bar_phone} onChange={(e) => setS({ ...s, bar_phone: e.target.value })} /></Field>
              <Field label="Currency symbol"><Input value={s.currency} onChange={(e) => setS({ ...s, currency: e.target.value })} /></Field>
              <div className="sm:col-span-3"><Field label="Address"><Input value={s.bar_address} onChange={(e) => setS({ ...s, bar_address: e.target.value })} /></Field></div>
              <Field label="Logo image">
                <div className="flex items-center gap-2">
                  {s.logo && <img src={s.logo} className="h-10 w-10 rounded object-cover" alt="" />}
                  <Input type="file" accept="image/*" onChange={(e) => uploadImg('logo', e.target.files?.[0])} />
                  {s.logo && <Button type="button" size="sm" variant="ghost" onClick={() => uploadImg('logo')}>Clear</Button>}
                </div>
              </Field>
              <Field label="Background image">
                <div className="flex items-center gap-2">
                  <Input type="file" accept="image/*" onChange={(e) => uploadImg('background', e.target.files?.[0])} />
                  {s.background && <Button type="button" size="sm" variant="ghost" onClick={() => uploadImg('background')}>Clear</Button>}
                </div>
              </Field>
              <Field label="Default theme & accent">
                <div className="flex gap-2">
                  <Select value={s.theme} onChange={(e) => setS({ ...s, theme: e.target.value })}><option value="dark">Dark</option><option value="light">Light</option></Select>
                  <input type="color" value={s.accent} onChange={(e) => setS({ ...s, accent: e.target.value })} className="h-11 w-14 rounded-xl border" />
                </div>
              </Field>
            </div>
          </Card>

          <Card title="POS, Inventory, Approval & Report Preferences">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Standard peg sizes" hint="Fixed: Small (30 ml) & Large (60 ml). Full bottle (750 ml) is restricted to Bartender & Admin."><Input value="30, 60 (Small / Large)" disabled /></Field>
              <Field label="Inventory deduction stage">
                <Select value={s.deduct_on} onChange={(e) => setS({ ...s, deduct_on: e.target.value })}><option value="served">When order is Served</option><option value="accepted">When order is Accepted</option></Select>
              </Field>
              <Field label="Allow orders when stock reaches 0">
                <Select value={s.allow_negative_stock} onChange={(e) => setS({ ...s, allow_negative_stock: e.target.value })}><option value="0">No (strict)</option><option value="1">Yes</option></Select>
              </Field>
              <Field label="Customer order approval window (hours)"><Input type="number" value={s.approval_hours} onChange={(e) => setS({ ...s, approval_hours: e.target.value })} /></Field>
              <Field label="Automatic local backup interval (hours)"><Input type="number" value={s.auto_backup_hours} onChange={(e) => setS({ ...s, auto_backup_hours: e.target.value })} /></Field>
              <Field label="Backups to retain on disk"><Input type="number" value={s.backup_keep} onChange={(e) => setS({ ...s, backup_keep: e.target.value })} /></Field>
              <div className="sm:col-span-3"><Field label="Report footer text"><Input value={s.report_footer} onChange={(e) => setS({ ...s, report_footer: e.target.value })} /></Field></div>
            </div>
            <div className="mt-4 flex justify-end"><Button size="lg">Save All Settings</Button></div>
          </Card>
        </form>
      )}

      {tab === 'backup' && (
        <Card title="JSON Database Backup & Restoration" actions={
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => download('/admin/backup', `bartill-backup-${new Date().toISOString().slice(0, 10)}.json`)}>⬇ Download Full Backup (with images)</Button>
            <Button variant="subtle" onClick={async () => { await api('/admin/backups', { method: 'POST' }); toast('Snapshot created on server'); load(); }}>+ Create Local Snapshot</Button>
            <label className="cursor-pointer rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-gray-900">
              ⬆ Restore from JSON File
              <input type="file" accept=".json" className="hidden" onChange={(e) => restoreFile(e.target.files?.[0])} />
            </label>
          </div>
        }>
          <p className="mb-3 text-xs text-gray-500">Backups contain every table and uploaded image in a single portable JSON file. Before any restore, an automatic <code>pre-restore</code> snapshot is saved in <code>server/data/backups/</code>.</p>
          <table className="w-full text-sm">
            <thead className="text-left text-gray-500"><tr><th className="p-2">Snapshot on server disk</th><th>Created</th><th>Size</th><th /></tr></thead>
            <tbody>
              {backups.map((b) => (
                <tr key={b.name} className="border-t dark:border-gray-700">
                  <td className="p-2 font-mono text-xs">{b.name}</td><td>{fmtDate(b.at)}</td><td>{Math.round(b.size / 1024)} KB</td>
                  <td className="space-x-2 text-right">
                    <Button size="sm" variant="subtle" onClick={() => download(`/admin/backups/${b.name}`, b.name)}>Download</Button>
                    <Button size="sm" variant="ghost" onClick={async () => { if (confirm(`Restore ${b.name}?`)) { await api(`/admin/backups/${b.name}/restore`, { method: 'POST' }); toast('Restored'); load(); } }}>Restore</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {tab === 'audit' && (
        <Card title="Audit Trail (sensitive operations)">
          <div className="max-h-[70vh] overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-gray-500"><tr><th className="p-2">Time</th><th>User</th><th>Action</th><th>Entity</th><th>Details</th></tr></thead>
              <tbody>
                {audit.map((a) => (
                  <tr key={a.id} className="border-t dark:border-gray-700">
                    <td className="p-2 whitespace-nowrap">{fmtDate(a.at)}</td><td>{a.user_name || '—'}</td><td className="font-mono text-xs">{a.action}</td>
                    <td>{a.entity} {a.entity_id || ''}</td><td className="max-w-md truncate font-mono text-xs text-gray-500">{a.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
