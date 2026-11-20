import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useApp, isSuperAdmin, isAdminRole, roleLabel, PRIVILEGED_OFFICER_ROLES, ADMIN_ROLES } from '../lib/app';
import { Badge, Button, Card, Field, Input, Modal, Select, today } from '../components/ui';

const BLANK = {
  name: '', service_no: '', rank: '', branch: '', tors: '', mobile: '', email: '',
  category: 'POSTED', role: 'member', pin: '', alcohol_limit: '', td_start_date: '', td_end_date: '', active: 1,
};

const CAT_LABEL: Record<string, string> = {
  POSTED: 'Posted-In Officer',
  COURSE: 'Course Officer',
  TD: 'TD Officer',
  STAFF: 'Mess Staff',
  GUEST: 'Guest',
};

const CAT_BADGE: Record<string, string> = {
  POSTED: 'accepted',
  COURSE: 'approved',
  TD: 'preparing',
  STAFF: 'placed',
  GUEST: 'pending',
};

const APPOINTMENTS = [
  { role: 'commanding_officer', label: 'Commanding Officer', icon: '⭐', desc: 'Full Admin Rights + Mess Member' },
  { role: 'mess_secretary', label: 'Mess Secretary', icon: '📋', desc: 'Full Admin Rights + Mess Member' },
  { role: 'bar_incharge', label: 'Bar Incharge', icon: '🥃', desc: 'Full Admin Rights + Mess Member' },
] as const;

export default function Users() {
  const { user, toast, settings, reloadSettings, reloadUser } = useApp();
  const superAdmin = isSuperAdmin(user);
  const [users, setUsers] = useState<any[]>([]);
  const [ed, setEd] = useState<any>(null);
  const [pinModal, setPinModal] = useState<any>(null);
  const [newPin, setNewPin] = useState('');
  const [extendModal, setExtendModal] = useState<any>(null);
  const [extendDays, setExtendDays] = useState('15');
  const [extendDate, setExtendDate] = useState('');
  const [guestLimitVal, setGuestLimitVal] = useState(settings.guest_alcohol_limit ?? '3');
  const [memberLimitVal, setMemberLimitVal] = useState(settings.member_alcohol_limit ?? '0');
  const [pickRole, setPickRole] = useState<Record<string, string>>({
    commanding_officer: '',
    mess_secretary: '',
    bar_incharge: '',
  });
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState<string>('ALL');

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

  const assignAppointment = async (targetRole: string) => {
    const uid = Number(pickRole[targetRole]);
    if (!uid) return toast('Select an officer first', 'error');
    try {
      const updated = await api(`/users/${uid}/assign-role`, { method: 'POST', body: { role: targetRole, replace_existing: true } });
      toast(`Assigned ${updated.rank ? `${updated.rank} ` : ''}${updated.name} as ${roleLabel(targetRole)}`);
      setPickRole((p) => ({ ...p, [targetRole]: '' }));
      load();
      if (uid === user?.id) reloadUser();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const revokeAppointment = async (u: any) => {
    try {
      await api(`/users/${u.id}/assign-role`, { method: 'POST', body: { role: 'member', replace_existing: false } });
      toast(`${u.rank ? `${u.rank} ` : ''}${u.name} reverted to Mess Member`);
      load();
      if (u.id === user?.id) reloadUser();
    } catch (e: any) { toast(e.message, 'error'); }
  };

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
      if (ed.id === user?.id) reloadUser();
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

  const submitExtendTd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!extendModal) return;
    try {
      const body = extendDate ? { td_end_date: extendDate } : { days: Number(extendDays) };
      const u = await api(`/users/${extendModal.id}/extend-td`, { method: 'POST', body });
      toast(`TD membership extended until ${u.td_end_date} (active)`);
      setExtendModal(null);
      setExtendDate('');
      load();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const onRoleChange = (role: string) => {
    if (role === 'bartender') {
      setEd({ ...ed, role, category: 'STAFF', rank: ed.rank || 'Mess Staff' });
    } else if (role === 'guest') {
      setEd({ ...ed, role, category: 'GUEST' });
    } else if (['STAFF', 'GUEST'].includes(ed.category) && role !== 'superadmin') {
      setEd({ ...ed, role, category: 'POSTED' });
    } else {
      setEd({ ...ed, role });
    }
  };

  const onCategoryChange = (category: string) => {
    if (category === 'STAFF') {
      setEd({ ...ed, category: 'STAFF', role: ed.role === 'superadmin' ? 'superadmin' : 'bartender', rank: ed.rank || 'Mess Staff' });
    } else if (category === 'GUEST') {
      setEd({ ...ed, category: 'GUEST', role: 'guest' });
    } else if (['bartender', 'guest'].includes(ed.role)) {
      setEd({ ...ed, category, role: category === 'TD' ? 'customer' : 'member' });
    } else {
      setEd({ ...ed, category });
    }
  };

  const todayStr = today();
  const tdAlerts = users.filter((u) => {
    if (u.category !== 'TD' || !u.td_end_date) return false;
    const diffDays = Math.ceil((Date.parse(`${u.td_end_date}T23:59:59`) - Date.now()) / 86400e3);
    return diffDays <= 3;
  });

  const pendingGuests = users.filter((u) => u.role === 'guest' && u.approval_status === 'pending');
  const memberCount = users.filter((u) => u.role !== 'guest').length;
  const eligibleOfficers = users.filter((u) => u.active && ['POSTED', 'COURSE'].includes(u.category) && u.role !== 'superadmin');
  const superAdmins = users.filter((u) => u.role === 'superadmin' && u.active);

  const qLower = search.trim().toLowerCase();
  const filteredUsers = users.filter((u) => {
    if (catFilter === 'PRIVILEGED' && !ADMIN_ROLES.includes(u.role)) return false;
    if (['POSTED', 'COURSE', 'TD', 'STAFF', 'GUEST'].includes(catFilter) && u.category !== catFilter) return false;
    if (!qLower) return true;
    return [u.name, u.service_no, u.rank, u.branch, roleLabel(u.role), CAT_LABEL[u.category]]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(qLower));
  });

  return (
    <div className="space-y-4 p-4">
      {/* Mess Appointments & Privileged Admin Roles (Managed by Super Admin) */}
      <Card
        title="🎖 Mess Appointments & Admin Privileges"
        actions={
          <span className="rounded-full bg-[#F4F7FE] px-3 py-1 text-xs font-bold text-[#707EAE] dark:bg-[#252D3D] dark:text-[#94A3B8]">
            {superAdmin ? '★ Super Admin Role Management Active' : 'Managed by Super Admin'}
          </span>
        }
      >
        <p className="mb-3 text-xs text-[#707EAE] dark:text-[#94A3B8]">
          <b>Commanding Officer</b>, <b>Mess Secretary</b>, and <b>Bar Incharge</b> hold full Admin privileges while displaying their official appointment on their account.
          {superAdmins.length > 0 && (
            <> Super Admin{superAdmins.length > 1 ? 's' : ''}: <b>{superAdmins.map((s) => `${s.rank && s.rank !== 'Super Admin' ? `${s.rank} ` : ''}${s.name} (${s.service_no})`).join(' · ')}</b>.</>
          )}
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {APPOINTMENTS.map((ap) => {
            const holders = users.filter((u) => u.role === ap.role && u.active);
            return (
              <div key={ap.role} className="flex flex-col justify-between gap-2.5 rounded-2xl border border-[#E9EDF7] bg-[#F4F7FE]/70 p-3.5 dark:border-[#2A3346] dark:bg-[#252D3D]">
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-extrabold text-[#1B2559] dark:text-[#E6EDF3]">
                      {ap.icon} {ap.label}
                    </span>
                    <span className="rounded-full bg-[#D97706]/15 px-2 py-0.5 text-[10px] font-extrabold text-[#D97706] dark:text-[#FBBF24]">
                      Admin Rights
                    </span>
                  </div>
                  <div className="mt-2">
                    {holders.length === 0 ? (
                      <div className="text-xs italic text-[#94A3B8]">Not assigned yet</div>
                    ) : (
                      <div className="space-y-1.5">
                        {holders.map((h) => (
                          <div key={h.id} className="flex items-center justify-between gap-2 rounded-xl bg-white px-2.5 py-2 dark:bg-[#1C2230]">
                            <div className="min-w-0">
                              <div className="truncate text-xs font-extrabold">{h.rank ? `${h.rank} ` : ''}{h.name}</div>
                              <div className="text-[11px] text-[#94A3B8]">Service No: {h.service_no}{h.branch ? ` · ${h.branch}` : ''}</div>
                            </div>
                            {superAdmin && (
                              <Button size="sm" variant="ghost" onClick={() => revokeAppointment(h)} title="Revert to Mess Member">
                                Remove
                              </Button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                {superAdmin && (
                  <div className="flex gap-1.5 pt-1">
                    <Select
                      value={pickRole[ap.role] || ''}
                      onChange={(e) => setPickRole((p) => ({ ...p, [ap.role]: e.target.value }))}
                      className="!min-h-9 !py-1 !text-xs"
                    >
                      <option value="">Assign posted officer…</option>
                      {eligibleOfficers.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.rank ? `${o.rank} ` : ''}{o.name} ({o.service_no}){PRIVILEGED_OFFICER_ROLES.includes(o.role) ? ` — ${roleLabel(o.role)}` : ''}
                        </option>
                      ))}
                    </Select>
                    <Button size="sm" onClick={() => assignAppointment(ap.role)} disabled={!pickRole[ap.role]}>
                      Assign
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {/* Expiring / Expired TD Officers Alert Panel */}
      {tdAlerts.length > 0 && (
        <Card title={`🗓 TD Officer Tenure Alerts (${tdAlerts.length})`} className="!border-[#F97316]">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {tdAlerts.map((u) => {
              const expired = u.td_end_date < todayStr;
              return (
                <div key={u.id} className="flex items-center justify-between gap-2 rounded-2xl bg-[#F4F7FE] p-3 dark:bg-[#252D3D]">
                  <div className="min-w-0">
                    <div className="truncate font-bold">{u.rank} {u.name} <span className="text-xs text-[#94A3B8]">({u.service_no})</span></div>
                    <div className={`text-xs font-semibold ${expired ? 'text-[#EE5D50]' : 'text-[#F97316]'}`}>
                      {expired ? `Expired on ${u.td_end_date}` : `Expires on ${u.td_end_date}`}
                    </div>
                  </div>
                  <Button size="sm" onClick={() => { setExtendModal(u); setExtendDays('15'); setExtendDate(''); }}>+ Extend</Button>
                </div>
              );
            })}
          </div>
        </Card>
      )}

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
        title={`Registered Users (${memberCount} / 250 Officers & Staff · ${users.length - memberCount} Guests)`}
        actions={
          <div className="flex flex-wrap gap-2">
            <label className="cursor-pointer rounded-2xl bg-[#F4F7FE] px-3.5 py-2.5 text-sm font-bold text-[#1B2559] hover:bg-[#E9EDF7] dark:bg-[#252D3D] dark:text-[#E6EDF3]">
              📥 Import Excel
              <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => importXlsx(e.target.files?.[0])} />
            </label>
            <Button variant="subtle" onClick={() => setEd({ ...BLANK, category: 'GUEST', role: 'guest' })}>
              + Add Guest
            </Button>
            <Button variant="subtle" onClick={() => setEd({ ...BLANK, category: 'STAFF', role: 'bartender', rank: 'Mess Staff' })}>
              + Add Mess Staff
            </Button>
            <Button variant="subtle" onClick={() => setEd({ ...BLANK, category: 'TD', role: 'customer', td_start_date: todayStr })}>
              + TD Officer
            </Button>
            <Button variant="subtle" onClick={() => setEd({ ...BLANK, category: 'COURSE', role: 'member' })}>
              + Course Officer
            </Button>
            <Button onClick={() => setEd({ ...BLANK })}>+ Posted-In Officer</Button>
          </div>
        }
      >
        <p className="mb-3 text-xs text-[#707EAE] dark:text-[#94A3B8]">
          Posted-in &amp; Course officers are Mess Members by default and use their numeric Service Number as initial PIN. Excel import automatically strips alphabetic check suffixes (e.g. <code>27415-T → 27415</code>).
        </p>

        {/* Search & Category Filter Bar */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, service no, rank, branch, designation…"
            className="!max-w-xs"
          />
          <div className="flex flex-wrap gap-1.5">
            {[
              ['ALL', `All (${users.length})`],
              ['PRIVILEGED', `Appointments & Admins (${users.filter((u) => ADMIN_ROLES.includes(u.role)).length})`],
              ['POSTED', `Posted-In (${users.filter((u) => u.category === 'POSTED').length})`],
              ['COURSE', `Course (${users.filter((u) => u.category === 'COURSE').length})`],
              ['TD', `TD (${users.filter((u) => u.category === 'TD').length})`],
              ['STAFF', `Staff (${users.filter((u) => u.category === 'STAFF').length})`],
              ['GUEST', `Guests (${users.filter((u) => u.category === 'GUEST').length})`],
            ].map(([k, lbl]) => (
              <Button key={k} size="sm" variant={catFilter === k ? 'primary' : 'subtle'} onClick={() => setCatFilter(k)}>
                {lbl}
              </Button>
            ))}
          </div>
        </div>

        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs font-bold uppercase tracking-wider text-[#94A3B8]">
              <tr>
                <th className="p-2">Name</th>
                <th>Service / Staff No</th>
                <th>Rank / Branch</th>
                <th>Category</th>
                <th>Designation / Role</th>
                <th>TD / TORS</th>
                <th>Alcohol Limit</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((u) => {
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
                const tdExpired = u.category === 'TD' && u.td_end_date && u.td_end_date < todayStr;
                const tdUpcoming = u.category === 'TD' && u.td_start_date && u.td_start_date > todayStr;
                const lockedForNonSuper = !superAdmin && u.role === 'superadmin';
                const canDelete = u.id !== user?.id && (superAdmin || !ADMIN_ROLES.includes(u.role));
                const desig = u.designation || roleLabel(u.role);
                return (
                <tr key={u.id} className="border-t border-[#E9EDF7] dark:border-[#2A3346]">
                  <td className="p-2 font-bold">{u.name}</td>
                  <td className="font-mono text-xs font-semibold">{u.service_no}</td>
                  <td>
                    <span>{u.rank || '—'}</span>
                    {u.branch && <span className="ml-1.5 text-xs text-[#94A3B8]">· {u.branch}</span>}
                  </td>
                  <td><Badge s={CAT_BADGE[u.category] || 'accepted'}>{CAT_LABEL[u.category] || u.category}</Badge></td>
                  <td>
                    {isAdminRole(u.role) ? (
                      <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-extrabold ${
                        u.role === 'superadmin'
                          ? 'bg-[#422AFB]/15 text-[#422AFB] dark:bg-[#818CF8]/20 dark:text-[#A5B4FC]'
                          : 'bg-[#D97706]/15 text-[#B45309] dark:bg-[#F59E0B]/20 dark:text-[#FBBF24]'
                      }`}>
                        ★ {desig}
                      </span>
                    ) : (
                      <span className="text-xs font-semibold text-[#707EAE] dark:text-[#94A3B8]">{desig}</span>
                    )}
                  </td>
                  <td className="text-xs">
                    {u.category === 'TD' ? (
                      u.td_start_date || u.td_end_date ? (
                        <span className={tdExpired ? 'font-bold text-[#EE5D50]' : 'font-semibold'}>
                          {u.td_start_date || '—'} → {u.td_end_date || '—'}
                        </span>
                      ) : <span className="text-[#94A3B8]">Not set</span>
                    ) : u.tors ? (
                      <span className="text-[#707EAE] dark:text-[#94A3B8]">TORS: {u.tors}</span>
                    ) : '—'}
                  </td>
                  <td className="text-xs font-semibold text-[#422AFB] dark:text-[#818CF8]">{eff}</td>
                  <td>
                    {u.approval_status === 'pending' ? <Badge s="pending">pending approval</Badge>
                      : u.approval_status === 'rejected' ? <Badge s="cancelled">declined</Badge>
                        : tdExpired ? <Badge s="cancelled">TD expired</Badge>
                          : tdUpcoming ? <Badge s="pending">starts {u.td_start_date}</Badge>
                            : u.active ? <Badge s="approved">active</Badge> : <Badge s="cancelled">inactive</Badge>}
                  </td>
                  <td className="space-x-1 whitespace-nowrap text-right">
                    {u.role === 'guest' && u.approval_status === 'pending' && <Button size="sm" variant="success" onClick={() => approveGuest(u, 'approve')}>Approve</Button>}
                    {u.category === 'TD' && <Button size="sm" variant="primary" onClick={() => { setExtendModal(u); setExtendDays('15'); setExtendDate(''); }}>Extend</Button>}
                    {!lockedForNonSuper && (
                      <>
                        <Button size="sm" variant="subtle" onClick={() => setEd({ ...u, branch: u.branch ?? '', tors: u.tors ?? '', alcohol_limit: u.alcohol_limit ?? '', td_start_date: u.td_start_date ?? '', td_end_date: u.td_end_date ?? '' })}>Edit</Button>
                        <Button size="sm" variant="ghost" onClick={() => { setPinModal(u); setNewPin(''); }}>PIN</Button>
                      </>
                    )}
                    {canDelete && (
                      <Button size="sm" variant="ghost" onClick={async () => { if (confirm('Remove user?')) { await api(`/users/${u.id}`, { method: 'DELETE' }); load(); } }}>✕</Button>
                    )}
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
        title={ed?.id ? 'Edit User' : ed?.category === 'STAFF' ? 'Add Mess Staff (Bartender)' : ed?.category === 'TD' ? 'Register TD Officer' : ed?.category === 'COURSE' ? 'Add Course Officer' : 'Add Posted-In Officer'}
      >
        {ed && (
          <form onSubmit={save} className="grid grid-cols-2 gap-3">
            <Field label="Full name"><Input value={ed.name} onChange={(e) => setEd({ ...ed, name: e.target.value })} required /></Field>
            <Field label={ed.category === 'STAFF' ? 'Staff ID / Number (unique)' : 'Service number (numeric, unique)'}>
              <Input value={ed.service_no} onChange={(e) => setEd({ ...ed, service_no: e.target.value })} placeholder="e.g. 27415" required />
            </Field>
            <Field label={ed.category === 'STAFF' ? 'Designation' : 'Rank'}>
              <Input value={ed.rank || ''} onChange={(e) => setEd({ ...ed, rank: e.target.value })} placeholder={ed.category === 'STAFF' ? 'Bartender / Mess Staff' : 'e.g. Gp Capt, Wg Cdr, Fg Offr'} />
            </Field>
            <Field label="Branch">
              <Input value={ed.branch || ''} onChange={(e) => setEd({ ...ed, branch: e.target.value })} placeholder="e.g. AE(L), AE(M), F(P)" />
            </Field>
            <Field label="Mobile"><Input value={ed.mobile || ''} onChange={(e) => setEd({ ...ed, mobile: e.target.value })} /></Field>
            <Field label="Email"><Input type="email" value={ed.email || ''} onChange={(e) => setEd({ ...ed, email: e.target.value })} /></Field>
            <Field label="Designation / Application role">
              <Select
                value={ed.role}
                onChange={(e) => onRoleChange(e.target.value)}
                disabled={!superAdmin && ADMIN_ROLES.includes(ed.role)}
              >
                <option value="member">Mess Member</option>
                <option value="customer">TD Officer</option>
                <option value="guest">Guest</option>
                <option value="bartender">Bartender</option>
                {(superAdmin || ed.role === 'commanding_officer') && <option value="commanding_officer">★ Commanding Officer (Admin)</option>}
                {(superAdmin || ed.role === 'mess_secretary') && <option value="mess_secretary">★ Mess Secretary (Admin)</option>}
                {(superAdmin || ed.role === 'bar_incharge') && <option value="bar_incharge">★ Bar Incharge (Admin)</option>}
                {(superAdmin || ed.role === 'admin') && <option value="admin">Admin</option>}
                {(superAdmin || ed.role === 'superadmin') && <option value="superadmin">★ Super Admin</option>}
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
                  <option value="COURSE">Course Officer</option>
                  <option value="TD">TD Officer</option>
                  <option value="STAFF">Mess Staff</option>
                  <option value="GUEST">Guest</option>
                </Select>
              )}
            </Field>
            {['POSTED', 'COURSE'].includes(ed.category) && (
              <Field label="TORS (optional)">
                <Input value={ed.tors || ''} onChange={(e) => setEd({ ...ed, tors: e.target.value })} placeholder="e.g. 17-Aug-26" />
              </Field>
            )}
            {ed.category === 'TD' && (
              <>
                <Field label="TD Enrollment Date">
                  <Input type="date" value={ed.td_start_date || ''} onChange={(e) => setEd({ ...ed, td_start_date: e.target.value })} required />
                </Field>
                <Field label="TD Completion Date">
                  <Input type="date" value={ed.td_end_date || ''} min={ed.td_start_date || undefined} onChange={(e) => setEd({ ...ed, td_end_date: e.target.value })} required />
                </Field>
              </>
            )}
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

      <Modal open={!!extendModal} onClose={() => setExtendModal(null)} title={`Extend TD Membership – ${extendModal?.rank || ''} ${extendModal?.name || ''}`}>
        {extendModal && (
          <form onSubmit={submitExtendTd} className="space-y-4">
            <div className="rounded-2xl bg-[#F4F7FE] p-3 text-xs dark:bg-[#252D3D]">
              <div>Service No: <b>{extendModal.service_no}</b></div>
              <div className="mt-1">Current TD Tenure: <b>{extendModal.td_start_date || '—'} → {extendModal.td_end_date || 'Not set'}</b></div>
            </div>
            <Field label="Extend by Custom Days">
              <div className="flex flex-wrap gap-2">
                <Input type="number" min={1} max={365} value={extendDays} onChange={(e) => { setExtendDays(e.target.value); setExtendDate(''); }} className="!w-28" />
                {['7', '15', '30', '60'].map((d) => (
                  <Button key={d} type="button" size="sm" variant={!extendDate && extendDays === d ? 'primary' : 'subtle'} onClick={() => { setExtendDays(d); setExtendDate(''); }}>
                    +{d} days
                  </Button>
                ))}
              </div>
            </Field>
            <Field label="…or choose an exact New Completion Date">
              <Input type="date" value={extendDate} min={extendModal.td_start_date || undefined} onChange={(e) => setExtendDate(e.target.value)} />
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setExtendModal(null)}>Cancel</Button>
              <Button type="submit">Extend &amp; Reactivate</Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
