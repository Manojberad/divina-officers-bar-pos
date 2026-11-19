import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useApp } from '../lib/app';
import { homeFor } from '../App';

export default function Login() {
  const { login, settings, toast } = useApp();
  const nav = useNavigate();
  const loc = useLocation() as any;

  const [mode, setMode] = useState<'member' | 'admin'>('member');
  const [sn, setSn] = useState('');
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [shake, setShake] = useState(false);

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
      const u = await login(sn.trim(), pin.trim(), mode);
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
      className="login-scene relative flex h-full min-h-screen w-full items-center justify-center overflow-hidden bg-black bg-center bg-no-repeat md:justify-end"
      style={{
        backgroundImage: `url("${bgImg}")`,
        backgroundSize: '100% 100%',
        backgroundPosition: 'center center',
      }}
    >
      <style>{`
        .login-scene { isolation:isolate; }
        .login-panel {
          background:linear-gradient(145deg,rgba(12,23,39,.88),rgba(3,9,19,.92));
          border:1px solid rgba(255,198,82,.62);
          box-shadow:0 0 0 1px rgba(255,220,139,.12),0 0 24px rgba(255,174,46,.2),0 24px 80px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.12);
          animation:panel-arrive .9s cubic-bezier(.2,.8,.2,1) both;
        }
        .gold-title {
          color:#ffd77b; text-shadow:0 0 10px rgba(255,183,55,.4),0 2px 18px rgba(255,165,35,.22);
          background:linear-gradient(100deg,#fff1bd 0%,#ffc247 48%,#fff0b5 100%);
          -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent;
        }
        .gold-rule { height:1px; background:linear-gradient(90deg,transparent,#d99b36,#fff0b3,#d99b36,transparent); box-shadow:0 0 9px rgba(255,190,75,.65); }
        .gold-input {
          color:#fff8e8; background:rgba(2,9,19,.72); border:1px solid rgba(255,211,130,.35);
          box-shadow:inset 0 2px 8px rgba(0,0,0,.28); transition:border-color .25s,box-shadow .25s,background .25s;
        }
        .gold-input::placeholder { color:rgba(224,222,215,.48); }
        .gold-input:focus { outline:none; border-color:#ffc65c; background:rgba(6,15,28,.92); box-shadow:0 0 0 3px rgba(255,190,70,.13),0 0 18px rgba(255,184,55,.2); }
        .gold-button {
          color:#211506; background:linear-gradient(110deg,#ffe8a0,#ffc34e 48%,#f4a923);
          box-shadow:0 0 14px rgba(255,179,48,.36),inset 0 1px 0 rgba(255,255,255,.8);
          transition:transform .2s,box-shadow .25s,filter .25s;
        }
        .gold-button:hover { transform:translateY(-2px); filter:brightness(1.08); box-shadow:0 0 25px rgba(255,186,57,.62),0 8px 22px rgba(0,0,0,.25),inset 0 1px 0 #fff; }
        .gold-button:active { transform:translateY(0) scale(.985); }
        .mode-button { border:1px solid rgba(255,218,148,.16); background:rgba(255,255,255,.055); color:#e9e5dc; transition:all .25s ease; }
        .mode-button:hover { border-color:rgba(255,205,107,.5); background:rgba(255,196,82,.09); }
        .mode-button.active { color:#2b1b06; border-color:#ffe2a0; background:linear-gradient(110deg,#ffe8a0,#ffc34e); box-shadow:0 0 16px rgba(255,185,55,.38),inset 0 1px 0 #fff; }
        .crest-glow { filter:drop-shadow(0 0 16px rgba(255,190,75,.22)); transition:transform .5s,filter .5s; }
        .crest-glow:hover { transform:translateY(-4px) scale(1.035); filter:drop-shadow(0 0 24px rgba(255,190,75,.55)); }
        @keyframes panel-arrive { from { opacity:0; transform:translateY(22px) scale(.985); } to { opacity:1; transform:translateY(0) scale(1); } }
        @keyframes soft-pulse { 0%,100% { box-shadow:0 0 12px rgba(255,181,58,.25); } 50% { box-shadow:0 0 23px rgba(255,181,58,.48); } }
        @keyframes wave { 0%,60%,100% { transform:rotate(0); } 10%,30% { transform:rotate(14deg); } 20% { transform:rotate(-8deg); } 40% { transform:rotate(8deg); } }
        .welcome-wave { display:inline-block; transform-origin:70% 70%; animation:wave 2.8s ease-in-out infinite; }
        .login-submit { animation:soft-pulse 3.2s ease-in-out infinite; }
        @media (prefers-reduced-motion:reduce) {
          .welcome-wave,.login-submit,.login-panel { animation:none !important; }
          .gold-button,.crest-glow,.mode-button { transition:none !important; }
        }
      `}</style>

      <div className="relative z-10 flex w-full max-w-[490px] flex-col items-center px-5 py-5 md:mr-[5%] md:w-[42%] lg:mr-[6%]">
        <form
          onSubmit={submit}
          className={`login-panel w-full rounded-[28px] px-6 py-6 text-white sm:px-8 sm:py-7 ${shake ? 'anim-shake' : ''}`}
        >
          <div className="mb-3 flex justify-center">
            <img
              src={logoImg}
              alt="Divina Officers' Bar crest"
              className="crest-glow h-28 w-28 select-none object-contain sm:h-32 sm:w-32"
            />
          </div>

          <h1 className="gold-title font-ubuntu text-center text-[27px] font-extrabold leading-tight tracking-[.11em] sm:text-[30px]">
            {titleText}
          </h1>
          <div className="gold-rule mx-auto mt-4 w-[82%]" />

          <div className="mt-4 text-center">
            <h2 className="text-[23px] font-bold tracking-tight text-[#fffaf0]">
              Welcome <span className="welcome-wave">👋</span>
            </h2>
            <p className="mt-1.5 text-xs font-normal tracking-wide text-[#d8d4cc] sm:text-[13px]">
              Enjoy your happy hours with good mood and booz !!
            </p>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => switchMode('member')}
              className={`mode-button flex min-w-0 items-center justify-center gap-2 rounded-xl px-2.5 py-3 text-sm font-bold active:scale-[.97] sm:px-3 ${
                mode === 'member' ? 'active' : ''
              }`}
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#241b0b]/15">
                <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
                  <path d="M12 12c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zm0 2c-3.33 0-10 1.67-10 5v3h20v-3c0-3.33-6.67-5-10-5z" />
                </svg>
              </span>
              <span className="whitespace-nowrap">Member Login</span>
            </button>

            <button
              type="button"
              onClick={() => switchMode('admin')}
              className={`mode-button flex min-w-0 items-center justify-center gap-2 rounded-xl px-2.5 py-3 text-sm font-bold active:scale-[.97] sm:px-3 ${
                mode === 'admin' ? 'active' : ''
              }`}
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/10">
                <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
                  <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
                </svg>
              </span>
              <span className="whitespace-nowrap">Admin Login</span>
            </button>
          </div>

          <div key={mode} className="anim-fade-up mt-5 space-y-4">
            <div>
              <label className="mb-2 block text-sm font-semibold tracking-wide text-[#f1dfbd]">
                {mode === 'member' ? 'Member Service No.' : 'Admin / Staff ID'}
              </label>
              <input
                type="text"
                placeholder={mode === 'member' ? 'Enter Service No. (e.g. IC-51234)' : 'Enter Admin / Staff ID (e.g. ADMIN)'}
                value={sn}
                onChange={(e) => {
                  setSn(e.target.value);
                  if (err) setErr('');
                }}
                autoFocus
                autoCapitalize="characters"
                required
                className="gold-input h-12 w-full rounded-xl px-4 text-sm font-medium outline-none"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold tracking-wide text-[#f1dfbd]">
                {mode === 'member' ? 'Member PIN' : 'Admin PIN'}
              </label>
              <div className="relative flex items-center">
                <input
                  type={showPin ? 'text' : 'password'}
                  placeholder="Enter your PIN"
                  value={pin}
                  onChange={(e) => {
                    setPin(e.target.value);
                    if (err) setErr('');
                  }}
                  autoCapitalize="characters"
                  required
                  className="gold-input h-12 w-full rounded-xl pl-4 pr-12 text-sm font-medium outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPin((s) => !s)}
                  tabIndex={-1}
                  aria-label={showPin ? 'Hide PIN' : 'Show PIN'}
                  className="absolute right-2 flex h-9 w-9 items-center justify-center rounded-full text-[#e7c98f] transition-colors hover:bg-[#ffc65c]/10 hover:text-[#fff1c9]"
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
          </div>

          {err && (
            <div className="mt-4 rounded-xl border border-red-400/40 bg-red-950/65 px-3 py-2.5 text-center text-xs font-medium text-red-200">
              {err}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="gold-button login-submit mt-6 flex h-12 w-full items-center justify-center rounded-xl text-base font-extrabold tracking-wide disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? (
              <span className="inline-flex items-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#352207] border-t-transparent" />
                Logging in…
              </span>
            ) : (
              'Login'
            )}
          </button>

          <div className="mt-5 flex items-center justify-center gap-2 text-[9px] font-semibold tracking-[.24em] text-[#d7b66f]">
            <span className="h-px flex-1 bg-gradient-to-r from-transparent to-[#b98a39]/70" />
            <span>GOOD TIMES&nbsp; • &nbsp;GREAT COMPANY&nbsp; • &nbsp;OFFICERS' BAR</span>
            <span className="h-px flex-1 bg-gradient-to-l from-transparent to-[#b98a39]/70" />
          </div>
        </form>
      </div>
    </div>
  );
}
