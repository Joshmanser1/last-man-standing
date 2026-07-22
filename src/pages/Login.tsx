import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { supa } from "../lib/supabaseClient";
import {
  clearLegacyPendingAuthRedirect,
  consumePendingAuthRedirect,
  getNextParamRedirect,
  rememberPendingAuthRedirect,
} from "../lib/authRedirect";

type Notice = {
  tone: "error" | "info";
  text: string;
} | null;

function getRedirectTarget(search: string) {
  return consumePendingAuthRedirect() || getNextParamRedirect(search) || "/my-games";
}

function normalizeOtp(value: string) {
  return value.replace(/\D/g, "").slice(0, 6);
}

function getFriendlyAuthError(error: unknown, action: "send" | "verify") {
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error || "").toLowerCase();

  if (message.includes("rate limit")) {
    return "Too many attempts. Please wait a minute before trying again.";
  }
  if (message.includes("failed to fetch") || message.includes("network")) {
    return "Network error. Check your connection and try again.";
  }
  if (
    action === "verify" &&
    (message.includes("token") ||
      message.includes("otp") ||
      message.includes("expired") ||
      message.includes("invalid"))
  ) {
    return "That code is invalid or has expired. Request a new code and try again.";
  }
  if (action === "send") {
    return "We couldn't send a code right now. Please check the email address and try again.";
  }
  return "We couldn't verify that code. Please try again.";
}

export function Login() {
  const navigate = useNavigate();
  const location = useLocation();

  const [formName, setFormName] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [stage, setStage] = useState<"request" | "verify">("request");

  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [checking, setChecking] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const didPostAuthNavigate = useRef(false);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const triedAlt = useRef(false);
  const codeInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!cooldown) return;
    const t = setInterval(() => setCooldown((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  useEffect(() => {
    clearLegacyPendingAuthRedirect();
    const next = getNextParamRedirect(location.search);
    if (next) {
      rememberPendingAuthRedirect(next);
    }
  }, [location.search]);

  useEffect(() => {
    if (stage === "verify") {
      codeInputRef.current?.focus();
    }
  }, [stage]);

  useEffect(() => {
    let mounted = true;

    const redirectOnce = () => {
      if (!mounted || didPostAuthNavigate.current) return;
      didPostAuthNavigate.current = true;
      navigate(getRedirectTarget(location.search), { replace: true });
    };

    const redirectIfAuthed = async () => {
      const { data } = await supa.auth.getSession();
      if (!mounted) return;
      if (data.session?.user?.id) {
        redirectOnce();
      }
    };

    void redirectIfAuthed();

    const { data: sub } = supa.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      if (session?.user?.id) {
        redirectOnce();
      }
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [location.search, navigate]);

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    if (sending) return;

    const email = formEmail.trim();
    const name = formName.trim();
    if (!email) {
      setNotice({ tone: "error", text: "Enter your email address." });
      return;
    }
    if (!name) {
      setNotice({ tone: "error", text: "Enter your display name." });
      return;
    }

    try {
      setSending(true);
      setNotice(null);
      localStorage.setItem("player_name", name);
      rememberPendingAuthRedirect(getNextParamRedirect(location.search) || "/my-games");

      const { error } = await supa.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: true },
      });

      if (error) {
        if (/rate limit/i.test(error.message)) {
          setCooldown(60);
        }
        setNotice({ tone: "error", text: getFriendlyAuthError(error, "send") });
        return;
      }

      setStage("verify");
      setOtpCode("");
      setCooldown(60);
      setNotice({
        tone: "info",
        text: `We've sent a six-digit code to ${email}.`,
      });
    } catch (error) {
      setNotice({ tone: "error", text: getFriendlyAuthError(error, "send") });
    } finally {
      setSending(false);
    }
  }

  async function verifyCode(e?: React.FormEvent) {
    e?.preventDefault();
    if (verifying) return;

    const email = formEmail.trim();
    const token = normalizeOtp(otpCode);

    if (!email) {
      setNotice({ tone: "error", text: "Enter your email address first." });
      setStage("request");
      return;
    }
    if (token.length < 6) {
      setNotice({ tone: "error", text: "Enter the full six-digit code." });
      return;
    }

    try {
      setVerifying(true);
      setNotice(null);

      const { data, error } = await supa.auth.verifyOtp({
        email,
        token,
        type: "email",
      });

      if (error || !data.session?.user?.id) {
        setNotice({ tone: "error", text: getFriendlyAuthError(error, "verify") });
        return;
      }

      if (!didPostAuthNavigate.current) {
        didPostAuthNavigate.current = true;
        navigate(getRedirectTarget(location.search), { replace: true });
      }
    } catch (error) {
      setNotice({ tone: "error", text: getFriendlyAuthError(error, "verify") });
    } finally {
      setVerifying(false);
    }
  }

  function useDifferentEmail() {
    setStage("request");
    setOtpCode("");
    setNotice(null);
  }

  async function continueIfSignedIn() {
    if (checking) return;
    setChecking(true);
    try {
      const { data } = await supa.auth.getSession();
      const hasSupa = !!data.session?.user?.id;
      if (hasSupa) {
        if (!didPostAuthNavigate.current) {
          didPostAuthNavigate.current = true;
          navigate(getRedirectTarget(location.search), { replace: true });
        }
      } else {
        setNotice({ tone: "error", text: "No active session found. Request a new code to continue." });
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

  const onLogoError = () => {
    if (triedAlt.current) {
      if (imgRef.current) imgRef.current.style.display = "none";
      return;
    }
    triedAlt.current = true;
    if (imgRef.current) imgRef.current.src = "/logo-shield.png";
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(120%_120%_at_50%_-20%,#072a25,#0b1f20_50%,#0a0e12_90%)] flex items-start sm:items-center justify-center p-6">
      <div className="fixed top-0 left-0 right-0 px-4 py-3 flex items-center justify-between text-slate-200/90">
        <Link to="/" className="text-sm hover:underline">Back to landing</Link>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-emerald-400/15 text-emerald-300 px-3 py-1 text-xs font-semibold">
            Fantasy Command Centre
          </span>
        </div>
      </div>

      <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-white/5 backdrop-blur-md shadow-xl p-6 sm:p-8 text-slate-100">
        <div className="mx-auto w-fit mb-5 flex items-center gap-2">
          <img
            ref={imgRef}
            src="/fcc-shield.png"
            width={28}
            height={28}
            alt="FCC"
            className="rounded-md"
            onError={onLogoError}
          />
          <span className="rounded-full bg-emerald-400/15 text-emerald-300 px-3 py-1 text-xs font-semibold">
            Fantasy Command Centre
          </span>
        </div>

        <h1 className="text-3xl font-bold text-center mb-2">Login</h1>
        <p className="text-sm text-slate-300/80 text-center mb-6">
          {stage === "verify"
            ? `We've sent a six-digit code to ${formEmail.trim()}.`
            : "Use your email to receive a six-digit sign-in code."}
        </p>

        {notice && (
          <div
            className={[
              "mb-4 rounded-lg border px-3 py-2 text-sm",
              notice.tone === "error"
                ? "border-rose-300/40 bg-rose-500/10 text-rose-100"
                : "border-emerald-300/30 bg-emerald-500/10 text-emerald-100",
            ].join(" ")}
          >
            {notice.text}
          </div>
        )}

        {stage === "request" ? (
          <form onSubmit={sendCode} className="space-y-3">
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
              disabled={sending}
            >
              {sending ? "Sending..." : "Send code"}
            </button>
          </form>
        ) : (
          <form onSubmit={verifyCode} className="space-y-3">
            <div>
              <label className="label text-slate-200">Six-digit code</label>
              <input
                ref={codeInputRef}
                className="input w-full bg-white/5 border-white/10 text-slate-100 placeholder:text-slate-400 tracking-[0.3em]"
                placeholder="123456"
                value={otpCode}
                onChange={(e) => setOtpCode(normalizeOtp(e.target.value))}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
              />
            </div>

            <button
              type="submit"
              className="btn w-full bg-emerald-500 hover:bg-emerald-400 text-slate-900 font-semibold border-0"
              disabled={verifying}
            >
              {verifying ? "Verifying..." : "Verify code"}
            </button>

            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <button
                type="button"
                className="btn btn-ghost border-white/10 text-slate-100 hover:bg-white/10"
                onClick={() => void sendCode()}
                disabled={sending || cooldown > 0}
              >
                {sending ? "Sending..." : cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
              </button>

              <button
                type="button"
                className="btn btn-ghost border-white/10 text-slate-100 hover:bg-white/10"
                onClick={useDifferentEmail}
              >
                Use a different email
              </button>
            </div>
          </form>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <button
            className="btn btn-ghost border-white/10 text-slate-100 hover:bg-white/10"
            onClick={continueIfSignedIn}
            disabled={checking}
            title="Use existing session (if any)"
          >
            {checking ? "Checking..." : "Continue"}
          </button>

          <button
            className="btn btn-ghost border-white/10 text-slate-100 hover:bg-white/10"
            onClick={signOutEverywhere}
          >
            Sign out
          </button>
        </div>

        <p className="mt-3 text-[11px] text-slate-300/70 text-center">
          Enter the code from your email here to finish signing in.
        </p>

        <div className="mt-6 flex items-center justify-center gap-6 text-xs text-slate-300/80">
          <Link to="/" className="hover:underline">Home</Link>
          <Link to="/my-games" className="hover:underline">Explore games</Link>
          <Link to="/private" className="hover:underline">Host a league</Link>
        </div>
      </div>
    </div>
  );
}

export default Login;
