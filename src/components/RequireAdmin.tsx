import { RequireAuth } from "./RequireAuth";
import React, { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { supa } from "../lib/supabaseClient";
import { devOn, getCurrentUserSiteAdminAccess, localAuthed, type SiteAdminAccess } from "../lib/auth";
import { rememberPendingAuthRedirect } from "../lib/authRedirect";

type RequireAdminProps = { children: React.ReactElement };

export function RequireAdmin({ children }: RequireAdminProps) {
  const loc = useLocation();
  const [access, setAccess] = useState<SiteAdminAccess | null>(
    devOn() && localAuthed() ? "allowed" : null
  );
  const [loading, setLoading] = useState(true);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let mounted = true;

    const syncAccess = async () => {
      if (devOn() && localAuthed()) {
        if (!mounted) return;
        setAccess("allowed");
        setLoading(false);
        return;
      }

      const accessResult = await getCurrentUserSiteAdminAccess();
      if (!mounted) return;
      setAccess(accessResult);
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
        setAccess("allowed");
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
  }, [retryCount]);

  if (loading) return null;
  if (access === "allowed") return <RequireAuth>{children}</RequireAuth>;

  if (access === "unauthenticated") {
    const next = `${loc.pathname}${loc.search}${loc.hash}`;
    rememberPendingAuthRedirect(next);
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }

  if (access === "error") {
    return (
      <main role="alert">
        <h1>Unable to verify admin access</h1>
        <p>Your session is still protected. Please try again.</p>
        <button type="button" onClick={() => setRetryCount((count) => count + 1)}>
          Retry
        </button>
      </main>
    );
  }

  return (
    <main role="alert">
      <h1>Access denied</h1>
      <p>Your account is not authorised to access the admin area.</p>
    </main>
  );
}
