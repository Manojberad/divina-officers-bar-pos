import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useApp } from '../lib/app';
import { Badge, Button, Card, Input } from '../components/ui';

export default function Tables() {
  const { settings, toast } = useApp();
  const [tables, setTables] = useState<any[]>([]);
  const [name, setName] = useState('');
  const lanIp = settings.lan?.[0];
  const [base, setBase] = useState(() => (lanIp && location.hostname === 'localhost' ? `${location.protocol}//${lanIp}:${settings.port || location.port}` : location.origin));

  const load = () => api('/tables', { cache: false }).then(setTables);
  useEffect(() => { load(); }, []);
  useEffect(() => { if (lanIp && location.hostname === 'localhost') setBase(`${location.protocol}//${lanIp}:${settings.port || location.port}`); }, [lanIp]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault(); if (!name.trim()) return;
    await api('/tables', { method: 'POST', body: { name } }); setName(''); load();
  };
  const update = async (t: any, body: any) => { await api(`/tables/${t.id}`, { method: 'PUT', body }); toast('Updated'); load(); };

  return (
    <div className="space-y-4 p-4">
      <Card className="no-print" title="Table QR Code Management" actions={<Button onClick={() => window.print()}>🖨️ Print all active QR cards</Button>}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <form onSubmit={create} className="flex gap-2">
            <Input placeholder="New table name (e.g. Table 7, Patio 1)" value={name} onChange={(e) => setName(e.target.value)} />
            <Button>Add Table</Button>
          </form>
          <div className="flex items-center gap-2 text-sm">
            <span className="whitespace-nowrap text-gray-500">Local Wi-Fi URL encoded in QR:</span>
            <Input value={base} onChange={(e) => setBase(e.target.value)} />
          </div>
        </div>
        {settings.lan && settings.lan.length > 0 && <div className="mt-2 text-xs text-gray-500">Detected LAN addresses: {settings.lan.map((ip) => <button key={ip} className="mr-2 underline" onClick={() => setBase(`http://${ip}:${settings.port || 4000}`)}>{ip}</button>)}</div>}
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tables.map((t) => (
          <Card key={t.id} className={!t.active ? 'no-print opacity-50' : ''}>
            <div className="flex items-center justify-between"><h3 className="text-lg font-bold">{t.name}</h3><Badge s={t.active ? 'approved' : 'cancelled'}>{t.active ? 'active' : 'deactivated'}</Badge></div>
            <div className="my-3 flex flex-col items-center">
              <img src={`/api/tables/${t.id}/qr.png?base=${encodeURIComponent(base)}&c=${t.code}`} alt={t.name} className="h-48 w-48 rounded-xl bg-white p-2" />
              <div className="mt-1 text-center text-xs text-gray-500">{settings.bar_name} · Scan on local Wi-Fi to view menu & order</div>
              <a href={`/menu/${t.code}`} target="_blank" className="no-print mt-1 text-xs underline">{base}/menu/{t.code}</a>
            </div>
            <div className="no-print flex flex-wrap justify-center gap-2">
              <Button size="sm" variant="subtle" onClick={() => update(t, { active: !t.active })}>{t.active ? 'Deactivate' : 'Activate'}</Button>
              <Button size="sm" variant="ghost" onClick={() => update(t, { regenerate: true })}>Regenerate QR</Button>
              <Button size="sm" variant="ghost" onClick={async () => { if (confirm('Delete table?')) { await api(`/tables/${t.id}`, { method: 'DELETE' }); load(); } }}>Delete</Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
