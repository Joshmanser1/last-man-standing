import React, { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { supa } from "../lib/supabaseClient";
import { devOn, localAuthed, isCurrentUserSiteAdmin } from "../lib/auth";
import { rememberPendingAuthRedirect } from "../lib/authRedirect";

type RequireAdminProps = { children: React.ReactElement };

export function RequireAdmin({ children }: RequireAdminProps) {
  const loc = useLocation();
  const [allowed, setAllowed] = useState<boolean>(devOn() && localAuthed());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const syncAccess = async () => {
      if (devOn() && localAuthed()) {
        if (!mounted) return;
        setAllowed(true);
        setLoading(false);
        return;
      }

      const { data } = await supa.auth.getSession();
      if (!mounted) return;

      if (!data.session?.user?.id) {
        setAllowed(false);
        setLoading(false);
        return;
      }

      const siteAdmin = await isCurrentUserSiteAdmin();
      if (!mounted) return;
      setAllowed(siteAdmin);
      setLoading(false);
    };

    void syncAccess();

    const { data: sub } = supa.auth.onAuthStateChange(() => {
      if (!mounted) return;
      setLoading(true);
      void syncAccess();
    });

    const onStore = () => {
      if (!mounted) return;
      if (devOn() && localAuthed()) {
        setAllowed(true);
        setLoading(false);
      }
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

  if (loading) return null;
  if (allowed) return children;

  const next = `${loc.pathname}${loc.search}${loc.hash}`;
  rememberPendingAuthRedirect(next);
  return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
}
