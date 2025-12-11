import React, { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { supa } from "../lib/supabaseClient";
import { devOn, localAuthed, isAdminNow } from "../lib/auth";

type RequireAdminProps = { children: React.ReactElement };

export function RequireAdmin({ children }: RequireAdminProps) {
  const loc = useLocation();
  const [allowed, setAllowed] = useState<boolean>(isAdminNow());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    // if dev + local, allow immediately
    if (devOn() && localAuthed()) {
      setAllowed(true);
      setLoading(false);
      return;
    }

    supa.auth.getUser().then(({ data }) => {
      if (!mounted) return;
      const role = (data.user?.user_metadata?.role as string) || "";
      setAllowed(role === "admin" || isAdminNow());
      setLoading(false);
    });

    const onStore = () => mounted && setAllowed(isAdminNow());
    window.addEventListener("lms:store-updated", onStore as EventListener);
    window.addEventListener("focus", onStore);
    return () => {
      mounted = false;
      window.removeEventListener("lms:store-updated", onStore as EventListener);
      window.removeEventListener("focus", onStore);
    };
  }, []);

  if (loading) return null;
  return allowed ? children : (
    <Navigate to={`/login?next=${encodeURIComponent(loc.pathname)}`} replace />
  );
}
