// src/lib/session.ts
import { supa } from "../lib/supabaseClient";
import { useEffect, useState } from "react";
import { hasTestUserOverride, getEffectiveUserIdNow } from "./auth";

export function useAuthReady() {
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState<boolean>(!!localStorage.getItem("player_id"));

  useEffect(() => {
    let mounted = true;
    const syncLocalPlayer = (uid: string | null | undefined) => {
      if (hasTestUserOverride()) {
        const effective = getEffectiveUserIdNow();
        setAuthed(!!effective);
        return;
      }
      if (uid) {
        localStorage.setItem("player_id", uid);
      } else {
        localStorage.removeItem("player_id");
      }
      setAuthed(!!uid);
    };

    // bootstrap once
    supa.auth.getUser().then(({ data }) => {
      if (!mounted) return;
      const uid = data?.user?.id;
      syncLocalPlayer(uid);
      setReady(true);
    });

    // react to future changes (email link, signOut, etc.)
    const { data: sub } = supa.auth.onAuthStateChange(async (_evt, sess) => {
      const uid = sess?.user?.id ?? null;
      if (!mounted) return;
      syncLocalPlayer(uid);
      setReady(true);
    });

    return () => { mounted = false; sub?.subscription?.unsubscribe(); };
  }, []);

  return { ready, authed };
}
