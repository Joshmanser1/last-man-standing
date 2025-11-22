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
  // Use this when the user already has a valid Supabase session OR
  // you've already created/stored a local player_id (bypasses email re-send).
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
    <div className="min-h-[calc(100vh-5rem)] flex items-start sm:items-center justify-center p-4">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow p-6 sm:p-8">
        <div className="mx-auto w-fit rounded-full bg-emerald-100 text-emerald-800 px-3 py-1 text-xs font-semibold mb-4">
          Fantasy Command Centre
        </div>

        <h1 className="text-2xl font-bold text-center mb-2">Login</h1>
        <p className="text-sm text-slate-600 text-center mb-6">
          Use your email to receive a magic link. No password required.
        </p>

        <form onSubmit={sendMagicLink} className="space-y-3">
          <div>
            <label className="label">Your display name</label>
            <input
              className="input w-full"
              placeholder="Your name"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              autoComplete="name"
            />
          </div>

          <div>
            <label className="label">Email</label>
            <input
              className="input w-full"
              placeholder="you@email.com"
              value={formEmail}
              onChange={(e) => setFormEmail(e.target.value)}
              type="email"
              autoComplete="email"
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary w-full"
            disabled={sending || cooldown > 0}
          >
            {sending ? "Sending…" : cooldown > 0 ? `Wait ${cooldown}s` : "Send Magic Link"}
          </button>
        </form>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <button
            className="btn btn-ghost"
            onClick={continueIfSignedIn}
            disabled={checking}
            title="Use existing session (if any)"
          >
            {checking ? "Checking…" : "Continue"}
          </button>

          <button className="btn btn-ghost" onClick={signOutEverywhere}>
            Sign out
          </button>
        </div>

        <p className="mt-3 text-[11px] text-slate-500 text-center">
          Tip: If you opened the magic link in another tab/window, just press{" "}
          <b>Continue</b> here.
        </p>
      </div>
    </div>
  );
}

export default Login;
