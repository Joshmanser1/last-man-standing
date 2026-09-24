import { validDisplayName } from "../lib/displayName";
// src/components/RequireAuth.tsx
import React, { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { supa } from "../lib/supabaseClient";
import { devOn, localAuthed } from "../lib/auth";
import { rememberPendingAuthRedirect } from "../lib/authRedirect";

type RequireAuthProps = { children: React.ReactElement };

export function RequireAuth({ children }: RequireAuthProps) {
  const loc = useLocation();
  const [authed, setAuthed] = useState<boolean>(devOn() && localAuthed());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    let generation = 0;
    const checkProfile = async (userId?: string) => {
      const current = ++generation;
      let allowed = devOn() && localAuthed();
      try {
        if (userId && !allowed) {
          const { data, error } = await supa.from("profiles").select("display_name").eq("id", userId).maybeSingle();
          allowed = !error && !!validDisplayName(data?.display_name);
        }
      } catch { allowed = false; }
      if (!mounted || current !== generation) return;
      setAuthed(allowed);
      setLoading(false);
    };
    void supa.auth.getSession().then(({ data }) => checkProfile(data.session?.user?.id));
    let timer: ReturnType<typeof setTimeout>;
    const { data: sub } = supa.auth.onAuthStateChange((_e, session) => {
      if (!mounted) return;
      setLoading(true);
      clearTimeout(timer);
      timer = setTimeout(() => void checkProfile(session?.user?.id), 0);
    });

    const onStore = () => {
      if (!mounted) return;
      setAuthed((prev) => prev || (devOn() && localAuthed()));
    };

    window.addEventListener("lms:store-updated", onStore as EventListener);
    window.addEventListener("focus", onStore);

    return () => {
      mounted = false;
      clearTimeout(timer);
      sub.subscription.unsubscribe();
      window.removeEventListener("lms:store-updated", onStore as EventListener);
      window.removeEventListener("focus", onStore);
    };
  }, []);

  if (loading) return null; // or a tiny spinner
  if (authed) return children;

  const next = `${loc.pathname}${loc.search}${loc.hash}`;
  rememberPendingAuthRedirect(next);
  return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
}
