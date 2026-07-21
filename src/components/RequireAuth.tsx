// src/components/RequireAuth.tsx
import React, { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { supa } from "../lib/supabaseClient";
import { devOn, localAuthed } from "../lib/auth";
import { rememberPendingAuthRedirect } from "../lib/authRedirect";

type RequireAuthProps = { children: React.ReactElement };

function hasSupabaseSessionStorageKey() {
  if (typeof window === "undefined") return false;
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i) || "";
    if (key.startsWith("sb-")) return true;
  }
  return false;
}

function authDebug(event: string, details: Record<string, unknown>) {
  if (!import.meta.env.DEV) return;
  console.debug("[auth][RequireAuth]", event, details);
}

export function RequireAuth({ children }: RequireAuthProps) {
  const loc = useLocation();
  const [authed, setAuthed] = useState<boolean>(devOn() && localAuthed());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    authDebug("mount", {
      path: loc.pathname,
      queryKeys: Array.from(new URLSearchParams(loc.search).keys()),
      hasSessionKey: hasSupabaseSessionStorageKey(),
    });

    supa.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      const s = !!data.session?.user?.id;
      authDebug("hydrate", {
        hasSession: !!data.session,
        hasUserId: !!data.session?.user?.id,
        hasSessionKey: hasSupabaseSessionStorageKey(),
      });
      setAuthed(s || (devOn() && localAuthed()));
      setLoading(false);
    });

    const { data: sub } = supa.auth.onAuthStateChange((_e, s) => {
      if (!mounted) return;
      authDebug("onAuthStateChange", {
        event: _e,
        hasSession: !!s,
        hasUserId: !!s?.user?.id,
        hasSessionKey: hasSupabaseSessionStorageKey(),
      });
      setAuthed(!!s?.user?.id || (devOn() && localAuthed()));
    });

    const onStore = () => {
      if (!mounted) return;
      setAuthed((prev) => prev || (devOn() && localAuthed()));
    };

    window.addEventListener("lms:store-updated", onStore as EventListener);
    window.addEventListener("focus", onStore);

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
      window.removeEventListener("lms:store-updated", onStore as EventListener);
      window.removeEventListener("focus", onStore);
    };
  }, []);

  if (loading) return null; // or a tiny spinner
  if (authed) return children;

  const next = `${loc.pathname}${loc.search}${loc.hash}`;
  authDebug("redirect-to-login", {
    path: loc.pathname,
    next,
    hasSessionKey: hasSupabaseSessionStorageKey(),
  });
  rememberPendingAuthRedirect(next);
  return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
}
