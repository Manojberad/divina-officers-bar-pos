import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, Tooltip, Legend, Filler } from 'chart.js';
import { Line, Bar, Doughnut } from 'react-chartjs-2';
import { api } from '../lib/api';
import { useApp } from '../lib/app';
import { Button, Card, DateRange, StockDot, daysAgo, today } from '../components/ui';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, Tooltip, Legend, Filler);
const PALETTE = ['#6366F1', '#38BDF8', '#10B981', '#FBBF24', '#A78BFA', '#F87171'];

export default function Dashboard() {
  const { money } = useApp();
  const [range, setRange] = useState([daysAgo(29), today()]);
  const [grain, setGrain] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [d, setD] = useState<any>(null);
  useEffect(() => { api(`/dashboard?from=${range[0]}&to=${range[1]}`, { cache: false }).then(setD).catch(() => {}); }, [range]);
  if (!d) return <div className="p-6 text-sm font-medium text-[#94A3B8]">Loading dashboard…</div>;

  const series = grain === 'daily' ? d.daily.map((x: any) => [x.d.slice(5), x.revenue]) : grain === 'weekly' ? d.weekly.map((x: any) => [x.w, x.revenue]) : d.monthly.map((x: any) => [x.m, x.revenue]);

  const kpis = [
    {
      label: "Today's Sales",
      value: money(d.today.revenue),
      sub: `${d.today.orders} orders today`,
      accent: 'bg-[#F4F7FE] text-[#422AFB] dark:bg-[#252D3D] dark:text-[#818CF8]',
      icon: <svg viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6"><path d="M5 9.2h3V19H5zM10.6 5h2.8v14h-2.8zm5.6 8H19v6h-2.8z" /></svg>,
    },
    {
      label: 'Weekly Revenue',
      value: money(d.week.revenue),
      sub: `${d.week.orders} orders this week`,
      accent: 'bg-[#F4F7FE] text-[#0284C7] dark:bg-[#252D3D] dark:text-[#38BDF8]',
      icon: <svg viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6"><path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10z" /></svg>,
    },
    {
      label: 'Monthly Revenue',
      value: money(d.month.revenue),
      sub: `${d.month.orders} orders this month`,
      accent: 'horizon-gradient text-white',
      icon: <svg viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6"><path d="M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z" /></svg>,
    },
    {
      label: 'Period Revenue',
      value: money(d.kpi.revenue),
      sub: `${d.kpi.orders} orders · avg ${money(d.kpi.avg)}`,
      accent: 'bg-[#F4F7FE] text-[#10B981] dark:bg-[#252D3D] dark:text-[#34D399]',
      icon: <svg viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6"><path d="M16 6l2.29 2.29-4.88 4.88-4-4L2 16.59 3.41 18l6-6 4 4 6.3-6.29L22 12V6z" /></svg>,
    },
    {
      label: 'Drinks Served',
      value: String(d.kpi.drinks),
      sub: 'Total items in range',
      accent: 'bg-[#F4F7FE] text-[#D97706] dark:bg-[#252D3D] dark:text-[#FBBF24]',
      icon: <svg viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6"><path d="M21 5V3H3v2l8 9v5H6v2h12v-2h-5v-5l8-9zM7.43 7 5.66 5h12.69l-1.78 2H7.43z" /></svg>,
    },
    {
      label: 'Inventory Value',
      value: money(d.valuation.cost),
      sub: `Retail ${money(d.valuation.retail)}`,
      accent: 'bg-[#F4F7FE] text-[#422AFB] dark:bg-[#252D3D] dark:text-[#818CF8]',
      icon: <svg viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6"><path d="M20 2H4c-1 0-2 .9-2 2v3.01c0 .72.43 1.34 1 1.69V20c0 1.1 1.1 2 2 2h14c.9 0 2-.9 2-2V8.7c.57-.35 1-.97 1-1.69V4c0-1.1-1-2-2-2zm-5 12H9v-2h6v2zm5-7H4V4h16v3z" /></svg>,
    },
  ];

  const baseAxis = {
    grid: { display: false, drawBorder: false },
    ticks: { color: '#94A3B8', font: { size: 11, weight: 600 as const } },
    border: { display: false },
  };

  return (
    <div className="space-y-5 p-2 sm:p-3">
      {/* Date Range Filter Bar */}
      <div className="horizon-shadow flex flex-wrap items-center justify-between gap-3 rounded-[20px] border border-transparent bg-white px-5 py-3.5 dark:border-[#2A3346] dark:bg-[#1C2230]">
        <div>
          <div className="text-xs font-bold uppercase tracking-wider text-[#94A3B8]">Analytics Period</div>
          <div className="text-sm font-bold text-[#1B2559] dark:text-[#E6EDF3]">Filter KPIs, charts & stock movements</div>
        </div>
        <DateRange from={range[0]} to={range[1]} onChange={(f, t) => setRange([f, t])} />
      </div>

      {/* MiniStatistics KPI Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        {kpis.map((k) => (
          <div key={k.label} className="horizon-shadow flex items-center gap-4 rounded-[20px] border border-transparent bg-white px-4 py-4 dark:border-[#2A3346] dark:bg-[#1C2230]">
            <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full ${k.accent}`}>
              {k.icon}
            </div>
            <div className="min-w-0">
              <div className="truncate text-xs font-medium text-[#94A3B8]">{k.label}</div>
              <div className="mt-0.5 truncate text-xl font-extrabold tracking-tight text-[#1B2559] dark:text-[#E6EDF3] sm:text-2xl">{k.value}</div>
              <div className="truncate text-[11px] font-semibold text-[#10B981] dark:text-[#34D399]">{k.sub}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Quick Action Alert Banners */}
      {(d.pending.disputed > 0 || d.alerts.length > 0 || d.pending.prebooked > 0) && (
        <div className="flex flex-wrap gap-3">
          {d.pending.disputed > 0 && (
            <Link to="/orders" className="inline-flex items-center gap-2 rounded-2xl bg-[#E05252] px-4 py-2.5 text-xs font-bold text-white shadow-md">
              ⚠️ {d.pending.disputed} disputed order(s) need resolution
            </Link>
          )}
          {d.pending.prebooked > 0 && (
            <Link to="/orders" className="inline-flex items-center gap-2 rounded-2xl bg-[#6366F1] px-4 py-2.5 text-xs font-bold text-white shadow-md">
              ⏰ {d.pending.prebooked} upcoming pre-booked order(s)
            </Link>
          )}
          {d.alerts.length > 0 && (
            <Link to="/inventory" className="inline-flex items-center gap-2 rounded-2xl bg-[#FBBF24] px-4 py-2.5 text-xs font-bold text-[#1B2559] shadow-md">
              📦 {d.alerts.length} product(s) low / critical / out of stock
            </Link>
          )}
        </div>
      )}

      {/* Row 1: Revenue Line Chart + Category Breakdown */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card
          className="lg:col-span-2"
          title="Revenue Trend"
          actions={(['daily', 'weekly', 'monthly'] as const).map((g) => (
            <Button key={g} size="sm" variant={grain === g ? 'primary' : 'subtle'} onClick={() => setGrain(g)} className="capitalize">
              {g}
            </Button>
          ))}
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <div className="flex flex-col justify-between">
              <div>
                <div className="text-3xl font-extrabold tracking-tight text-[#1B2559] dark:text-[#E6EDF3]">{money(d.kpi.revenue)}</div>
                <div className="mt-1 flex items-center gap-1.5 text-xs font-bold text-[#94A3B8]">
                  Total Revenue <span className="text-[#10B981] dark:text-[#34D399]">▲ {d.kpi.orders} orders</span>
                </div>
              </div>
              <div className="mt-4 hidden items-center gap-2 text-xs font-bold text-[#10B981] dark:text-[#34D399] md:flex">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#10B981] text-[11px] text-white">✓</span>
                Live Local DB
              </div>
            </div>
            <div className="h-64 md:col-span-3">
              <Line
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: { legend: { display: false } },
                  scales: { x: baseAxis, y: { ...baseAxis, display: false } },
                }}
                data={{
                  labels: series.map((x: any) => x[0]),
                  datasets: [
                    {
                      data: series.map((x: any) => x[1]),
                      borderColor: '#6366F1',
                      borderWidth: 3.5,
                      pointBackgroundColor: '#6366F1',
                      pointBorderColor: '#ffffff',
                      pointBorderWidth: 2,
                      pointRadius: 4,
                      backgroundColor: 'rgba(99, 102, 241, 0.14)',
                      fill: true,
                      tension: 0.4,
                    },
                  ],
                }}
              />
            </div>
          </div>
        </Card>

        <Card title="Category-Wise Sales">
          <div className="h-52">
            <Doughnut
              options={{
                responsive: true,
                maintainAspectRatio: false,
                cutout: '68%',
                plugins: { legend: { display: false } },
              }}
              data={{
                labels: d.categories.map((c: any) => c.category),
                datasets: [{ data: d.categories.map((c: any) => c.revenue), backgroundColor: PALETTE, borderWidth: 0 }],
              }}
            />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 rounded-2xl bg-[#F4F7FE] p-3 dark:bg-[#252D3D]">
            {d.categories.slice(0, 4).map((c: any, idx: number) => (
              <div key={c.category} className="flex items-center gap-2 text-xs">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: PALETTE[idx % PALETTE.length] }} />
                <div className="min-w-0">
                  <div className="truncate text-[#94A3B8]">{c.category}</div>
                  <div className="font-bold text-[#1B2559] dark:text-[#E6EDF3]">{money(c.revenue)}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Row 2: Popular Products + Purchase vs Consumption */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card title="Most Popular Products">
          <div className="h-64">
            <Bar
              options={{
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { x: baseAxis, y: baseAxis },
              }}
              data={{
                labels: d.topProducts.map((p: any) => p.name),
                datasets: [{ data: d.topProducts.map((p: any) => p.revenue), backgroundColor: '#6366F1', borderRadius: 8, barThickness: 14 }],
              }}
            />
          </div>
        </Card>

        <Card title="Purchase vs Consumption (Cost)">
          <div className="h-64">
            <Bar
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { labels: { color: '#94A3B8', usePointStyle: true, boxWidth: 8 } } },
                scales: { x: baseAxis, y: baseAxis },
              }}
              data={{
                labels: d.purchaseVsConsumption.map((x: any) => x.d.slice(5)),
                datasets: [
                  { label: 'Purchases', data: d.purchaseVsConsumption.map((x: any) => x.purchase), backgroundColor: '#6366F1', borderRadius: 6 },
                  { label: 'Consumption', data: d.purchaseVsConsumption.map((x: any) => x.consumption), backgroundColor: '#38BDF8', borderRadius: 6 },
                ],
              }}
            />
          </div>
        </Card>
      </div>

      {/* Row 3: Tables */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card title="Customer Consumption & Frequent Visitors">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E9EDF7] text-left text-[11px] font-bold uppercase tracking-wider text-[#94A3B8] dark:border-[#2A3346]">
                  <th className="pb-2.5">Officer</th>
                  <th className="pb-2.5">Visits</th>
                  <th className="pb-2.5">Orders</th>
                  <th className="pb-2.5 text-right">Value</th>
                </tr>
              </thead>
              <tbody>
                {d.customers.map((c: any) => (
                  <tr key={c.id} className="border-b border-[#F4F7FE] last:border-0 dark:border-[#252D3D]">
                    <td className="py-2.5 font-bold text-[#1B2559] dark:text-[#E6EDF3]">{c.rank} {c.name}</td>
                    <td className="py-2.5 font-semibold text-[#94A3B8]">{c.visits}</td>
                    <td className="py-2.5 font-semibold text-[#94A3B8]">{c.orders}</td>
                    <td className="py-2.5 text-right font-extrabold text-[#422AFB] dark:text-[#818CF8]">{money(c.spent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Stock Alerts">
          <div className="max-h-72 space-y-2 overflow-auto text-sm">
            {d.alerts.length === 0 && <div className="py-6 text-center text-[#94A3B8]">All products healthy</div>}
            {d.alerts.map((p: any) => (
              <div key={p.id} className="flex items-center justify-between rounded-2xl bg-[#F4F7FE] px-3.5 py-2.5 dark:bg-[#252D3D]">
                <span className="font-bold text-[#1B2559] dark:text-[#E6EDF3]">{p.name}</span>
                <StockDot s={p.stock_status} label={`${p.stock_display} ${p.stock_unit}`} />
              </div>
            ))}
          </div>
        </Card>

        <Card title="Wastage, Complimentary & Discrepancies">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-2xl bg-[#F4F7FE] p-3.5 dark:bg-[#252D3D]">
              <div className="text-xs font-bold text-[#94A3B8]">Wastage</div>
              <div className="mt-1 text-xl font-extrabold text-[#F87171]">{money(d.losses.wastage)}</div>
            </div>
            <div className="rounded-2xl bg-[#F4F7FE] p-3.5 dark:bg-[#252D3D]">
              <div className="text-xs font-bold text-[#94A3B8]">Complimentary</div>
              <div className="mt-1 text-xl font-extrabold text-[#FBBF24]">{money(d.losses.complimentary)}</div>
            </div>
            <div className="rounded-2xl bg-[#F4F7FE] p-3.5 dark:bg-[#252D3D]">
              <div className="text-xs font-bold text-[#94A3B8]">Recon Shortage</div>
              <div className="mt-1 text-xl font-extrabold text-[#F87171]">{money(d.losses.shortage)}</div>
            </div>
            <div className="rounded-2xl bg-[#F4F7FE] p-3.5 dark:bg-[#252D3D]">
              <div className="text-xs font-bold text-[#94A3B8]">Recon Excess</div>
              <div className="mt-1 text-xl font-extrabold text-[#34D399]">{money(d.losses.excess)}</div>
            </div>
          </div>
          {d.discrepancies.length > 0 && (
            <div className="mt-3 rounded-xl bg-[#F4F7FE] p-2.5 text-xs font-medium text-[#94A3B8] dark:bg-[#252D3D]">
              Recent counts: {d.discrepancies.map((r: any) => `${r.product} (${r.diff > 0 ? '+' : ''}${r.diff})`).join(', ')}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
