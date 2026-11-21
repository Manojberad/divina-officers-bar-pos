import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, setToken, getToken } from './api';

export type Role =
  | 'superadmin'
  | 'commanding_officer'
  | 'mess_secretary'
  | 'bar_incharge'
  | 'admin'
  | 'member'
  | 'bartender'
  | 'customer'
  | 'guest';

export const PRIVILEGED_OFFICER_ROLES: Role[] = ['commanding_officer', 'mess_secretary', 'bar_incharge'];
export const ADMIN_ROLES: Role[] = ['superadmin', 'admin', ...PRIVILEGED_OFFICER_ROLES];
export const STAFF_ROLES: Role[] = [...ADMIN_ROLES, 'bartender'];

export const ROLE_LABELS: Record<string, string> = {
  superadmin: 'Super Admin',
  commanding_officer: 'Commanding Officer',
  mess_secretary: 'Mess Secretary',
  bar_incharge: 'Bar Incharge',
  admin: 'Admin',
  bartender: 'Bartender',
  member: 'Mess Member',
  customer: 'TD Officer',
  guest: 'Guest',
};

export const roleLabel = (r?: string | null) => (r ? ROLE_LABELS[r] || r : '');
export const isSuperAdmin = (u?: { role?: string } | null) => u?.role === 'superadmin';
export const isAdminRole = (r?: string | null) => !!r && ADMIN_ROLES.includes(r as Role);
export const isStaffRole = (r?: string | null) => !!r && STAFF_ROLES.includes(r as Role);

export interface AlcoholUsage { limit: number; used: number; remaining: number | null; scope: 'day' | 'order'; unit: 'pegs' | 'small_eq' }
export interface User { id: number; name: string; service_no: string; rank?: string; branch?: string | null; tors?: string | null; role: Role; designation?: string; category: string; approval_status?: string; alcohol_limit?: number | null; alcohol_usage?: AlcoholUsage; td_start_date?: string | null; td_end_date?: string | null; must_change_pin?: number }
export interface Settings {
  bar_name: string; currency: string; logo: string; background: string; theme: string; accent: string; peg_sizes: string; approval_hours: string;
  guest_alcohol_limit?: string; member_alcohol_limit?: string; alcohol_limit_scope?: string; alcohol_limit_unit?: string;
  bar_address?: string; bar_phone?: string; lan?: string[]; port?: number;
}

interface Ctx {
  user: User | null; ready: boolean; settings: Settings;
  login: (pinOrSn: string, pin?: string, mode?: 'member' | 'admin' | 'guest', remember?: boolean) => Promise<User>;
  establishSession: (token: string, user: User) => Promise<void>;
  logout: () => void;
  reloadUser: () => Promise<void>;
  reloadSettings: () => Promise<void>; dark: boolean; toggleDark: () => void;
  toast: (text: string, type?: 'ok' | 'error') => void; money: (n: number) => string;
}
const AppCtx = createContext<Ctx>(null as any);
export const useApp = () => useContext(AppCtx);

const DEFAULTS: Settings = {
  bar_name: "DIVINA OFFICERS' BAR", currency: '₹', logo: '/Login_logo.png', background: '/Login_bg.webp', theme: 'dark', accent: '#f59e0b',
  peg_sizes: '30,60', approval_hours: '24', guest_alcohol_limit: '3', member_alcohol_limit: '0', alcohol_limit_scope: 'day', alcohol_limit_unit: 'pegs',
};

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [dark, setDark] = useState(() => (localStorage.getItem('theme') || 'dark') === 'dark');
  const [toasts, setToasts] = useState<{ id: number; text: string; type: string }[]>([]);

  const toast = useCallback((text: string, type: 'ok' | 'error' = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);

  const reloadSettings = useCallback(async () => {
    try {
      const s = await api<Settings>('/admin/settings/public');
      setSettings({ ...DEFAULTS, ...s });
      if (!localStorage.getItem('theme')) setDark(s.theme !== 'light');
    } catch { /* offline: keep defaults / cache */ }
  }, []);

  const reloadUser = useCallback(async () => {
    if (!getToken()) return;
    try {
      const u = await api<User>('/auth/me', { cache: false });
      setUser(u);
      localStorage.setItem('user', JSON.stringify(u));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    reloadSettings();
    const t = getToken();
    const cached = localStorage.getItem('user');
    if (t && cached) setUser(JSON.parse(cached));
    if (t) api<User>('/auth/me', { cache: false }).then((u) => { setUser(u); localStorage.setItem('user', JSON.stringify(u)); }).catch(() => {}).finally(() => setReady(true));
    else setReady(true);
    const onLogout = () => { setUser(null); localStorage.removeItem('user'); };
    const onToast = (e: any) => toast(e.detail.text, e.detail.type);
    window.addEventListener('auth:logout', onLogout);
    window.addEventListener('toast', onToast);
    return () => { window.removeEventListener('auth:logout', onLogout); window.removeEventListener('toast', onToast); };
  }, [reloadSettings, toast]);

  useEffect(() => { document.documentElement.classList.toggle('dark', dark); }, [dark]);
  useEffect(() => { document.documentElement.style.setProperty('--accent', settings.accent || '#f59e0b'); document.title = settings.bar_name || 'DivinaBar'; }, [settings]);

  const login = async (service_no: string, pin?: string, mode?: 'member' | 'admin' | 'guest', remember = true) => {
    const body = pin !== undefined ? { service_no, pin, mode, remember } : { pin: service_no, mode, remember };
    const r = await api<{ token: string; user: User }>('/auth/login', { method: 'POST', body });
    setToken(r.token);
    localStorage.setItem('user', JSON.stringify(r.user));
    setUser(r.user);
    reloadUser();
    // Prompt Android Chrome / compatible browsers to save credentials to Password Manager
    try {
      const w = window as any;
      if (remember && pin && w.PasswordCredential && navigator.credentials?.store) {
        const cred = new w.PasswordCredential({
          id: r.user.service_no || service_no,
          password: pin,
          name: `${r.user.rank ? `${r.user.rank} ` : ''}${r.user.name}`,
        });
        navigator.credentials.store(cred).catch(() => {});
      }
    } catch { /* ignore on unsupported browsers */ }
    return r.user;
  };
  const establishSession = useCallback(async (token: string, u: User) => {
    setToken(token);
    localStorage.setItem('user', JSON.stringify(u));
    setUser(u);
    try {
      const fresh = await api<User>('/auth/me', { cache: false });
      setUser(fresh);
      localStorage.setItem('user', JSON.stringify(fresh));
    } catch { /* keep provided user */ }
  }, []);

  const logout = () => {
    const t = getToken();
    if (t) {
      fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${t}` }, cache: 'no-store' }).catch(() => {});
    }
    setToken(null);
    localStorage.removeItem('user');
    setUser(null);
  };
  const toggleDark = () => setDark((d) => { localStorage.setItem('theme', d ? 'light' : 'dark'); return !d; });
  const money = (n: number) => `${settings.currency}${(Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

  return (
    <AppCtx.Provider value={{ user, ready, settings, login, establishSession, logout, reloadUser, reloadSettings, dark, toggleDark, toast, money }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} className={`rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg ${t.type === 'error' ? 'bg-red-600' : 'bg-emerald-600'}`}>{t.text}</div>
        ))}
      </div>
    </AppCtx.Provider>
  );
}
