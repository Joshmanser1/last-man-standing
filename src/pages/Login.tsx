// src/pages/Login.tsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supa } from "../lib/supabaseClient";

export function Login() {
  const navigate = useNavigate();

  // form
  const [formName, setFormName] = useState("");
  const [formEmail, setFormEmail] = useState("");

  // ux
  const [sending, setSending] = useState(false);
  const [cooldown, setCooldown] = useState(0); // seconds
  const [checking, setChecking] = useState(false);

  // simple 1s countdown for the send button
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

      // Keep the display name for later (used across the app)
      localStorage.setItem("player_name", name);

      const redirectTo =
        // if you deploy with a custom URL, set VITE_SITE_URL in .env
        import.meta.env.VITE_SITE_URL || window.location.origin;

      const { error } = await supa.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: redirectTo,
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

  // === "Continue" button behaviour ===
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
    } catch {
      // ignore
    } finally {
      localStorage.removeItem("player_id");
      localStorage.removeItem("player_name");
      localStorage.removeItem("is_admin");
      navigate("/login", { replace: true });
    }
  }

  return (
    <div className="min-h-[calc(100vh-56px)] bg-slate-950 text-white flex items-start sm:items-center justify-center p-4 relative">
      {/* subtle emerald glow like landing hero */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_60%_at_50%_-10%,rgba(16,185,129,0.15),transparent)]" />

      <div className="w-full max-w-xl rounded-2xl border border-white/15 bg-white/5 p-6 sm:p-8 shadow-xl relative">
        <div className="mx-auto w-fit rounded-full border border-emerald-300/30 bg-emerald-500/15 text-emerald-300 px-3 py-1 text-xs font-semibold mb-4">
          Fantasy Command Centre
        </div>

        <h1 className="text-3xl font-bold text-center mb-2">Login</h1>
        <p className="text-sm text-white/70 text-center mb-6">
          Use your email to receive a magic link. No password required.
        </p>

        <form onSubmit={sendMagicLink} className="space-y-4">
          <div>
            <label className="text-sm text-white/80">Your display name</label>
            <input
              className="mt-2 w-full rounded-xl bg-white/10 border border-white/15 px-3 py-2 outline-none focus:border-emerald-400/60"
              placeholder="Your name"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              autoComplete="name"
            />
          </div>

          <div>
            <label className="text-sm text-white/80">Email</label>
            <input
              className="mt-2 w-full rounded-xl bg-white/10 border border-white/15 px-3 py-2 outline-none focus:border-emerald-400/60"
              placeholder="you@email.com"
              value={formEmail}
              onChange={(e) => setFormEmail(e.target.value)}
              type="email"
              autoComplete="email"
            />
          </div>

          <button
            type="submit"
            className="w-full rounded-xl bg-gradient-to-br from-emerald-500 to-green-400 text-slate-900 font-semibold py-3 hover:opacity-90 disabled:opacity-60"
            disabled={sending || cooldown > 0}
          >
            {sending ? "Sending…" : cooldown > 0 ? `Wait ${cooldown}s` : "Send Magic Link"}
          </button>
        </form>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <button
            className="rounded-xl border border-white/20 px-4 py-2 hover:border-white/40"
            onClick={continueIfSignedIn}
            disabled={checking}
            title="Use existing session (if any)"
          >
            {checking ? "Checking…" : "Continue"}
          </button>

          <button
            className="rounded-xl border border-white/20 px-4 py-2 hover:border-white/40"
            onClick={signOutEverywhere}
          >
            Sign out
          </button>
        </div>

        <p className="mt-3 text-[11px] text-white/60 text-center">
          Tip: If you opened the magic link in another tab/window, just press <b>Continue</b> here.
        </p>
      </div>

      <div className="absolute bottom-4 text-xs text-white/50">
        © {new Date().getFullYear()} Fantasy Command Centre
      </div>
    </div>
  );
}

export default Login;
