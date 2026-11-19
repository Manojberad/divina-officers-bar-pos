import type { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes } from 'react';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

type BtnVariant = 'primary' | 'ghost' | 'danger' | 'success' | 'subtle';
export function Button({ variant = 'primary', size = 'md', className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm' | 'md' | 'lg' }) {
  const v = {
    primary: 'bg-[#422AFB] dark:bg-[#6366F1] text-white shadow-[0_6px_18px_rgba(99,102,241,0.25)] hover:bg-[#3311DB] dark:hover:bg-[#4F46E5]',
    ghost: 'border border-[#E0E5F2] text-[#1B2559] hover:bg-[#F4F7FE] dark:border-[#2E384D] dark:text-[#E6EDF3] dark:hover:bg-[#252D3D]',
    danger: 'bg-[#EE5D50] dark:bg-[#E05252] text-white shadow-[0_6px_16px_rgba(224,82,82,0.22)] hover:brightness-105',
    success: 'bg-[#01B574] dark:bg-[#10B981] text-white shadow-[0_6px_16px_rgba(16,185,129,0.22)] hover:brightness-105',
    subtle: 'bg-[#F4F7FE] text-[#1B2559] hover:bg-[#E9EDF7] dark:bg-[#252D3D] dark:text-[#E6EDF3] dark:hover:bg-[#2E384D]',
  }[variant];
  const s = { sm: 'px-3.5 py-1.5 text-xs min-h-9 rounded-xl', md: 'px-4 py-2.5 text-sm min-h-11 rounded-2xl', lg: 'px-6 py-3.5 text-base min-h-13 rounded-2xl' }[size];
  return <button {...p} className={cx('inline-flex items-center justify-center gap-2 font-bold tracking-tight transition-all duration-150 active:scale-[.98] disabled:opacity-50 disabled:pointer-events-none', v, s, className)} />;
}

export const Card = ({ children, className, title, actions }: { children: ReactNode; className?: string; title?: ReactNode; actions?: ReactNode }) => (
  <div className={cx('horizon-shadow rounded-[20px] border border-transparent bg-white p-5 dark:border-[#2A3346] dark:bg-[#1C2230]', className)}>
    {(title || actions) && (
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-bold tracking-tight text-[#1B2559] dark:text-[#E6EDF3]">{title}</h3>
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      </div>
    )}
    {children}
  </div>
);

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block text-sm">
      <span className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-[#1B2559] dark:text-[#94A3B8]">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-[#707EAE] dark:text-[#94A3B8]">{hint}</span>}
    </label>
  );
}
const inputCls = 'w-full rounded-2xl border border-[#E0E5F2] bg-white px-4 py-2.5 min-h-11 text-sm font-medium text-[#1B2559] placeholder:text-[#A3AED0] outline-none transition focus:border-[#422AFB] focus:ring-2 focus:ring-[#422AFB]/20 dark:border-[#2E384D] dark:bg-[#151A25] dark:text-[#E6EDF3] dark:placeholder:text-[#64748B] dark:focus:border-[#818CF8] dark:focus:ring-[#818CF8]/25';
export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cx(inputCls, p.className)} />;
export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={cx(inputCls, p.className)} />;
export const Textarea = (p: any) => <textarea {...p} className={cx(inputCls, p.className)} />;

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 backdrop-blur-xs p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className={cx('max-h-[92vh] w-full overflow-auto rounded-t-[24px] border border-transparent bg-white p-6 shadow-2xl dark:border-[#2E384D] dark:bg-[#1C2230] sm:rounded-[24px]', wide ? 'max-w-4xl' : 'max-w-lg')} onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-[#1B2559] dark:text-[#E6EDF3]">{title}</h2>
          <button onClick={onClose} className="rounded-xl bg-[#F4F7FE] px-3 py-1 text-xl leading-none text-[#1B2559] hover:bg-[#E9EDF7] dark:bg-[#252D3D] dark:text-[#E6EDF3] dark:hover:bg-[#2E384D]" aria-label="Close">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export const STATUS_STYLE: Record<string, string> = {
  draft: 'bg-[#F4F7FE] text-[#707EAE] dark:bg-[#252D3D] dark:text-[#94A3B8]',
  placed: 'bg-[#39B8FF]/15 text-[#0086D1] dark:bg-[#38BDF8]/15 dark:text-[#7DD3FC]',
  accepted: 'bg-[#422AFB]/15 text-[#422AFB] dark:bg-[#818CF8]/15 dark:text-[#A5B4FC]',
  preparing: 'bg-[#FFB547]/20 text-[#B86E00] dark:bg-[#FBBF24]/15 dark:text-[#FCD34D]',
  served: 'bg-[#01B574]/15 text-[#01B574] dark:bg-[#34D399]/15 dark:text-[#6EE7B7]',
  closed: 'bg-[#01B574]/15 text-[#01B574] dark:bg-[#34D399]/15 dark:text-[#6EE7B7]',
  cancelled: 'bg-[#EE5D50]/15 text-[#EE5D50] dark:bg-[#F87171]/15 dark:text-[#FCA5A5]',
  disputed: 'bg-fuchsia-500/15 text-fuchsia-600 dark:bg-fuchsia-400/15 dark:text-fuchsia-300',
  pending: 'bg-[#FFB547]/20 text-[#B86E00] dark:bg-[#FBBF24]/15 dark:text-[#FCD34D]',
  approved: 'bg-[#01B574]/15 text-[#01B574] dark:bg-[#34D399]/15 dark:text-[#6EE7B7]',
  expired: 'bg-[#F4F7FE] text-[#707EAE] dark:bg-[#252D3D] dark:text-[#94A3B8]',
};
export const Badge = ({ s, children }: { s: string; children?: ReactNode }) => (
  <span className={cx('inline-block rounded-full px-3 py-0.5 text-xs font-bold capitalize', STATUS_STYLE[s] || STATUS_STYLE.draft)}>{children ?? s}</span>
);

export const STOCK_COLORS: Record<string, string> = { healthy: 'bg-[#10B981]', low: 'bg-[#FBBF24]', critical: 'bg-[#F87171]', out: 'bg-[#94A3B8]' };
export const StockDot = ({ s, label }: { s: string; label?: string }) => (
  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#1B2559] dark:text-[#E6EDF3]">
    <span className={cx('h-2.5 w-2.5 rounded-full', STOCK_COLORS[s])} />{label ?? s}
  </span>
);

export const Empty = ({ children }: { children: ReactNode }) => <div className="py-10 text-center text-sm font-medium text-[#94A3B8]">{children}</div>;

export const fmtDate = (s?: string | null) => (s ? new Date(s).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : '—');
export const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
export const daysAgo = (n: number) => new Date(Date.now() - n * 86400e3 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

export function DateRange({ from, to, onChange }: { from: string; to: string; onChange: (f: string, t: string) => void }) {
  const presets: [string, () => [string, string]][] = [
    ['Today', () => [today(), today()]], ['7 days', () => [daysAgo(6), today()]], ['30 days', () => [daysAgo(29), today()]],
    ['This month', () => [today().slice(0, 8) + '01', today()]],
  ];
  return (
    <div className="flex flex-wrap items-center gap-2">
      {presets.map(([l, f]) => <Button key={l} size="sm" variant="subtle" onClick={() => onChange(...f())}>{l}</Button>)}
      <Input type="date" value={from} onChange={(e) => onChange(e.target.value, to)} className="!w-auto !min-h-9 !py-1.5 !text-xs" />
      <span className="text-[#94A3B8]">–</span>
      <Input type="date" value={to} onChange={(e) => onChange(from, e.target.value)} className="!w-auto !min-h-9 !py-1.5 !text-xs" />
    </div>
  );
}
