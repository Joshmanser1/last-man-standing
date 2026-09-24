import { validDisplayName } from "./displayName";
// src/lib/ensurePlayer.ts
import { supa } from "../lib/supabaseClient";
import { dataService } from "../data/service";

function getStoredDisplayName(): string | null {
  return validDisplayName(localStorage.getItem("player_name"));
}

/**
 * Call this once on app mount.
 * - Sync local `player_id`
 * - Fill a missing Player row only when an explicit local name is available
 * - Stay subscribed to future auth changes
 */
export async function wireAuthUpsertPlayer(): Promise<() => void> {
  // initial session
  const { data } = await supa.auth.getSession();
  const user = data.session?.user ?? null;

  if (user?.id) {
    localStorage.setItem("player_id", user.id);
    const display = getStoredDisplayName();
    if (display) {
      try {
        await dataService.upsertPlayer(display);
      } catch (e) {
        console.error("Failed to ensure player on initial session:", e);
      }
    }
  } else {
    localStorage.removeItem("player_id");
  }

  // subscribe to future changes
  const { data: sub } = supa.auth.onAuthStateChange(async (_evt, session) => {
    const u = session?.user ?? null;
    if (u?.id) {
      localStorage.setItem("player_id", u.id);
      const display = getStoredDisplayName();
      if (display) {
        try {
          await dataService.upsertPlayer(display);
        } catch (e) {
          console.error("Failed to ensure player on auth change:", e);
        }
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
