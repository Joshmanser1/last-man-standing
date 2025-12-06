// src/pages/Login.tsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supa } from "../lib/supabaseClient";

export function Login() {
  const navigate = useNavigate();

// Auto-redirect if already logged in
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

      // Prefer explicit site URL from env (Vercel), fallback to current origin
      const base =
        (import.meta.env.VITE_PUBLIC_SITE_URL as string) || window.location.origin;
      // Normalize (remove trailing slash) to avoid double slashes when adding paths later
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
        navigate("/", { replace: true });
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

  return (
    <div className="min-h-[calc(100vh-5rem)] bg-[radial-gradient(120%_120%_at_50%_-20%,#072a25,#0b1f20_50%,#0a0e12_90%)] flex items-start sm:items-center justify-center p-6">
      <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-white/5 backdrop-blur-md shadow-xl p-6 sm:p-8 text-slate-100">
        <div className="mx-auto w-fit mb-5 flex items-center gap-2">
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

        <h1 className="text-3xl font-bold text-center mb-2">Login</h1>
        <p className="text-sm text-slate-300/80 text-center mb-6">
          Use your email to receive a magic link. No password required.
        </p>

        <form onSubmit={sendMagicLink} className="space-y-3">
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
        </form>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
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

        <p className="mt-3 text-[11px] text-slate-300/70 text-center">
          Tip: If you opened the magic link in another tab/window, just press <b>Continue</b> here.
        </p>
      </div>
    </div>
  );
}

export default Login;
