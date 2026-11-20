import { useState } from 'react';
import { api } from '../lib/api';
import { useApp, roleLabel, isAdminRole, PRIVILEGED_OFFICER_ROLES } from '../lib/app';
import { Badge, Button, Card, Field, Input } from '../components/ui';

const CAT_LABEL: Record<string, string> = {
  POSTED: 'Posted-In Officer',
  COURSE: 'Course Officer',
  TD: 'TD Officer',
  STAFF: 'Mess Staff',
  GUEST: 'Guest',
};

export default function Account() {
  const { user, toast } = useApp();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== confirm) return toast('PINs do not match', 'error');
    try { await api('/auth/change-pin', { method: 'POST', body: { current, next } }); toast('PIN updated'); setCurrent(''); setNext(''); setConfirm(''); }
    catch (e: any) { toast(e.message, 'error'); }
  };

  const designation = user?.designation || roleLabel(user?.role);
  const isPrivilegedOfficer = !!user && PRIVILEGED_OFFICER_ROLES.includes(user.role);

  return (
    <div className="mx-auto max-w-xl space-y-4 p-4">
      <Card title="Officer / Account Profile">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-[#F4F7FE] p-3.5 dark:bg-[#252D3D]">
          <div>
            <div className="text-base font-extrabold text-[#1B2559] dark:text-[#E6EDF3]">
              {user?.rank ? `${user.rank} ` : ''}{user?.name}
            </div>
            <div className="text-xs font-semibold text-[#707EAE] dark:text-[#94A3B8]">
              Service No: <b>{user?.service_no}</b>
              {user?.branch ? ` · ${user.branch}` : ''}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-[#D97706] to-[#F59E0B] px-3 py-1 text-xs font-extrabold text-white shadow-sm">
              {isAdminRole(user?.role) && '★ '}
              {designation}
            </span>
            {isPrivilegedOfficer && (
              <span className="text-[11px] font-semibold text-[#10B981]">Mess Member · Admin Privileges</span>
            )}
            {user?.role === 'superadmin' && (
              <span className="text-[11px] font-semibold text-[#818CF8]">Full Role &amp; System Authority</span>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div><span className="text-gray-500">Designation:</span> <b>{designation}</b></div>
          <div><span className="text-gray-500">Category:</span> <b>{CAT_LABEL[user?.category || ''] || user?.category}</b></div>
          {user?.branch && <div><span className="text-gray-500">Branch:</span> <b>{user.branch}</b></div>}
          {user?.tors && <div><span className="text-gray-500">TORS:</span> <b>{user.tors}</b></div>}
          {user?.category === 'TD' && (user.td_start_date || user.td_end_date) && (
            <div className="col-span-2"><span className="text-gray-500">TD Tenure:</span> <b>{user.td_start_date || '—'} → {user.td_end_date || '—'}</b></div>
          )}
          {isAdminRole(user?.role) && (
            <div className="col-span-2 pt-1">
              <Badge s="approved">Admin Rights Active</Badge>
            </div>
          )}
        </div>
      </Card>
      <Card title="Change PIN">
        <form onSubmit={submit} className="space-y-3">
          <Field label="Current PIN"><Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required /></Field>
          <Field label="New PIN (min 4 characters)"><Input type="password" value={next} onChange={(e) => setNext(e.target.value)} required /></Field>
          <Field label="Confirm new PIN"><Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required /></Field>
          <Button>Update PIN</Button>
        </form>
      </Card>
    </div>
  );
}
