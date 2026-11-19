import { useEffect, useState } from 'react';
import { api, download } from '../lib/api';
import { useApp } from '../lib/app';
import { Button, Card, DateRange, Select, daysAgo, today } from '../components/ui';

export default function Reports() {
  const { money, toast } = useApp();
  const [types, setTypes] = useState<{ key: string; title: string }[]>([]);
  const [type, setType] = useState('daily');
  const [range, setRange] = useState([daysAgo(29), today()]);
  const [rep, setRep] = useState<any>(null);
  const [sel, setSel] = useState<Record<string, boolean>>({});

  useEffect(() => { api('/reports/types').then(setTypes); }, []);
  useEffect(() => { setSel({}); api(`/reports/${type}?from=${range[0]}&to=${range[1]}`, { cache: false }).then(setRep).catch((e) => toast(e.message, 'error')); }, [type, range]);

  const selectedIds = Object.keys(sel).filter((k) => sel[k]);
  const exp = (fmt: 'xlsx' | 'pdf') => {
    const qs = `from=${range[0]}&to=${range[1]}&format=${fmt}${selectedIds.length ? `&ids=${selectedIds.join(',')}` : ''}`;
    download(`/reports/${type}?${qs}`, `${type}-${range[0]}-to-${range[1]}.${fmt}`).catch((e) => toast(e.message, 'error'));
  };
  const hasId = rep?.rows?.[0]?._id != null;

  return (
    <div className="space-y-4 p-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={type} onChange={(e) => setType(e.target.value)} className="!w-72">
              {types.map((t) => <option key={t.key} value={t.key}>{t.title}</option>)}
            </Select>
            <DateRange from={range[0]} to={range[1]} onChange={(f, t) => setRange([f, t])} />
          </div>
          <div className="flex gap-2">
            <Button onClick={() => exp('xlsx')}>📊 Export Excel{selectedIds.length ? ` (${selectedIds.length})` : ''}</Button>
            <Button variant="subtle" onClick={() => exp('pdf')}>📄 Export PDF{selectedIds.length ? ` (${selectedIds.length})` : ''}</Button>
          </div>
        </div>
      </Card>

      {rep && (
        <Card title={rep.title} actions={<span className="text-xs text-gray-500">{rep.rows.length} rows</span>}>
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-gray-500">
                <tr>
                  {hasId && <th className="p-2"><input type="checkbox" checked={rep.rows.length > 0 && selectedIds.length === rep.rows.length} onChange={(e) => setSel(Object.fromEntries(rep.rows.map((r: any) => [r._id, e.target.checked])))} /></th>}
                  {rep.columns.map((c: any) => <th key={c.key} className={`p-2 ${c.type ? 'text-right' : ''}`}>{c.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {rep.rows.map((r: any, i: number) => (
                  <tr key={r._id ?? i} className="border-t dark:border-gray-700">
                    {hasId && <td className="p-2"><input type="checkbox" checked={!!sel[r._id]} onChange={(e) => setSel({ ...sel, [r._id]: e.target.checked })} /></td>}
                    {rep.columns.map((c: any) => <td key={c.key} className={`p-2 ${c.type ? 'text-right' : ''}`}>{c.type === 'money' ? money(r[c.key]) : r[c.key] ?? ''}</td>)}
                  </tr>
                ))}
                {Object.keys(rep.totals || {}).length > 0 && (
                  <tr className="border-t-2 font-bold">
                    {hasId && <td />}
                    {rep.columns.map((c: any, idx: number) => <td key={c.key} className={`p-2 ${c.type ? 'text-right' : ''}`}>{idx === 0 ? 'TOTAL' : rep.totals[c.key] != null ? (c.type === 'money' ? money(rep.totals[c.key]) : rep.totals[c.key]) : ''}</td>)}
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
