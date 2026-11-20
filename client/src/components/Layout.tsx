import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useApp, type Role, ADMIN_ROLES, STAFF_ROLES, PRIVILEGED_OFFICER_ROLES, isAdminRole, isStaffRole, roleLabel } from '../lib/app';
import { api, conn, onConn, subscribe } from '../lib/api';
import { Badge, Button, Input, Modal, cx, fmtDate } from './ui';

const ICONS: Record<string, ReactNode> = {
  '/dashboard': <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5"><path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z" /></svg>,
  '/bar': <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 14H6v-2h6v2zm4-4H6v-2h10v2zm0-4H6V7h10v2z" /></svg>,
  '/orders': <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5"><path d="M19 3h-4.18C14.4 1.84 13.3 1 12 1s-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm2 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z" /></svg>,
  '/order': <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5"><path d="M21 5V3H3v2l8 9v5H6v2h12v-2h-5v-5l8-9zM7.43 7 5.66 5h12.69l-1.78 2H7.43z" /></svg>,
  '/favorite-orders': <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" /></svg>,
  '/my-orders': <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z" /></svg>,
  '/inventory': <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5"><path d="M20 2H4c-1 0-2 .9-2 2v3.01c0 .72.43 1.34 1 1.69V20c0 1.1 1.1 2 2 2h14c.9 0 2-.9 2-2V8.7c.57-.35 1-.97 1-1.69V4c0-1.1-1-2-2-2zm-5 12H9v-2h6v2zm5-7H4V4h16v3z" /></svg>,
  '/products': <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5"><path d="M12 2 4 5v6.09c0 5.05 3.41 9.76 8 10.91 4.59-1.15 8-5.86 8-10.91V5l-8-3zm1 14h-2v-2h2v2zm0-4h-2V7h2v5z" /></svg>,
  '/users': <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" /></svg>,
  '/tables': <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5"><path d="M3 11h8V3H3v8zm2-6h4v4H5V5zM3 21h8v-8H3v8zm2-6h4v4H5v-4zM13 3v8h8V3h-8zm6 6h-4V5h4v4zM13 13h2v2h-2v-2zm2 2h2v2h-2v-2zm2-2h2v2h-2v-2zm2 2h2v2h-2v-2zm-2 2h2v2h-2v-2zm0 2h2v2h-2v-2zm-4-2h2v2h-2v-2zm0 2h2v2h-2v-2zm6 0h2v2h-2v-2z" /></svg>,
  '/reports': <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z" /></svg>,
  '/settings': <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" /></svg>,
};

const NAV: { to: string; label: string; short: string; roles: Role[] }[] = [
  { to: '/dashboard', label: 'Main Dashboard', short: 'Home', roles: ADMIN_ROLES },
  { to: '/bar', label: 'Products', short: 'Products', roles: STAFF_ROLES },
  { to: '/orders', label: 'Orders Board', short: 'Orders', roles: STAFF_ROLES },
  { to: '/order', label: 'Bar Menu', short: 'Menu', roles: ['member', 'customer', 'guest'] },
  { to: '/favorite-orders', label: 'Favorite Orders', short: 'Favs', roles: ['member', 'customer', 'guest', ...PRIVILEGED_OFFICER_ROLES, 'superadmin'] },
  { to: '/my-orders', label: 'My Orders', short: 'Orders', roles: ['member', 'customer', 'guest', ...PRIVILEGED_OFFICER_ROLES, 'superadmin'] },
  { to: '/inventory', label: 'Inventory & Stock', short: 'Stock', roles: STAFF_ROLES },
  { to: '/products', label: 'Products & Pricing', short: 'Pricing', roles: ADMIN_ROLES },
  { to: '/users', label: 'Officers & Users', short: 'Users', roles: ADMIN_ROLES },
  { to: '/tables', label: 'Tables & QR Codes', short: 'Tables', roles: ADMIN_ROLES },
  { to: '/reports', label: 'Reports & Exports', short: 'Reports', roles: ADMIN_ROLES },
  { to: '/settings', label: 'Admin Settings', short: 'Settings', roles: ADMIN_ROLES },
];

export default function Layout() {
  const { user, logout, settings, dark, toggleDark, reloadSettings, toast } = useApp();
  const nav = useNavigate();
  const loc = useLocation();
  const isStaff = isStaffRole(user?.role);
  const designation = user?.designation || roleLabel(user?.role);
  const showDesignationPill = !!user && (isAdminRole(user.role) || user.role === 'bartender');

  const [c, setC] = useState({ ...conn });
  const [notes, setNotes] = useState<any[]>([]);
  const [showNotes, setShowNotes] = useState(false);
  const [showMobileNotes, setShowMobileNotes] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [guestReqs, setGuestReqs] = useState<any[]>([]);
  const [showGuestModal, setShowGuestModal] = useState(false);
  const [guestLimits, setGuestLimits] = useState<Record<number, string>>({});

  useEffect(() => onConn(() => setC({ ...conn })), []);
  const loadNotes = () => api('/admin/notifications', { cache: false }).then(setNotes).catch(() => {});
  const loadGuestReqs = () => isStaff && api('/users/guest-requests', { cache: false }).then(setGuestReqs).catch(() => {});

  useEffect(() => {
    loadNotes();
    loadGuestReqs();
    const timer = setInterval(() => { loadNotes(); loadGuestReqs(); }, 20000);
    const unsub = subscribe((ev, d) => {
      if (ev === 'notification') loadNotes();
      if (ev === 'settings') reloadSettings();
      if (ev === 'guest_request') {
        loadGuestReqs();
        if (isStaff && d?.approval_status === 'pending') {
          toast('🪪 New Guest registration awaiting approval!');
        }
      }
    });
    return () => { clearInterval(timer); unsub(); };
  }, [isStaff]);
  useEffect(() => { setDrawerOpen(false); }, [loc.pathname]);

  const unread = notes.filter((n) => !n.read).length;
  const pendingGuests = guestReqs.filter((g) => g.approval_status === 'pending');
  const mobileAlertCount = unread + (isStaff ? pendingGuests.length : 0);

  const items = NAV.filter((n) => {
    if (!user || !n.roles.includes(user.role)) return false;
    if ((n.to === '/my-orders' || n.to === '/favorite-orders') && user.role === 'superadmin' && user.category === 'STAFF') return false;
    return true;
  });

  // Bottom bar shows up to 5 clean, non-scrolling tabs on mobile/tablet; full menu is in Hamburger drawer
  const bottomItems = items.slice(0, 5);
  const currentTitle = items.find((i) => loc.pathname.startsWith(i.to))?.label || (loc.pathname === '/account' ? 'Profile & PIN' : settings.bar_name);
  const initials = (user?.name || 'U').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

  const handleGuestDecision = async (g: any, action: 'approve' | 'reject') => {
    try {
      const customLimit = guestLimits[g.id];
      await api(`/users/${g.id}/approve-guest`, {
        method: 'POST',
        body: { action, ...(customLimit !== undefined && customLimit !== '' ? { alcohol_limit: Number(customLimit) } : {}) },
      });
      toast(action === 'approve' ? `✔ Approved guest ${g.rank} ${g.name} (Admin notified)` : `Declined guest ${g.name}`);
      loadGuestReqs();
      loadNotes();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const openMobileNotifications = () => {
    setDrawerOpen(false);
    setShowMobileNotes(true);
    if (unread) api('/admin/notifications/read', { method: 'POST' }).then(loadNotes);
  };

  const SidebarContent = (
    <div className="flex h-full flex-col bg-white dark:bg-[#1C2230]">
      {/* Brand Header */}
      <div className="flex items-center justify-between gap-2 px-5 pb-4 pt-[max(1.25rem,env(safe-area-inset-top))] xl:px-6 xl:pb-6 xl:pt-7">
        <div className="flex min-w-0 items-center gap-3">
          <img src={settings.logo || '/Login_logo.png'} className="h-10 w-10 shrink-0 rounded-xl object-contain xl:h-11 xl:w-11" alt="" />
          <div className="min-w-0">
            <div className="font-ubuntu truncate text-sm font-bold tracking-tight text-[#1B2559] dark:text-[#E6EDF3] xl:text-base">
              {settings.bar_name || "DIVINA OFFICERS' BAR"}
            </div>
            <div className="text-[10px] font-semibold uppercase tracking-widest text-[#94A3B8]">DivinaBar</div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setDrawerOpen(false)}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#F4F7FE] text-lg font-bold text-[#1B2559] dark:bg-[#252D3D] dark:text-[#E6EDF3] xl:hidden"
          aria-label="Close menu"
        >
          ×
        </button>
      </div>

      {/* Mobile-ONLY Quick Controls (Status, Notifications, Theme Mode, Guest Requests) inside Hamburger Menu */}
      <div className="mx-4 mb-3 space-y-2 rounded-2xl bg-[#F4F7FE] p-2.5 dark:bg-[#252D3D] md:hidden">
        <div className="flex items-center justify-between px-1">
          <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold', c.online ? 'bg-[#10B981]/15 text-[#10B981]' : 'bg-[#F87171]/15 text-[#F87171]')}>
            <span className={cx('h-2 w-2 rounded-full', c.online ? 'bg-[#10B981]' : 'bg-[#F87171]')} />
            {c.online ? 'Connected' : 'Offline'}{c.queued ? ` (${c.queued})` : ''}
          </span>
          <button
            type="button"
            onClick={toggleDark}
            className="inline-flex items-center gap-1.5 rounded-xl bg-white px-2.5 py-1 text-xs font-bold text-[#1B2559] shadow-xs dark:bg-[#1C2230] dark:text-[#E6EDF3]"
          >
            <span>{dark ? '☀️ Light' : '🌙 Dark'}</span>
          </button>
        </div>
        <div className="grid grid-cols-1 gap-1.5">
          <button
            type="button"
            onClick={openMobileNotifications}
            className="flex w-full items-center justify-between rounded-xl bg-white px-3 py-2 text-xs font-bold text-[#1B2559] shadow-xs dark:bg-[#1C2230] dark:text-[#E6EDF3]"
          >
            <span className="flex items-center gap-2">🔔 Notifications</span>
            {unread > 0 ? (
              <span className="rounded-full bg-[#F87171] px-2 py-0.5 text-[10px] font-extrabold text-white">{unread} new</span>
            ) : (
              <span className="text-[11px] text-[#94A3B8]">{notes.length}</span>
            )}
          </button>
          {isStaff && pendingGuests.length > 0 && (
            <button
              type="button"
              onClick={() => { setDrawerOpen(false); loadGuestReqs(); setShowGuestModal(true); }}
              className="flex w-full items-center justify-between rounded-xl bg-[#FBBF24] px-3 py-2 text-xs font-extrabold text-[#1B2559]"
            >
              <span>🪪 Guest Requests</span>
              <span>{pendingGuests.length}</span>
            </button>
          )}
        </div>
      </div>

      <div className="mx-5 mb-3 h-px bg-[#E9EDF7] dark:bg-[#2A3346] xl:mx-6 xl:mb-4" />

      {/* Nav Links */}
      <div className="flex-1 space-y-1 overflow-y-auto pl-5 pr-0 xl:pl-6">
        {items.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            className={({ isActive }) =>
              cx(
                'group relative flex items-center gap-3.5 py-2.5 pr-4 text-sm transition-colors xl:py-3',
                isActive ? 'font-bold text-[#1B2559] dark:text-[#E6EDF3]' : 'font-medium text-[#707EAE] hover:text-[#1B2559] dark:text-[#94A3B8] dark:hover:text-[#E6EDF3]',
              )
            }
          >
            {({ isActive }) => (
              <>
                <span className={cx('transition-colors', isActive ? 'text-[#422AFB] dark:text-[#818CF8]' : 'text-[#94A3B8] group-hover:text-[#422AFB] dark:group-hover:text-[#818CF8]')}>
                  {ICONS[n.to]}
                </span>
                <span className="truncate">{n.label}</span>
                {n.to === '/orders' && pendingGuests.length > 0 && (
                  <span className="ml-auto mr-2 rounded-full bg-[#FBBF24] px-2 py-0.5 text-[10px] font-extrabold text-[#1B2559]">
                    {pendingGuests.length}
                  </span>
                )}
                {isActive && <span className="absolute right-0 top-1/2 h-8 w-1 -translate-y-1/2 rounded-l-full bg-[#422AFB] dark:bg-[#818CF8]" />}
              </>
            )}
          </NavLink>
        ))}

        {/* Quick Guest Approvals trigger in sidebar for Bartender & Admin */}
        {isStaff && (
          <button
            type="button"
            onClick={() => { setDrawerOpen(false); loadGuestReqs(); setShowGuestModal(true); }}
            className="group relative flex w-full items-center gap-3.5 py-2.5 pr-4 text-left text-sm font-medium text-[#707EAE] transition-colors hover:text-[#1B2559] dark:text-[#94A3B8] dark:hover:text-[#E6EDF3] xl:py-3"
          >
            <span className="text-[#94A3B8] group-hover:text-[#422AFB] dark:group-hover:text-[#818CF8]">
              <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm-7 7v-1c0-2.66 5.33-4 7-4 .36 0 .74.02 1.13.06-.08.31-.13.62-.13.94 0 1.66 1.01 3.09 2.45 3.71-.91.19-1.91.29-2.95.29H5zm14.5-1.5-2.5 2.5-1.5-1.5 1-1 .5.5 1.5-1.5 1 1z" /></svg>
            </span>
            <span className="truncate">Guest Approvals</span>
            {pendingGuests.length > 0 && (
              <span className="ml-auto mr-2 rounded-full bg-[#FBBF24] px-2 py-0.5 text-[10px] font-extrabold text-[#1B2559]">
                {pendingGuests.length}
              </span>
            )}
          </button>
        )}
      </div>

      {/* Officer Profile Card at Bottom */}
      <div className="p-4 pb-[max(1.5rem,calc(env(safe-area-inset-bottom)+1rem))] xl:p-5">
        <div className="horizon-gradient relative overflow-hidden rounded-[20px] p-4 text-white shadow-lg">
          <div className="relative z-10 flex items-center gap-3">
            <button onClick={() => { setDrawerOpen(false); nav('/account'); }} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/20 text-sm font-extrabold backdrop-blur-xs">
              {initials}
            </button>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-bold">{user?.rank ? `${user.rank} ` : ''}{user?.name}</div>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                <span className={cx(
                  'inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-extrabold tracking-wide',
                  isAdminRole(user?.role) ? 'bg-[#FBBF24] text-[#1B2559]' : 'bg-white/20 text-white',
                )}>
                  {isAdminRole(user?.role) ? `★ ${designation}` : designation}
                </span>
                <span className="truncate text-[11px] text-white/80">{user?.service_no}</span>
              </div>
            </div>
          </div>
          <div className="relative z-10 mt-3 flex gap-2">
            <button onClick={() => { setDrawerOpen(false); nav('/account'); }} className="flex-1 rounded-xl bg-white/20 py-1.5 text-xs font-bold backdrop-blur-xs transition hover:bg-white/30">
              Account
            </button>
            <button onClick={() => { setDrawerOpen(false); logout(); nav('/login'); }} className="flex-1 rounded-xl bg-black/25 py-1.5 text-xs font-bold transition hover:bg-black/40">
              Logout
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-[100dvh] w-full max-w-full overflow-hidden bg-[#F4F7FE] text-[#1B2559] dark:bg-[#131722] dark:text-[#E6EDF3]">
      {/* Desktop Fixed Sidebar */}
      <aside className="no-print hidden w-[275px] shrink-0 border-r border-[#E9EDF7] dark:border-[#262E40] xl:block">
        {SidebarContent}
      </aside>

      {/* Mobile / Tablet Slide-Over Hamburger Drawer (portaled to body so iOS Safari never hides it behind bottom navbar) */}
      {drawerOpen && typeof document !== 'undefined' && createPortal(
        <div className="no-print fixed inset-0 z-[70] flex xl:hidden">
          <div className="fixed inset-0 bg-black/55 backdrop-blur-xs" onClick={() => setDrawerOpen(false)} />
          <div className="relative z-10 h-full w-[300px] max-w-[85vw] shadow-2xl">
            {SidebarContent}
          </div>
        </div>,
        document.body,
      )}

      {/* Main Content Area */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {/* Top Navbar: Ultra-compact Hamburger Header on Mobile, Full Pill Toolbar on Tablet & Desktop */}
        <header className="no-print z-30 mx-2 mt-[max(0.5rem,env(safe-area-inset-top))] flex shrink-0 items-center justify-between gap-2 rounded-2xl bg-white/90 px-3 py-2 backdrop-blur-xl dark:bg-[#1C2230]/90 md:mx-5 md:mt-3 md:bg-white/80 md:px-4 md:py-3 md:dark:bg-[#131722]/80">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {/* Compact Live Dot on Mobile */}
            <span className={cx('h-2.5 w-2.5 shrink-0 rounded-full md:hidden', c.online ? 'bg-[#10B981]' : 'bg-[#F87171]')} title={c.online ? 'Connected' : 'Offline'} />
            <div className="min-w-0">
              <div className="hidden text-xs font-medium text-[#707EAE] dark:text-[#94A3B8] md:block">
                Pages <span className="mx-1">/</span> <span className="font-semibold text-[#1B2559] dark:text-[#E6EDF3]">{currentTitle}</span>
              </div>
              <div className="flex items-center gap-2">
                <h1 className="truncate text-base font-extrabold tracking-tight text-[#1B2559] dark:text-[#E6EDF3] md:text-2xl">
                  {currentTitle}
                </h1>
                {showDesignationPill && (
                  <span className="hidden items-center gap-1 rounded-full bg-gradient-to-r from-[#D97706] to-[#F59E0B] px-2.5 py-0.5 text-[11px] font-extrabold text-white shadow-xs md:inline-flex">
                    {isAdminRole(user?.role) && '★ '}{designation}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* MOBILE-ONLY: Single Space-Saving Hamburger Button (contains Notifications, Account, Color Mode, Navigation) */}
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#F4F7FE] text-[#1B2559] transition active:scale-95 dark:bg-[#252D3D] dark:text-[#E6EDF3] md:hidden"
            aria-label="Open menu"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" className="h-5 w-5">
              <path strokeLinecap="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
            {mobileAlertCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#EE5D50] px-1 text-[10px] font-extrabold text-white shadow-xs">
                {mobileAlertCount}
              </span>
            )}
          </button>

          {/* TABLET & WEB ONLY: Full Right Pill Toolbar */}
          <div className="horizon-pill-shadow hidden shrink-0 items-center gap-2 rounded-full border border-transparent bg-white px-3 py-2 dark:border-[#2A3346] dark:bg-[#1C2230] md:flex">
            {/* Tablet Menu Toggle (md to xl) */}
            <button
              onClick={() => setDrawerOpen(true)}
              className="flex h-9 w-9 items-center justify-center rounded-full text-[#94A3B8] hover:bg-[#F4F7FE] hover:text-[#1B2559] dark:hover:bg-[#252D3D] dark:hover:text-[#E6EDF3] xl:hidden"
              aria-label="Open menu"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="h-5 w-5"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
            </button>

            {/* Instant Guest Approval Pill for Bartender & Admin */}
            {isStaff && pendingGuests.length > 0 && (
              <button
                onClick={() => { loadGuestReqs(); setShowGuestModal(true); }}
                className="flex animate-pulse items-center gap-1.5 rounded-full bg-[#FBBF24] px-3 py-1.5 text-xs font-extrabold text-[#1B2559] shadow-sm transition hover:brightness-105"
              >
                🪪 <span>{pendingGuests.length} Guest Request{pendingGuests.length > 1 ? 's' : ''}</span>
              </button>
            )}

            {/* Connection Status Pill */}
            <span className={cx('flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold', c.online ? 'bg-[#10B981]/15 text-[#10B981]' : 'bg-[#F87171]/15 text-[#F87171]')}>
              <span className={cx('h-2 w-2 rounded-full', c.online ? 'bg-[#10B981]' : 'bg-[#F87171]')} />
              <span>{c.online ? 'Connected' : 'Offline'}</span>
              {c.queued ? ` (${c.queued})` : ''}
            </span>

            {/* Notifications Bell */}
            <div className="relative">
              <button
                className="relative flex h-9 w-9 items-center justify-center rounded-full text-[#94A3B8] transition hover:bg-[#F4F7FE] hover:text-[#1B2559] dark:hover:bg-[#252D3D] dark:hover:text-[#E6EDF3]"
                onClick={() => { setShowNotes(!showNotes); if (unread) api('/admin/notifications/read', { method: 'POST' }).then(loadNotes); }}
                title="Notifications"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5"><path d="M12 22c1.1 0 2-.9 2-2h-4a2 2 0 0 0 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z" /></svg>
                {unread > 0 && <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#F87171] px-1 text-[10px] font-bold text-white">{unread}</span>}
              </button>
              {showNotes && (
                <div className="horizon-pill-shadow absolute right-0 z-40 mt-3 max-h-96 w-80 overflow-auto rounded-[20px] border border-[#E9EDF7] bg-white p-3 dark:border-[#2E384D] dark:bg-[#1C2230]">
                  <div className="mb-2 flex items-center justify-between px-1">
                    <span className="text-xs font-bold uppercase tracking-wider text-[#94A3B8]">Notifications</span>
                    {isStaff && pendingGuests.length > 0 && (
                      <button
                        className="text-xs font-bold text-[#422AFB] underline dark:text-[#818CF8]"
                        onClick={() => { setShowNotes(false); loadGuestReqs(); setShowGuestModal(true); }}
                      >
                        Review {pendingGuests.length} Guest(s) →
                      </button>
                    )}
                  </div>
                  {notes.length === 0 && <div className="p-4 text-center text-sm text-[#94A3B8]">No notifications</div>}
                  {notes.map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => {
                        setShowNotes(false);
                        if (isStaff && /guest registration/i.test(n.message)) {
                          loadGuestReqs();
                          setShowGuestModal(true);
                        } else if (n.link) {
                          nav(n.link);
                        }
                      }}
                      className="block w-full rounded-xl p-2.5 text-left text-sm transition hover:bg-[#F4F7FE] dark:hover:bg-[#252D3D]"
                    >
                      <div className="font-medium text-[#1B2559] dark:text-[#E6EDF3]">{n.message}</div>
                      <div className="mt-0.5 text-xs text-[#94A3B8]">{fmtDate(n.at)}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Theme Toggle */}
            <button
              onClick={toggleDark}
              className="flex h-9 w-9 items-center justify-center rounded-full text-[#94A3B8] transition hover:bg-[#F4F7FE] hover:text-[#1B2559] dark:hover:bg-[#252D3D] dark:hover:text-[#E6EDF3]"
              title="Toggle Dark / Light Theme"
            >
              {dark ? (
                <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5 text-[#FBBF24]"><path d="M6.76 4.84l-1.8-1.79-1.41 1.41 1.79 1.79 1.42-1.41zM4 10.5H1v2h3v-2zm9-9.95h-2V3.5h2V.55zm7.45 3.91l-1.41-1.41-1.79 1.79 1.41 1.41 1.79-1.79zm-3.21 13.7l1.79 1.8 1.41-1.41-1.8-1.79-1.4 1.4zM20 10.5v2h3v-2h-3zm-8-5c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm-1 16.95h2V19.5h-2v2.95zm-7.45-3.91l1.41 1.41 1.79-1.8-1.41-1.41-1.79 1.8z" /></svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5 text-[#422AFB]"><path d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 0 1-4.4 2.26 5.403 5.403 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1z" /></svg>
              )}
            </button>

            {/* User Avatar Pill */}
            <button
              onClick={() => nav('/account')}
              className="horizon-gradient flex h-9 w-9 items-center justify-center rounded-full text-xs font-extrabold text-white shadow-sm"
              title={`${user?.rank ? `${user.rank} ` : ''}${user?.name} (${designation})`}
            >
              {initials}
            </button>
          </div>
        </header>

        {/* Single Smooth Scrollable Viewport (prevents iOS double scrollbars & horizontal overflow) */}
        <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-1.5 pb-[calc(5.75rem+env(safe-area-inset-bottom))] pt-1.5 sm:px-4 md:pt-2 xl:pb-4">
          <Outlet />
        </main>

        {/* Mobile / Tablet Bottom Quick Navigation Bar (iOS safe-area aware, zero horizontal scroll) */}
        <nav className="no-print fixed bottom-0 left-0 right-0 z-30 flex w-full max-w-full items-center justify-around overflow-hidden border-t border-[#E9EDF7] bg-white/95 px-1 pb-[calc(0.375rem+env(safe-area-inset-bottom))] pt-1.5 backdrop-blur-lg dark:border-[#2A3346] dark:bg-[#1C2230]/95 xl:hidden">
          {bottomItems.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                cx(
                  'flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl py-1 text-[10px] font-bold transition sm:text-[11px]',
                  isActive ? 'text-[#422AFB] dark:text-[#818CF8]' : 'text-[#94A3B8]',
                )
              }
            >
              {ICONS[n.to]}
              <span className="max-w-full truncate px-1">{n.short}</span>
            </NavLink>
          ))}
        </nav>
      </div>

      {/* Mobile Notifications Modal */}
      <Modal open={showMobileNotes} onClose={() => setShowMobileNotes(false)} title="Notifications">
        <div className="space-y-2">
          {notes.length === 0 && <div className="py-6 text-center text-sm text-[#94A3B8]">No notifications</div>}
          {notes.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => {
                setShowMobileNotes(false);
                if (isStaff && /guest registration/i.test(n.message)) {
                  loadGuestReqs();
                  setShowGuestModal(true);
                } else if (n.link) {
                  nav(n.link);
                }
              }}
              className="block w-full rounded-2xl bg-[#F4F7FE] p-3 text-left text-sm dark:bg-[#252D3D]"
            >
              <div className="font-semibold text-[#1B2559] dark:text-[#E6EDF3]">{n.message}</div>
              <div className="mt-0.5 text-xs text-[#94A3B8]">{fmtDate(n.at)}</div>
            </button>
          ))}
        </div>
      </Modal>

      {/* Global Guest Approval Center Modal (Bartender & Admin) */}
      <Modal open={showGuestModal} onClose={() => setShowGuestModal(false)} title="Guest Registration Approvals" wide>
        <div className="space-y-4">
          <p className="text-xs text-[#94A3B8]">
            Approve or decline visiting Guest requests. Approving grants QR ordering access and automatically notifies the Admin.
            Global Guest alcohol limit: <b>{Number(settings.guest_alcohol_limit || 0) > 0 ? `${settings.guest_alcohol_limit} Small/Large pegs ${settings.alcohol_limit_scope === 'order' ? 'per order' : 'per day'}` : 'Unlimited'}</b>.
          </p>
          {pendingGuests.length === 0 ? (
            <div className="rounded-2xl bg-[#F4F7FE] py-8 text-center text-sm font-medium text-[#94A3B8] dark:bg-[#252D3D]">
              No pending guest registration requests right now.
            </div>
          ) : (
            <div className="space-y-2.5">
              {pendingGuests.map((g) => (
                <div key={g.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#FBBF24]/40 bg-[#FBBF24]/10 p-3.5">
                  <div>
                    <div className="text-base font-extrabold text-[#1B2559] dark:text-[#E6EDF3]">{g.rank} {g.name}</div>
                    <div className="text-xs text-[#707EAE] dark:text-[#94A3B8]">
                      Service No: <b>{g.service_no}</b> {g.mobile && `· Mobile: ${g.mobile}`} · Requested {fmtDate(g.created_at)}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold text-[#94A3B8]">Peg limit:</span>
                      <Input
                        type="number"
                        min={0}
                        max={20}
                        placeholder={settings.guest_alcohol_limit || '3'}
                        value={guestLimits[g.id] ?? ''}
                        onChange={(e) => setGuestLimits({ ...guestLimits, [g.id]: e.target.value })}
                        className="!w-20 !min-h-9 !py-1 !text-xs"
                        title="Leave blank for global Guest limit"
                      />
                    </div>
                    <Button size="sm" variant="success" onClick={() => handleGuestDecision(g, 'approve')}>✔ Approve</Button>
                    <Button size="sm" variant="danger" onClick={() => handleGuestDecision(g, 'reject')}>✕ Decline</Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {guestReqs.filter((g) => g.approval_status !== 'pending').length > 0 && (
            <div className="pt-2">
              <div className="mb-2 text-xs font-bold uppercase tracking-wider text-[#94A3B8]">Recent Guests</div>
              <div className="max-h-56 overflow-x-auto overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="text-left text-[#94A3B8]">
                    <tr><th className="py-1.5">Guest</th><th>Service No</th><th>Limit</th><th>Status</th><th>By</th></tr>
                  </thead>
                  <tbody>
                    {guestReqs.filter((g) => g.approval_status !== 'pending').slice(0, 15).map((g) => (
                      <tr key={g.id} className="border-t border-[#E9EDF7] dark:border-[#2A3346]">
                        <td className="py-1.5 font-bold">{g.rank} {g.name}</td>
                        <td>{g.service_no}</td>
                        <td>{g.alcohol_limit != null ? `${g.alcohol_limit} pegs` : `Default (${settings.guest_alcohol_limit || '∞'})`}</td>
                        <td><Badge s={g.approval_status === 'approved' ? 'approved' : 'cancelled'}>{g.approval_status}</Badge></td>
                        <td>{g.approved_by_name || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
