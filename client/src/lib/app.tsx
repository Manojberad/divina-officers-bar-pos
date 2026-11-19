import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, setToken, getToken } from './api';

export type Role = 'admin' | 'member' | 'bartender' | 'customer' | 'guest';
export interface User { id: number; name: string; service_no: string; rank?: string; role: Role; category: string; approval_status?: string; must_change_pin?: number }
export interface Settings { bar_name: string; currency: string; logo: string; background: string; theme: string; accent: string; peg_sizes: string; approval_hours: string; bar_address?: string; bar_phone?: string; lan?: string[]; port?: number }

interface Ctx {
  user: User | null; ready: boolean; settings: Settings;
  login: (pinOrSn: string, pin?: string, mode?: 'member' | 'admin' | 'guest') => Promise<User>; logout: () => void;
  reloadSettings: () => Promise<void>; dark: boolean; toggleDark: () => void;
  toast: (text: string, type?: 'ok' | 'error') => void; money: (n: number) => string;
}
const AppCtx = createContext<Ctx>(null as any);
export const useApp = () => useContext(AppCtx);

const DEFAULTS: Settings = { bar_name: "DIVINA OFFICERS' BAR", currency: '₹', logo: '/Login_logo.png', background: '/Login_bg.webp', theme: 'dark', accent: '#f59e0b', peg_sizes: '30,60', approval_hours: '24' };

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

  useEffect(() => {
    reloadSettings();
    const t = getToken();
    const cached = localStorage.getItem('user');
    if (t && cached) setUser(JSON.parse(cached));
    if (t) api<User>('/auth/me').then((u) => { setUser(u); localStorage.setItem('user', JSON.stringify(u)); }).catch(() => {}).finally(() => setReady(true));
    else setReady(true);
    const onLogout = () => { setUser(null); localStorage.removeItem('user'); };
    const onToast = (e: any) => toast(e.detail.text, e.detail.type);
    window.addEventListener('auth:logout', onLogout);
    window.addEventListener('toast', onToast);
    return () => { window.removeEventListener('auth:logout', onLogout); window.removeEventListener('toast', onToast); };
  }, [reloadSettings, toast]);

  useEffect(() => { document.documentElement.classList.toggle('dark', dark); }, [dark]);
  useEffect(() => { document.documentElement.style.setProperty('--accent', settings.accent || '#f59e0b'); document.title = `${settings.bar_name} · POS`; }, [settings]);

  const login = async (service_no: string, pin?: string, mode?: 'member' | 'admin' | 'guest') => {
    const body = pin !== undefined ? { service_no, pin, mode } : { pin: service_no, mode };
    const r = await api<{ token: string; user: User }>('/auth/login', { method: 'POST', body });
    setToken(r.token);
    localStorage.setItem('user', JSON.stringify(r.user));
    setUser(r.user);
    return r.user;
  };
  const logout = () => { setToken(null); localStorage.removeItem('user'); setUser(null); };
  const toggleDark = () => setDark((d) => { localStorage.setItem('theme', d ? 'light' : 'dark'); return !d; });
  const money = (n: number) => `${settings.currency}${(Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

  return (
    <AppCtx.Provider value={{ user, ready, settings, login, logout, reloadSettings, dark, toggleDark, toast, money }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} className={`rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg ${t.type === 'error' ? 'bg-red-600' : 'bg-emerald-600'}`}>{t.text}</div>
        ))}
      </div>
    </AppCtx.Provider>
  );
}
