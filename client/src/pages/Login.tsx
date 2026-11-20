import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { api } from '../lib/api';
import { useApp } from '../lib/app';
import { homeFor } from '../App';

export default function Login() {
  const { login, settings, toast } = useApp();
  const nav = useNavigate();
  const loc = useLocation() as any;

  const saved = (() => {
    try { return JSON.parse(localStorage.getItem('divinabar_saved_login') || localStorage.getItem('bartill_saved_login') || 'null'); } catch { return null; }
  })();

  const [mode, setMode] = useState<'member' | 'admin'>(saved?.mode === 'admin' ? 'admin' : 'member');
  const [sn, setSn] = useState<string>(saved?.sn || '');
  const [pin, setPin] = useState('');
  const [remember, setRemember] = useState<boolean>(saved ? true : true);
  const [showPin, setShowPin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [shake, setShake] = useState(false);
  const [focusedField, setFocusedField] = useState<'sn' | 'pin' | null>(null);
  const [guestOpen, setGuestOpen] = useState(false);
  const [gForm, setGForm] = useState({ service_no: '', rank: '', name: '', mobile: '', pin: '' });
  const [gMsg, setGMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [gBusy, setGBusy] = useState(false);

  const registerGuest = async (e: React.FormEvent) => {
    e.preventDefault();
    setGBusy(true);
    setGMsg(null);
    try {
      const r = await api('/auth/guest-register', { method: 'POST', body: gForm });
      setGMsg({ type: 'ok', text: r.message || 'Registration submitted! Waiting for bartender approval.' });
      setGForm({ service_no: '', rank: '', name: '', mobile: '', pin: '' });
    } catch (e: any) {
      setGMsg({ type: 'err', text: e.message || 'Registration failed' });
    } finally {
      setGBusy(false);
    }
  };

  const bgImg = !settings.background || /^\/Login_bg\.(jpg|png|webp)$/i.test(settings.background) ? '/Login_bg.webp' : settings.background;
  const logoImg = settings.logo || '/Login_logo.png';
  const titleText =
    !settings.bar_name || settings.bar_name === 'Officers Bar' || settings.bar_name === "DIVINA OFFICERS' BAR"
      ? "DIVINA OFFICERS' BAR"
      : settings.bar_name;

  const switchMode = (nextMode: 'member' | 'admin') => {
    if (nextMode === mode) return;
    setMode(nextMode);
    setErr('');
    setSn('');
    setPin('');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sn.trim() || !pin.trim()) return;
    setBusy(true);
    setErr('');
    try {
      const u = await login(sn.trim(), pin.trim(), mode, remember);
      if (remember) localStorage.setItem('divinabar_saved_login', JSON.stringify({ sn: sn.trim(), mode }));
      else localStorage.removeItem('divinabar_saved_login');
      localStorage.removeItem('bartill_saved_login');
      if (u.must_change_pin) toast('Please change your initial PIN (Account page)');
      nav(loc.state?.from || homeFor(u.role), { replace: true });
    } catch (e: any) {
      setErr(e.message || 'Invalid service number or PIN');
      setShake(true);
      setTimeout(() => setShake(false), 450);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="login-scene relative flex min-h-[100dvh] w-full max-w-full items-center justify-center overflow-x-hidden overflow-y-auto bg-black bg-cover bg-center bg-no-repeat py-[max(1rem,env(safe-area-inset-top))] md:justify-end"
      style={{
        backgroundImage: `url("${bgImg}")`,
        backgroundPosition: 'center center',
      }}
    >
      <style>{`
        .login-scene { isolation:isolate; }
        .login-panel {
          background:linear-gradient(145deg,rgba(12,23,39,.88),rgba(3,9,19,.93));
          border:1px solid rgba(255,198,82,.62);
          box-shadow:0 0 0 1px rgba(255,220,139,.12),0 0 24px rgba(255,174,46,.2),0 24px 80px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.12);
          animation:panel-arrive .85s cubic-bezier(.2,.8,.2,1) both;
          transition:border-color .35s ease, box-shadow .35s ease;
        }
        .login-panel:hover {
          border-color:rgba(255,210,110,.82);
          box-shadow:0 0 0 1px rgba(255,224,150,.2),0 0 32px rgba(255,178,52,.28),0 28px 86px rgba(0,0,0,.62),inset 0 1px 0 rgba(255,255,255,.16);
        }
        .gold-title {
          color:#ffd77b; text-shadow:0 0 10px rgba(255,183,55,.4),0 2px 18px rgba(255,165,35,.22);
          background:linear-gradient(100deg,#fff1bd 0%,#ffc247 45%,#fff4cc 55%,#ffc247 100%);
          background-size:220% auto;
          -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent;
          animation:title-sheen 6s linear infinite;
        }
        .gold-rule {
          position:relative; height:1px; overflow:hidden;
          background:linear-gradient(90deg,transparent,#d99b36,#fff0b3,#d99b36,transparent);
          box-shadow:0 0 9px rgba(255,190,75,.65);
        }
        .gold-rule::after {
          content:""; position:absolute; top:0; left:-40%; width:40%; height:100%;
          background:linear-gradient(90deg,transparent,#ffffff,transparent);
          animation:rule-glint 3.6s ease-in-out infinite;
        }
        .input-shell {
          position:relative; transition:transform .22s cubic-bezier(.22,1,.36,1);
        }
        .input-shell.focused { transform:translateY(-1px); }
        .gold-input {
          color:#fff8e8; background:rgba(2,9,19,.74); border:1px solid rgba(255,211,130,.35);
          box-shadow:inset 0 2px 8px rgba(0,0,0,.28);
          transition:border-color .25s ease,box-shadow .25s ease,background .25s ease;
        }
        .gold-input:hover:not(:focus) { border-color:rgba(255,211,130,.58); background:rgba(5,13,25,.82); }
        .gold-input::placeholder { color:rgba(224,222,215,.48); }
        .gold-input:focus {
          outline:none; border-color:#ffc65c; background:rgba(6,15,28,.94);
          box-shadow:0 0 0 3px rgba(255,190,70,.16),0 0 22px rgba(255,184,55,.24);
        }
        /* Shimmering Gold Login Button */
        .gold-button {
          position:relative; overflow:hidden;
          color:#211506;
          background:linear-gradient(110deg,#ffe8a0 0%,#ffc34e 46%,#f4a923 100%);
          box-shadow:0 0 16px rgba(255,179,48,.38),inset 0 1px 0 rgba(255,255,255,.85);
          transition:transform .22s cubic-bezier(.22,1,.36,1),box-shadow .25s ease,filter .25s ease;
        }
        .gold-button::before {
          content:""; position:absolute; top:-20%; left:-75%; width:50%; height:140%;
          background:linear-gradient(105deg,transparent 0%,rgba(255,255,255,.15) 30%,rgba(255,255,255,.78) 50%,rgba(255,255,255,.15) 70%,transparent 100%);
          transform:skewX(-22deg);
          animation:btn-shimmer 2.8s cubic-bezier(.4,0,.2,1) infinite;
          pointer-events:none;
        }
        .gold-button:hover {
          transform:translateY(-2px); filter:brightness(1.07);
          box-shadow:0 0 28px rgba(255,186,57,.68),0 10px 24px rgba(0,0,0,.32),inset 0 1px 0 #fff;
        }
        .gold-button:hover::before { animation-duration:1.45s; }
        .gold-button:active { transform:translateY(0) scale(.975); }
        .gold-button .btn-arrow { transition:transform .25s cubic-bezier(.22,1,.36,1); }
        .gold-button:hover .btn-arrow { transform:translateX(4px); }

        /* Sliding Segmented Mode Switcher */
        .mode-track {
          position:relative; display:grid; grid-template-columns:1fr 1fr; padding:4px;
          border-radius:14px; background:rgba(255,255,255,.055);
          border:1px solid rgba(255,218,148,.2);
        }
        .mode-pill {
          position:absolute; top:4px; bottom:4px; left:4px; width:calc(50% - 4px);
          border-radius:10px;
          background:linear-gradient(110deg,#ffe8a0,#ffc34e);
          box-shadow:0 0 16px rgba(255,185,55,.4),inset 0 1px 0 #fff;
          transition:transform .32s cubic-bezier(.34,1.3,.64,1);
        }
        .mode-pill.admin { transform:translateX(100%); }
        .mode-tab {
          position:relative; z-index:1; display:flex; align-items:center; justify-content:center;
          gap:8px; padding:10px 10px; border-radius:10px; font-size:14px; font-weight:700;
          color:#e9e5dc; transition:color .25s ease, transform .18s ease;
        }
        .mode-tab:hover:not(.active) { color:#fff5db; }
        .mode-tab:active { transform:scale(.97); }
        .mode-tab.active { color:#241604; }
        .mode-tab .tab-icon { transition:transform .3s cubic-bezier(.34,1.56,.64,1); }
        .mode-tab:hover .tab-icon-user { transform:scale(1.14) translateY(-1px); }
        .mode-tab:hover .tab-icon-gear, .mode-tab.active .tab-icon-gear { transform:rotate(45deg) scale(1.1); }

        .crest-glow {
          filter:drop-shadow(0 0 16px rgba(255,190,75,.24));
          animation:crest-float 4.8s ease-in-out infinite;
          transition:transform .45s cubic-bezier(.22,1,.36,1),filter .45s ease;
        }
        .crest-glow:hover {
          transform:translateY(-4px) scale(1.06) rotate(2deg);
          filter:drop-shadow(0 0 28px rgba(255,196,84,.62));
        }
        .field-check { animation:pop-in .24s cubic-bezier(.34,1.56,.64,1) both; }

        @keyframes btn-shimmer {
          0% { left:-75%; }
          55%, 100% { left:135%; }
        }
        @keyframes title-sheen {
          0% { background-position:0% center; }
          100% { background-position:220% center; }
        }
        @keyframes rule-glint {
          0%, 100% { left:-40%; opacity:0; }
          20% { opacity:1; }
          55% { left:115%; opacity:0; }
        }
        @keyframes crest-float {
          0%, 100% { transform:translateY(0); }
          50% { transform:translateY(-4px); }
        }
        @keyframes pop-in {
          from { opacity:0; transform:scale(.5); }
          to { opacity:1; transform:scale(1); }
        }
        @keyframes panel-arrive { from { opacity:0; transform:translateY(22px) scale(.985); } to { opacity:1; transform:translateY(0) scale(1); } }
        @keyframes soft-pulse { 0%,100% { box-shadow:0 0 14px rgba(255,181,58,.28); } 50% { box-shadow:0 0 26px rgba(255,181,58,.52); } }
        @keyframes wave { 0%,60%,100% { transform:rotate(0); } 10%,30% { transform:rotate(14deg); } 20% { transform:rotate(-8deg); } 40% { transform:rotate(8deg); } }
        .welcome-wave { display:inline-block; transform-origin:70% 70%; animation:wave 2.8s ease-in-out infinite; }
        .login-submit { animation:soft-pulse 3.2s ease-in-out infinite; }
        @media (prefers-reduced-motion:reduce) {
          .welcome-wave,.login-submit,.login-panel,.crest-glow,.gold-title,.gold-rule::after,.gold-button::before { animation:none !important; }
          .gold-button,.crest-glow,.mode-pill,.mode-tab,.input-shell { transition:none !important; }
        }
      `}</style>

      <div className="relative z-10 flex w-full max-w-[490px] flex-col items-center px-3.5 py-4 sm:px-5 sm:py-5 md:mr-[5%] md:w-[42%] lg:mr-[6%]">
        <form
          onSubmit={submit}
          method="post"
          autoComplete="on"
          className={`login-panel w-full overflow-hidden rounded-[24px] px-4 py-5 text-white sm:rounded-[28px] sm:px-8 sm:py-7 ${shake ? 'anim-shake' : ''}`}
        >
          <div className="mb-3 flex justify-center">
            <img
              src={logoImg}
              alt="Divina Officers' Bar crest"
              className="crest-glow h-24 w-24 select-none object-contain sm:h-32 sm:w-32"
            />
          </div>

          {/* Winged Metallic Gold Title Emblem */}
          <div className="flex w-full items-center justify-center gap-1.5 sm:gap-3">
            {/* Left 3-Bar Tapered Gold Wing */}
            <svg viewBox="0 0 64 26" className="h-3.5 w-7 shrink-0 drop-shadow-[0_0_8px_rgba(255,190,65,0.45)] sm:h-6 sm:w-14" aria-hidden="true">
              <defs>
                <linearGradient id="wingGoldL" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#fff6cc" />
                  <stop offset="45%" stopColor="#f8c146" />
                  <stop offset="75%" stopColor="#b97714" />
                  <stop offset="100%" stopColor="#ffe38f" />
                </linearGradient>
              </defs>
              <polygon points="0,2 64,2 64,7 8,7" fill="url(#wingGoldL)" />
              <polygon points="14,11 64,11 64,15.5 21,15.5" fill="url(#wingGoldL)" />
              <polygon points="27,19.5 64,19.5 64,24 33,24" fill="url(#wingGoldL)" />
            </svg>

            <h1 className="gold-title font-ubuntu whitespace-nowrap text-center text-[clamp(14px,4.5vw,21px)] font-extrabold uppercase leading-none tracking-[.04em] sm:text-[25px] sm:tracking-[.06em]">
              {titleText}
            </h1>

            {/* Right 3-Bar Tapered Gold Wing (Mirrored) */}
            <svg viewBox="0 0 64 26" className="h-3.5 w-7 shrink-0 drop-shadow-[0_0_8px_rgba(255,190,65,0.45)] sm:h-6 sm:w-14" aria-hidden="true">
              <defs>
                <linearGradient id="wingGoldR" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#fff6cc" />
                  <stop offset="45%" stopColor="#f8c146" />
                  <stop offset="75%" stopColor="#b97714" />
                  <stop offset="100%" stopColor="#ffe38f" />
                </linearGradient>
              </defs>
              <polygon points="0,2 64,2 56,7 0,7" fill="url(#wingGoldR)" />
              <polygon points="0,11 50,11 43,15.5 0,15.5" fill="url(#wingGoldR)" />
              <polygon points="0,19.5 37,19.5 31,24 0,24" fill="url(#wingGoldR)" />
            </svg>
          </div>

          {/* Tapered Gold Divider with Center 5-Point Star */}
          <div className="mx-auto mt-3 flex w-[84%] items-center justify-center gap-2.5" aria-hidden="true">
            <svg viewBox="0 0 140 8" className="h-2 flex-1" preserveAspectRatio="none">
              <defs>
                <linearGradient id="lineGoldL" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#ffd77b" stopOpacity="0" />
                  <stop offset="65%" stopColor="#e6a938" stopOpacity="0.85" />
                  <stop offset="100%" stopColor="#fff2be" stopOpacity="1" />
                </linearGradient>
              </defs>
              <path d="M0 4 L132 3.2 L140 4 L132 4.8 Z" fill="url(#lineGoldL)" />
              <circle cx="133" cy="4" r="2.2" fill="#ffe69a" />
            </svg>

            <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 drop-shadow-[0_0_8px_rgba(255,196,75,0.75)]">
              <defs>
                <linearGradient id="starGold" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#fff7cc" />
                  <stop offset="50%" stopColor="#ffc347" />
                  <stop offset="100%" stopColor="#c47e14" />
                </linearGradient>
              </defs>
              <path d="M12 2l2.9 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l7.1-1.01L12 2z" fill="url(#starGold)" />
            </svg>

            <svg viewBox="0 0 140 8" className="h-2 flex-1" preserveAspectRatio="none">
              <defs>
                <linearGradient id="lineGoldR" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#fff2be" stopOpacity="1" />
                  <stop offset="35%" stopColor="#e6a938" stopOpacity="0.85" />
                  <stop offset="100%" stopColor="#ffd77b" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d="M0 4 L8 3.2 L140 4 L8 4.8 Z" fill="url(#lineGoldR)" />
              <circle cx="7" cy="4" r="2.2" fill="#ffe69a" />
            </svg>
          </div>

          <div className="mt-4 text-center">
            <h2 className="text-[23px] font-bold tracking-tight text-[#fffaf0]">
              Welcome <span className="welcome-wave">👋</span>
            </h2>
            <p className="mt-1.5 text-xs font-normal tracking-wide text-[#d8d4cc] sm:text-[13px]">
              Enjoy your happy hours with good mood and booz !!
            </p>
          </div>

          {/* Sliding Segmented Control: Member Login | Admin Login */}
          <div className="mode-track mt-6" role="tablist" aria-label="Login mode">
            <div className={`mode-pill ${mode === 'admin' ? 'admin' : ''}`} aria-hidden="true" />
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'member'}
              onClick={() => switchMode('member')}
              className={`mode-tab min-w-0 ${mode === 'member' ? 'active' : ''}`}
            >
              <span className="tab-icon tab-icon-user flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-current/15">
                <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
                  <path d="M12 12c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zm0 2c-3.33 0-10 1.67-10 5v3h20v-3c0-3.33-6.67-5-10-5z" />
                </svg>
              </span>
              <span className="whitespace-nowrap">Member Login</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={mode === 'admin'}
              onClick={() => switchMode('admin')}
              className={`mode-tab min-w-0 ${mode === 'admin' ? 'active' : ''}`}
            >
              <span className="tab-icon tab-icon-gear flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-current/10">
                <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
                  <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
                </svg>
              </span>
              <span className="whitespace-nowrap">Admin Login</span>
            </button>
          </div>

          {/* Interactive Input Fields (stable DOM + semantic autocomplete for Android/iOS Password Manager) */}
          <div className="anim-fade-up mt-5 space-y-4">
            <div className={`input-shell ${focusedField === 'sn' ? 'focused' : ''}`}>
              <label htmlFor="login-username" className="mb-2 flex items-center justify-between text-sm font-semibold tracking-wide text-[#f1dfbd]">
                <span>{mode === 'member' ? 'Member Service No.' : 'Admin / Staff ID'}</span>
                {sn.trim().length > 0 && (
                  <span className="field-check text-[11px] font-bold text-[#ffd77b]">✓</span>
                )}
              </label>
              <div className="relative flex items-center">
                <span
                  className={`pointer-events-none absolute left-3.5 transition-colors duration-200 ${
                    focusedField === 'sn' ? 'text-[#ffc65c]' : 'text-[#e7c98f]/60'
                  }`}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                </span>
                <input
                  id="login-username"
                  name="username"
                  type="text"
                  autoComplete="username"
                  placeholder={mode === 'member' ? 'Enter Service No. (e.g. 27415)' : 'Enter Admin / Officer / Staff ID'}
                  value={sn}
                  onFocus={() => setFocusedField('sn')}
                  onBlur={() => setFocusedField((f) => (f === 'sn' ? null : f))}
                  onChange={(e) => {
                    setSn(e.target.value);
                    if (err) setErr('');
                  }}
                  autoFocus={!sn}
                  autoCapitalize="characters"
                  required
                  className="gold-input h-12 w-full rounded-xl pl-10 pr-4 text-sm font-medium outline-none"
                />
              </div>
            </div>

            <div className={`input-shell ${focusedField === 'pin' ? 'focused' : ''}`}>
              <label htmlFor="login-password" className="mb-2 flex items-center justify-between text-sm font-semibold tracking-wide text-[#f1dfbd]">
                <span>{mode === 'member' ? 'Member PIN' : 'Admin PIN'}</span>
                {pin.trim().length > 0 && (
                  <span className="field-check text-[11px] font-bold text-[#ffd77b]">✓</span>
                )}
              </label>
              <div className="relative flex items-center">
                <span
                  className={`pointer-events-none absolute left-3.5 transition-colors duration-200 ${
                    focusedField === 'pin' ? 'text-[#ffc65c]' : 'text-[#e7c98f]/60'
                  }`}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                </span>
                <input
                  id="login-password"
                  name="password"
                  type={showPin ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Enter your PIN"
                  value={pin}
                  onFocus={() => setFocusedField('pin')}
                  onBlur={() => setFocusedField((f) => (f === 'pin' ? null : f))}
                  onChange={(e) => {
                    setPin(e.target.value);
                    if (err) setErr('');
                  }}
                  autoCapitalize="characters"
                  required
                  className="gold-input h-12 w-full rounded-xl pl-10 pr-12 text-sm font-medium outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPin((s) => !s)}
                  tabIndex={-1}
                  aria-label={showPin ? 'Hide PIN' : 'Show PIN'}
                  className="absolute right-2 flex h-9 w-9 items-center justify-center rounded-full text-[#e7c98f] transition-all duration-200 hover:scale-110 hover:bg-[#ffc65c]/15 hover:text-[#fff1c9] active:scale-90"
                >
                  {showPin ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {/* Save login / Remember on this device */}
            <label className="flex cursor-pointer items-center justify-between pt-0.5 text-xs text-[#e7d9bf]">
              <span className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  className="h-4 w-4 rounded border-[#ffc65c]/50 accent-[#ffc34e]"
                />
                <span>Save login details &amp; stay signed in (7 days)</span>
              </span>
            </label>
          </div>

          {err && (
            <div className="field-check mt-4 rounded-xl border border-red-400/40 bg-red-950/65 px-3 py-2.5 text-center text-xs font-medium text-red-200">
              {err}
            </div>
          )}

          {/* Shimmer Animated Login Button */}
          <button
            type="submit"
            disabled={busy}
            className="gold-button login-submit mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl text-base font-extrabold tracking-wide disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? (
              <span className="inline-flex items-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#352207] border-t-transparent" />
                Logging in…
              </span>
            ) : (
              <>
                <span>Login</span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="btn-arrow h-4 w-4">
                  <path d="M5 12h14" />
                  <path d="m12 5 7 7-7 7" />
                </svg>
              </>
            )}
          </button>

          <div className="mt-5 text-center">
            <button
              type="button"
              onClick={() => { setGMsg(null); setGuestOpen(true); }}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-[#ffc65c]/55 bg-[#ffc65c]/15 px-5 py-2.5 text-[14px] font-bold tracking-wide text-[#ffe8a0] shadow-[0_0_16px_rgba(255,190,75,0.2)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[#ffd77b] hover:bg-[#ffc65c]/25 hover:text-white hover:shadow-[0_0_22px_rgba(255,190,75,0.38)] active:scale-[0.98]"
            >
              Visiting Guest? Register for Bar Access →
            </button>
          </div>
        </form>
      </div>

      {/* Gold-Themed Guest Self-Registration Modal */}
      {guestOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs" onClick={() => setGuestOpen(false)}>
          <form
            onSubmit={registerGuest}
            onClick={(e) => e.stopPropagation()}
            className="login-panel w-full max-w-md rounded-[26px] p-6 text-white sm:p-7"
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="gold-title font-ubuntu text-xl font-extrabold tracking-wider">GUEST REGISTRATION</h3>
              <button type="button" onClick={() => setGuestOpen(false)} className="rounded-full px-2.5 py-1 text-xl text-[#e7c98f] hover:bg-white/10">×</button>
            </div>
            <p className="mb-4 text-xs text-[#d8d4cc]">
              Register with your Service No., Rank & Name. The bartender will approve your request (notified to Admin). Checkout is settled via Cash or UPI.
            </p>
            <div className="space-y-3">
              <input type="text" required placeholder="Service Number *" value={gForm.service_no} onChange={(e) => setGForm({ ...gForm, service_no: e.target.value })} autoCapitalize="characters" className="gold-input h-11 w-full rounded-xl px-3.5 text-sm" />
              <input type="text" required placeholder="Rank * (e.g. Maj, Capt, Wg Cdr, Mr/Ms)" value={gForm.rank} onChange={(e) => setGForm({ ...gForm, rank: e.target.value })} className="gold-input h-11 w-full rounded-xl px-3.5 text-sm" />
              <input type="text" required placeholder="Full Name *" value={gForm.name} onChange={(e) => setGForm({ ...gForm, name: e.target.value })} className="gold-input h-11 w-full rounded-xl px-3.5 text-sm" />
              <div className="grid grid-cols-2 gap-2.5">
                <input type="text" placeholder="Mobile (optional)" value={gForm.mobile} onChange={(e) => setGForm({ ...gForm, mobile: e.target.value })} className="gold-input h-11 w-full rounded-xl px-3.5 text-sm" />
                <input type="password" placeholder="PIN (blank = Service No)" value={gForm.pin} onChange={(e) => setGForm({ ...gForm, pin: e.target.value })} className="gold-input h-11 w-full rounded-xl px-3.5 text-sm" />
              </div>
              {gMsg && (
                <div className={`rounded-xl px-3 py-2 text-center text-xs font-medium ${gMsg.type === 'ok' ? 'border border-emerald-400/40 bg-emerald-950/70 text-emerald-200' : 'border border-red-400/40 bg-red-950/70 text-red-200'}`}>
                  {gMsg.text}
                </div>
              )}
              <button type="submit" disabled={gBusy} className="gold-button mt-2 flex h-11 w-full items-center justify-center rounded-xl text-sm font-extrabold">
                {gBusy ? 'Submitting…' : 'Submit for Bartender Approval'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
