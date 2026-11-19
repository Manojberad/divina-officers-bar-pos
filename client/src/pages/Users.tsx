import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useApp } from '../lib/app';
import { Badge, Button, Card, Field, Input, Modal, Select } from '../components/ui';

const BLANK = { name: '', service_no: '', rank: '', mobile: '', email: '', category: 'POSTED', role: 'member', pin: '', alcohol_limit: '', active: 1 };

const CAT_LABEL: Record<string, string> = {
  POSTED: 'Posted-In Officer',
  TD: 'TD Officer',
  STAFF: 'Mess Staff',
  GUEST: 'Guest',
};

const CAT_BADGE: Record<string, string> = {
  POSTED: 'accepted',
  TD: 'preparing',
  STAFF: 'placed',
  GUEST: 'pending',
};

export default function Users() {
  const { toast, settings, reloadSettings } = useApp();
  const [users, setUsers] = useState<any[]>([]);
  const [ed, setEd] = useState<any>(null);
  const [pinModal, setPinModal] = useState<any>(null);
  const [newPin, setNewPin] = useState('');
  const [guestLimitVal, setGuestLimitVal] = useState(settings.guest_alcohol_limit ?? '3');
  const [memberLimitVal, setMemberLimitVal] = useState(settings.member_alcohol_limit ?? '0');

  useEffect(() => {
    setGuestLimitVal(settings.guest_alcohol_limit ?? '3');
    setMemberLimitVal(settings.member_alcohol_limit ?? '0');
  }, [settings.guest_alcohol_limit, settings.member_alcohol_limit]);

  const saveQuickLimits = async () => {
    try {
      await api('/admin/settings', { method: 'PUT', body: { guest_alcohol_limit: guestLimitVal, member_alcohol_limit: memberLimitVal } });
      await reloadSettings();
      toast('Alcohol order limits updated');
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const load = () => api('/users', { cache: false }).then(setUsers);
  useEffect(() => { load(); }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      ...ed,
      category: ed.role === 'bartender' ? 'STAFF' : ed.role === 'guest' ? 'GUEST' : ed.category,
    };
    try {
      await api(ed.id ? `/users/${ed.id}` : '/users', { method: ed.id ? 'PUT' : 'POST', body: payload });
      toast('User saved');
      setEd(null);
      load();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const approveGuest = async (u: any, action: 'approve' | 'reject') => {
    try {
      await api(`/users/${u.id}/approve-guest`, { method: 'POST', body: { action } });
      toast(action === 'approve' ? `Approved guest ${u.name}` : `Declined guest ${u.name}`);
      load();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const importXlsx = async (file?: File) => {
    if (!file) return;
    const fd = new FormData(); fd.append('file', file);
    try {
      const r = await api('/users/import', { method: 'POST', body: fd });
      toast(`Imported ${r.created} user(s)${r.skipped.length ? ` (${r.skipped.length} skipped)` : ''}`);
      load();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const resetPin = async () => {
    try { const r = await api(`/users/${pinModal.id}/reset-pin`, { method: 'POST', body: { pin: newPin || undefined } }); toast(r.message); setPinModal(null); setNewPin(''); } catch (e: any) { toast(e.message, 'error'); }
  };

  const onRoleChange = (role: string) => {
    if (role === 'bartender') {
      setEd({ ...ed, role, category: 'STAFF', rank: ed.rank || 'Mess Staff' });
    } else if (role === 'guest') {
      setEd({ ...ed, role, category: 'GUEST' });
    } else if (['STAFF', 'GUEST'].includes(ed.category)) {
      setEd({ ...ed, role, category: 'POSTED' });
    } else {
      setEd({ ...ed, role });
    }
  };

  const onCategoryChange = (category: string) => {
    if (category === 'STAFF') {
      setEd({ ...ed, category: 'STAFF', role: 'bartender', rank: ed.rank || 'Mess Staff' });
    } else if (category === 'GUEST') {
      setEd({ ...ed, category: 'GUEST', role: 'guest' });
    } else if (['bartender', 'guest'].includes(ed.role)) {
      setEd({ ...ed, category, role: category === 'TD' ? 'customer' : 'member' });
    } else {
      setEd({ ...ed, category });
    }
  };

  const pendingGuests = users.filter((u) => u.role === 'guest' && u.approval_status === 'pending');
  const memberCount = users.filter((u) => u.role !== 'guest').length;

  return (
    <div className="space-y-4 p-4">
      {/* Admin Alcohol Order Limit Controls (Guest & Member) */}
      <Card title="🥃 Alcohol Order Limits (Small 30ml / Large 60ml)">
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-[210px] flex-1">
            <Field label="Guest Alcohol Limit (pegs)" hint="Default max Small/Large pegs per Guest">
              <div className="flex gap-1.5">
                <Input type="number" min={0} max={20} value={guestLimitVal} onChange={(e) => setGuestLimitVal(e.target.value)} />
                {['3', '4', '0'].map((v) => (
                  <Button key={v} type="button" size="sm" variant={String(guestLimitVal) === v ? 'primary' : 'subtle'} onClick={() => setGuestLimitVal(v)}>
                    {v === '0' ? '∞' : `${v}`}
                  </Button>
                ))}
              </div>
            </Field>
          </div>
          <div className="min-w-[210px] flex-1">
            <Field label="Member Alcohol Limit (pegs)" hint="Default max Small/Large pegs per Member (0 = unlimited)">
              <div className="flex gap-1.5">
                <Input type="number" min={0} max={20} value={memberLimitVal} onChange={(e) => setMemberLimitVal(e.target.value)} />
                {['0', '3', '4'].map((v) => (
                  <Button key={v} type="button" size="sm" variant={String(memberLimitVal) === v ? 'primary' : 'subtle'} onClick={() => setMemberLimitVal(v)}>
                    {v === '0' ? '∞' : `${v}`}
                  </Button>
                ))}
              </div>
            </Field>
          </div>
          <Button onClick={saveQuickLimits}>Save Limits</Button>
        </div>
      </Card>

      {pendingGuests.length > 0 && (
        <Card title={`🪪 Pending Guest Registrations (${pendingGuests.length})`} className="!border-[#FBBF24]">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {pendingGuests.map((g) => (
              <div key={g.id} className="flex items-center justify-between gap-2 rounded-2xl bg-[#F4F7FE] p-3 dark:bg-[#252D3D]">
                <div>
                  <div className="font-bold">{g.rank} {g.name}</div>
                  <div className="text-xs text-[#94A3B8]">Service No: <b>{g.service_no}</b></div>
                </div>
                <div className="flex gap-1.5">
                  <Button size="sm" variant="success" onClick={() => approveGuest(g, 'approve')}>✔ Approve</Button>
                  <Button size="sm" variant="danger" onClick={() => approveGuest(g, 'reject')}>✕</Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
      <Card
        title={`Registered Users (${memberCount} / 50 Officers & Staff · ${users.length - memberCount} Guests)`}
        actions={
          <div className="flex flex-wrap gap-2">
            <label className="cursor-pointer rounded-2xl bg-[#F4F7FE] px-3.5 py-2.5 text-sm font-bold text-[#1B2559] hover:bg-[#E9EDF7] dark:bg-[#252D3D] dark:text-[#E6EDF3]">
              📥 Import Excel (Posted-In)
              <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => importXlsx(e.target.files?.[0])} />
            </label>
            <Button variant="subtle" onClick={() => setEd({ ...BLANK, category: 'GUEST', role: 'guest' })}>
              + Add Guest
            </Button>
            <Button variant="subtle" onClick={() => setEd({ ...BLANK, category: 'STAFF', role: 'bartender', rank: 'Mess Staff' })}>
              + Add Mess Staff (Bartender)
            </Button>
            <Button variant="subtle" onClick={() => setEd({ ...BLANK, category: 'TD', role: 'customer' })}>
              + Register TD Officer
            </Button>
            <Button onClick={() => setEd({ ...BLANK })}>+ Add Posted-In Officer</Button>
          </div>
        }
      >
        <p className="mb-3 text-xs text-[#707EAE] dark:text-[#94A3B8]">
          Posted-in officers get their Service Number as their initial PIN (stored with scrypt hashing). Bartenders are categorised as <b>Mess Staff</b>. Excel import columns: <code>Name, Service Number, Rank, Mobile, Email, Category, Role</code>.
        </p>
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs font-bold uppercase tracking-wider text-[#94A3B8]">
              <tr><th className="p-2">Name</th><th>Service / Staff No</th><th>Rank / Designation</th><th>Category</th><th>Role</th><th>Alcohol Limit</th><th>Mobile</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const eff =
                  u.alcohol_limit != null
                    ? u.alcohol_limit === 0
                      ? 'Unlimited'
                      : `${u.alcohol_limit} pegs`
                    : u.role === 'guest'
                      ? Number(settings.guest_alcohol_limit || 0) > 0
                        ? `Default (${settings.guest_alcohol_limit})`
                        : 'Unlimited'
                      : ['member', 'customer'].includes(u.role) && Number(settings.member_alcohol_limit || 0) > 0
                        ? `Default (${settings.member_alcohol_limit})`
                        : '—';
                return (
                <tr key={u.id} className="border-t border-[#E9EDF7] dark:border-[#2A3346]">
                  <td className="p-2 font-bold">{u.name}</td>
                  <td>{u.service_no}</td>
                  <td>{u.rank || '—'}</td>
                  <td><Badge s={CAT_BADGE[u.category] || 'accepted'}>{CAT_LABEL[u.category] || u.category}</Badge></td>
                  <td className="capitalize">{u.role}</td>
                  <td className="text-xs font-semibold text-[#422AFB] dark:text-[#818CF8]">{eff}</td>
                  <td>{u.mobile || '—'}</td>
                  <td>{u.approval_status === 'pending' ? <Badge s="pending">pending approval</Badge> : u.approval_status === 'rejected' ? <Badge s="cancelled">declined</Badge> : u.active ? <Badge s="approved">active</Badge> : <Badge s="cancelled">inactive</Badge>}</td>
                  <td className="space-x-1 text-right">
                    {u.role === 'guest' && u.approval_status === 'pending' && <Button size="sm" variant="success" onClick={() => approveGuest(u, 'approve')}>Approve</Button>}
                    <Button size="sm" variant="subtle" onClick={() => setEd({ ...u, alcohol_limit: u.alcohol_limit ?? '' })}>Edit</Button>
                    <Button size="sm" variant="ghost" onClick={() => { setPinModal(u); setNewPin(''); }}>PIN</Button>
                    <Button size="sm" variant="ghost" onClick={async () => { if (confirm('Remove user?')) { await api(`/users/${u.id}`, { method: 'DELETE' }); load(); } }}>✕</Button>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal
        open={!!ed}
        onClose={() => setEd(null)}
        title={ed?.id ? 'Edit User' : ed?.category === 'STAFF' ? 'Add Mess Staff (Bartender)' : ed?.category === 'TD' ? 'Register TD Officer' : 'Add Posted-In Officer'}
      >
        {ed && (
          <form onSubmit={save} className="grid grid-cols-2 gap-3">
            <Field label="Full name"><Input value={ed.name} onChange={(e) => setEd({ ...ed, name: e.target.value })} required /></Field>
            <Field label={ed.category === 'STAFF' ? 'Staff ID / Number (unique)' : 'Service number (unique)'}>
              <Input value={ed.service_no} onChange={(e) => setEd({ ...ed, service_no: e.target.value })} required />
            </Field>
            <Field label={ed.category === 'STAFF' ? 'Designation' : 'Rank'}>
              <Input value={ed.rank || ''} onChange={(e) => setEd({ ...ed, rank: e.target.value })} placeholder={ed.category === 'STAFF' ? 'Bartender / Mess Staff' : 'e.g. Maj, Lt Col'} />
            </Field>
            <Field label="Mobile"><Input value={ed.mobile || ''} onChange={(e) => setEd({ ...ed, mobile: e.target.value })} /></Field>
            <Field label="Email"><Input type="email" value={ed.email || ''} onChange={(e) => setEd({ ...ed, email: e.target.value })} /></Field>
            <Field label="Application role">
              <Select value={ed.role} onChange={(e) => onRoleChange(e.target.value)}>
                <option value="member">Bar Member</option>
                <option value="customer">Customer / User</option>
                <option value="guest">Guest</option>
                <option value="bartender">Bartender</option>
                <option value="admin">Admin</option>
              </Select>
            </Field>
            <Field label="Category">
              {ed.role === 'bartender' ? (
                <Select value="STAFF" disabled>
                  <option value="STAFF">Mess Staff</option>
                </Select>
              ) : ed.role === 'guest' ? (
                <Select value="GUEST" disabled>
                  <option value="GUEST">Guest</option>
                </Select>
              ) : (
                <Select value={ed.category} onChange={(e) => onCategoryChange(e.target.value)}>
                  <option value="POSTED">Posted-In Officer</option>
                  <option value="TD">TD Officer</option>
                  <option value="STAFF">Mess Staff</option>
                  <option value="GUEST">Guest</option>
                </Select>
              )}
            </Field>
            {!ed.id && (ed.category === 'TD' || ed.category === 'STAFF' || ed.category === 'GUEST') && (
              <Field label={`Initial PIN (blank = ${ed.category === 'STAFF' ? 'Staff ID' : 'Service No'})`}>
                <Input value={ed.pin || ''} onChange={(e) => setEd({ ...ed, pin: e.target.value })} />
              </Field>
            )}
            {['guest', 'member', 'customer'].includes(ed.role) && (
              <Field label="Alcohol Limit Override (pegs)" hint="Blank = global default, 0 = unlimited, or 3 / 4 pegs">
                <Input type="number" min={0} max={20} placeholder={ed.role === 'guest' ? `Default (${settings.guest_alcohol_limit || '3'})` : `Default (${settings.member_alcohol_limit || '0'})`} value={ed.alcohol_limit ?? ''} onChange={(e) => setEd({ ...ed, alcohol_limit: e.target.value })} />
              </Field>
            )}
            {ed.id && (
              <label className="col-span-2 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!!ed.active} onChange={(e) => setEd({ ...ed, active: e.target.checked ? 1 : 0 })} /> Active account
              </label>
            )}
            <div className="col-span-2 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setEd(null)}>Cancel</Button>
              <Button>Save</Button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={!!pinModal} onClose={() => setPinModal(null)} title={`Reset PIN – ${pinModal?.name}`}>
        <Field label="New PIN (leave blank to reset to Service / Staff Number)">
          <Input value={newPin} onChange={(e) => setNewPin(e.target.value)} placeholder={pinModal?.service_no} />
        </Field>
        <div className="mt-3 flex justify-end"><Button onClick={resetPin}>Reset PIN</Button></div>
      </Modal>
    </div>
  );
}
