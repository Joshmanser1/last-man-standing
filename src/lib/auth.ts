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
  return (devOn() && localAuthed());
}

/** DEV: treat local is_admin=1 as admin; also used as a fast synchronous check */
export function isAdminNow(): boolean {
  if (devOn() && localAuthed()) return true;
  return typeof window !== "undefined" && localStorage.getItem("is_admin") === "1";
}

/** Async admin check with Supabase user metadata fallback */
export async function isAdminAsync(): Promise<boolean> {
  try {
    const { data } = await supa.auth.getUser();
    const role = (data.user?.user_metadata?.role as string) || "";
    return role === "admin" || isAdminNow();
  } catch {
    return isAdminNow();
  }
}
