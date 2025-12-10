// src/components/RequireAuth.tsx
import React, { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { supa } from "../lib/supabaseClient";
import { devOn, localAuthed } from "../lib/auth";

type RequireAuthProps = { children: React.ReactElement };

export function RequireAuth({ children }: RequireAuthProps) {
  const loc = useLocation();
  const [authed, setAuthed] = useState<boolean>(devOn() && localAuthed());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    supa.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      const s = !!data.session?.user?.id;
      setAuthed(s || (devOn() && localAuthed()));
      setLoading(false);
    });

    const { data: sub } = supa.auth.onAuthStateChange((_e, s) => {
      if (!mounted) return;
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
  return authed ? children : (
    <Navigate to={`/login?next=${encodeURIComponent(loc.pathname)}`} replace />
  );
}
