// src/pages/Login.tsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supa } from "../lib/supabaseClient";

export function Login() {
  const navigate = useNavigate();

  // If already logged in, bounce to /my-games
  useEffect(() => {
    supa.auth.getSession().then(({ data }) => {
      if (data.session?.user?.id) {
        navigate("/my-games", { replace: true });
      }
    });
  }, [navigate]);

  // form
  const [formName, setFormName] = useState("");
  const [formEmail, setFormEmail] = useState("");

  // ux
  const [sending, setSending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [checking, setChecking] = useState(false);

  // countdown
  useEffect(() => {
    if (!cooldown) return;
    const t = setInterval(() => setCooldown((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    if (sending || cooldown > 0) return;

    const email = formEmail.trim();
    const name = formName.trim();
    if (!email) return alert("Enter your email.");
    if (!name) return alert("Enter your display name.");

    try {
      setSending(true);
      localStorage.setItem("player_name", name);

      const base =
        (import.meta.env.VITE_PUBLIC_SITE_URL as string) || window.location.origin;
      const redirectTo = base.replace(/\/$/, "");

      const { error } = await supa.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: redirectTo, // e.g. https://lms.fantasycommandcentre.co.uk
          shouldCreateUser: true,
        },
      });

      if (error) {
        if (/rate limit/i.test(error.message)) {
          setCooldown(60);
          alert("Email rate limit exceeded. Please try again in ~1 minute.");
        } else {
          alert(error.message);
        }
        return;
      }

      setCooldown(60);
      alert("Magic link sent. Check your inbox.");
    } finally {
      setSending(false);
    }
  }

  async function continueIfSignedIn() {
    if (checking) return;
    setChecking(true);
    try {
      const { data } = await supa.auth.getSession();
      const hasSupa = !!data.session?.user?.id;
      const hasLocal = !!localStorage.getItem("player_id");
      if (hasSupa || hasLocal) {
        navigate("/my-games", { replace: true });
      } else {
        alert("No active session found. Please use Magic Link.");
      }
    } finally {
      setChecking(false);
    }
  }

  async function signOutEverywhere() {
    try {
      await supa.auth.signOut();
    } catch {}
    localStorage.removeItem("player_id");
    localStorage.removeItem("player_name");
    localStorage.removeItem("is_admin");
    navigate("/login", { replace: true });
  }

  // Full-bleed hero (no card)
  return (
    <div className="min-h-screen w-full bg-[radial-gradient(120%_120%_at_50%_-20%,#072a25,#0b1f20_50%,#0a0e12_90%)] text-slate-100">
      <div className="mx-auto max-w-7xl px-6 py-10 md:py-16">
        {/* Top brand row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img
              src="/fcc-shield.png?v=1"
              width={28}
              height={28}
              alt="FCC"
              className="rounded-md"
              onError={(e) => ((e.currentTarget.style.display = "none"))}
            />
            <span className="rounded-full bg-emerald-400/15 text-emerald-300 px-3 py-1 text-xs font-semibold">
              Fantasy Command Centre
            </span>
          </div>
          <button
            onClick={() => navigate("/")}
            className="text-sm opacity-80 hover:opacity-100"
            title="Back to landing"
          >
            Back
          </button>
        </div>

        {/* Hero content */}
        <div className="mt-10 grid gap-10 md:grid-cols-2 items-center">
          <div>
            <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight leading-tight">
              Sign in to{" "}
              <span className="text-emerald-400">Last-Man-Standing</span>
            </h1>
            <p className="mt-4 text-lg opacity-80">
              Passwordless login via magic link. You’ll be redirected back here as
              soon as you confirm your email.
            </p>

            <div className="mt-8 flex flex-wrap gap-3 text-sm opacity-80">
              <div className="rounded-xl border border-white/10 px-3 py-2">
                • Secure magic link
              </div>
              <div className="rounded-xl border border-white/10 px-3 py-2">
                • No passwords to remember
              </div>
              <div className="rounded-xl border border-white/10 px-3 py-2">
                • Ready in seconds
              </div>
            </div>
          </div>

          {/* Form panel (still full-bleed style) */}
          <form onSubmit={sendMagicLink} className="space-y-4">
            <div>
              <label className="label text-slate-200">Your display name</label>
              <input
                className="input w-full bg-white/5 border-white/10 text-slate-100 placeholder:text-slate-400"
                placeholder="Your name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                autoComplete="name"
              />
            </div>

            <div>
              <label className="label text-slate-200">Email</label>
              <input
                className="input w-full bg-white/5 border-white/10 text-slate-100 placeholder:text-slate-400"
                placeholder="you@email.com"
                value={formEmail}
                onChange={(e) => setFormEmail(e.target.value)}
                type="email"
                autoComplete="email"
              />
            </div>

            <button
              type="submit"
              className="btn w-full bg-emerald-500 hover:bg-emerald-400 text-slate-900 font-semibold border-0"
              disabled={sending || cooldown > 0}
            >
              {sending ? "Sending…" : cooldown > 0 ? `Wait ${cooldown}s` : "Send Magic Link"}
            </button>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <button
                className="btn btn-ghost border-white/10 text-slate-100 hover:bg-white/10"
                onClick={continueIfSignedIn}
                disabled={checking}
                title="Use existing session (if any)"
              >
                {checking ? "Checking…" : "Continue"}
              </button>

              <button
                className="btn btn-ghost border-white/10 text-slate-100 hover:bg-white/10"
                onClick={signOutEverywhere}
              >
                Sign out
              </button>
            </div>

            <p className="mt-2 text-[11px] text-slate-300/70">
              Tip: If you opened the magic link in another tab/window, just press <b>Continue</b> here.
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}

export default Login;
