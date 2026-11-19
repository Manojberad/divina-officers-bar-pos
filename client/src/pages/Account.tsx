import { useState } from 'react';
import { api } from '../lib/api';
import { useApp } from '../lib/app';
import { Button, Card, Field, Input } from '../components/ui';

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

  return (
    <div className="mx-auto max-w-xl space-y-4 p-4">
      <Card title="Profile">
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div><span className="text-gray-500">Name:</span> <b>{user?.rank} {user?.name}</b></div>
          <div><span className="text-gray-500">Service No:</span> <b>{user?.service_no}</b></div>
          <div><span className="text-gray-500">Category:</span> <b>{user?.category === 'STAFF' ? 'Mess Staff' : user?.category === 'POSTED' ? 'Posted-In Officer' : user?.category === 'TD' ? 'TD Officer' : user?.category}</b></div>
          <div><span className="text-gray-500">Role:</span> <b className="capitalize">{user?.role}</b></div>
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
