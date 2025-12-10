// src/lib/auth.ts
import { supa } from "../lib/supabaseClient";

export const devOn = () =>
  typeof window !== "undefined" && localStorage.getItem("dev_switcher") === "1";

export const localAuthed = () =>
  typeof window !== "undefined" && !!localStorage.getItem("player_id");

export async function isAuthedAsync(): Promise<boolean> {
  const { data } = await supa.auth.getSession();
  const supaAuthed = !!data.session?.user?.id;
  return supaAuthed || (devOn() && localAuthed());
}

export function isAuthedNow(): boolean {
  // Synchronous check for client-side UI decisions
  const supaFlag = false; // don't block on async here
  return supaFlag || (devOn() && localAuthed());
}
