// src/lib/ensurePlayer.ts
import { supa } from "../lib/supabaseClient";
import { dataService } from "../data/service";

/** Decide a display name: local override > full_name > email local-part > fallback */
function inferDisplayName(u: { user_metadata?: any; email?: string } | null): string {
  const local = localStorage.getItem("player_name");
  if (local && local.trim()) return local.trim();
  const metaName = u?.user_metadata?.full_name || u?.user_metadata?.name;
  if (metaName && String(metaName).trim()) return String(metaName).trim();
  const email = u?.email || "";
  if (email.includes("@")) return email.split("@")[0];
  return "Player";
}

/**
 * Call this once on app mount.
 * - Sync local `player_id`
 * - Ensure a Player row exists/updates with a good display_name
 * - Stay subscribed to future auth changes
 */
export async function wireAuthUpsertPlayer(): Promise<() => void> {
  // initial session
  const { data } = await supa.auth.getSession();
  const user = data.session?.user ?? null;

  if (user?.id) {
    localStorage.setItem("player_id", user.id);
    const display = inferDisplayName(user);
    try {
      await dataService.upsertPlayer(display);
      // also cache for header greeting
      if (!localStorage.getItem("player_name")) {
        localStorage.setItem("player_name", display);
      }
    } catch (e) {
      console.error("Failed to ensure player on initial session:", e);
    }
  } else {
    localStorage.removeItem("player_id");
  }

  // subscribe to future changes
  const { data: sub } = supa.auth.onAuthStateChange(async (_evt, session) => {
    const u = session?.user ?? null;
    if (u?.id) {
      localStorage.setItem("player_id", u.id);
      const display = inferDisplayName(u);
      try {
        await dataService.upsertPlayer(display);
        if (!localStorage.getItem("player_name")) {
          localStorage.setItem("player_name", display);
        }
      } catch (e) {
        console.error("Failed to ensure player on auth change:", e);
      }
    } else {
      localStorage.removeItem("player_id");
    }
  });

  // return unsubscribe
  return () => {
    sub.subscription.unsubscribe();
  };
}
