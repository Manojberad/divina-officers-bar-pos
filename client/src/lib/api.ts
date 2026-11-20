// API client with IndexedDB read-cache and an offline order queue.
// Orders carry a client_uuid; the server de-duplicates on it so replays are safe.

const DB_NAME = 'divinabar';
let dbp: Promise<IDBDatabase> | null = null;
function idb(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore('cache');
        r.result.createObjectStore('queue', { keyPath: 'client_uuid' });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  return dbp;
}
async function store<T>(name: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const d = await idb();
  return new Promise((resolve, reject) => {
    const req = fn(d.transaction(name, mode).objectStore(name));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}
export const cacheGet = (k: string) => store<any>('cache', 'readonly', (s) => s.get(k)).catch(() => undefined);
export const cacheSet = (k: string, v: any) => store('cache', 'readwrite', (s) => s.put(v, k)).catch(() => undefined);
export const queueAll = () => store<any[]>('queue', 'readonly', (s) => s.getAll()).catch(() => [] as any[]);
const queuePut = (v: any) => store('queue', 'readwrite', (s) => s.put(v));
const queueDel = (k: string) => store('queue', 'readwrite', (s) => s.delete(k));

export function uuid() {
  if (typeof globalThis.crypto?.randomUUID === 'function') try { return crypto.randomUUID(); } catch { /* insecure context */ }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/* ---------- connection status ---------- */
type Listener = () => void;
const listeners = new Set<Listener>();
export const conn = { online: true, queued: 0 };
const emit = () => listeners.forEach((l) => l());
export const onConn = (l: Listener) => { listeners.add(l); return () => { listeners.delete(l); }; };
function setOnline(v: boolean) { if (conn.online !== v) { conn.online = v; emit(); if (v) flushQueue(); } }

export const getToken = () => localStorage.getItem('token');
export const setToken = (t: string | null) => (t ? localStorage.setItem('token', t) : localStorage.removeItem('token'));

export class ApiError extends Error { status: number; constructor(s: number, m: string) { super(m); this.status = s; } }

export async function api<T = any>(path: string, opts: { method?: string; body?: any; cache?: boolean; raw?: boolean } = {}): Promise<T> {
  const method = opts.method || 'GET';
  const headers: Record<string, string> = {};
  const t = getToken();
  if (t) headers.Authorization = `Bearer ${t}`;
  let body: any;
  if (opts.body instanceof FormData) body = opts.body;
  else if (opts.body !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(opts.body); }
  const cacheKey = `${t ? t.slice(-12) : 'anon'}:${path}`;
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { method, headers, body });
    setOnline(true);
  } catch (e) {
    setOnline(false);
    if (method === 'GET' && opts.cache !== false) {
      const c = await cacheGet(cacheKey);
      if (c !== undefined) return c;
    }
    throw new ApiError(0, 'Server unreachable – working offline');
  }
  if (opts.raw) return res as any;
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  if (!res.ok) {
    if (res.status === 401 && t) { setToken(null); window.dispatchEvent(new Event('auth:logout')); }
    throw new ApiError(res.status, (data as any)?.error || res.statusText);
  }
  if (method === 'GET' && opts.cache !== false) cacheSet(cacheKey, data);
  return data as T;
}

/** Place order; queue locally if the server cannot be reached. */
export async function placeOrder(order: any): Promise<{ queued?: boolean; order?: any }> {
  const payload = { ...order, client_uuid: order.client_uuid || uuid() };
  try {
    const o = await api('/orders', { method: 'POST', body: payload });
    return { order: o };
  } catch (e) {
    if (e instanceof ApiError && e.status === 0) {
      await queuePut({ ...payload, _token: getToken(), _at: new Date().toISOString() });
      await refreshQueued();
      return { queued: true };
    }
    throw e;
  }
}

async function refreshQueued() { conn.queued = (await queueAll()).length; emit(); }

let flushing = false;
export async function flushQueue() {
  if (flushing) return;
  flushing = true;
  try {
    for (const item of await queueAll()) {
      const { _token, _at, ...payload } = item;
      try {
        const res = await fetch('/api/orders', {
          method: 'POST', headers: { 'Content-Type': 'application/json', ...(_token ? { Authorization: `Bearer ${_token}` } : {}) },
          body: JSON.stringify({ ...payload, notes: [payload.notes, `(queued offline ${new Date(_at).toLocaleTimeString()})`].filter(Boolean).join(' ') }),
        });
        setOnline(true);
        if (res.ok || (res.status >= 400 && res.status < 500)) {
          // 4xx = permanently rejected (e.g. out of stock) – drop and inform
          if (!res.ok) { const j = await res.json().catch(() => ({})); window.dispatchEvent(new CustomEvent('toast', { detail: { type: 'error', text: `Queued order rejected: ${j.error || res.status}` } })); }
          else window.dispatchEvent(new CustomEvent('toast', { detail: { type: 'ok', text: 'Offline order synced' } }));
          await queueDel(item.client_uuid);
        }
      } catch { setOnline(false); break; }
    }
  } finally { flushing = false; await refreshQueued(); }
}

refreshQueued();
setInterval(() => { if (conn.queued) flushQueue(); else fetch('/api/health').then(() => setOnline(true)).catch(() => setOnline(false)); }, 15000);
window.addEventListener('online', () => flushQueue());

export async function download(path: string, filename: string) {
  const res = await api<Response>(path, { raw: true });
  if (!res.ok) { const j = await res.json().catch(() => ({})); throw new ApiError(res.status, j.error || 'Download failed'); }
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/** Live updates via Server-Sent Events. */
export function subscribe(handler: (event: string, data: any) => void) {
  const t = getToken();
  const es = new EventSource(`/api/events${t ? `?token=${encodeURIComponent(t)}` : ''}`);
  ['order', 'notification', 'settings', 'guest_request'].forEach((ev) => es.addEventListener(ev, (e: any) => handler(ev, JSON.parse(e.data || '{}'))));
  return () => es.close();
}
