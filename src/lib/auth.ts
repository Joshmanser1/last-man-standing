// src/lib/auth.ts
import { supa } from "../lib/supabaseClient";
import { getApiHeaders } from "./apiAuth";

export const hasTestUserOverride = () =>
  typeof window !== "undefined" && !!localStorage.getItem("test_user_override");

export const getEffectiveUserIdNow = () =>
  typeof window !== "undefined"
    ? localStorage.getItem("test_user_override") ||
      (devOn() ? localStorage.getItem("player_id") : null)
    : null;

export const devOn = () =>
  typeof window !== "undefined" && localStorage.getItem("dev_switcher") === "1";

export const localAuthed = () =>
  typeof window !== "undefined" &&
  (!!localStorage.getItem("test_user_override") ||
    (devOn() && !!localStorage.getItem("player_id")));

export async function getEffectiveUserId(): Promise<string | null> {
  if (typeof window !== "undefined") {
    const override = localStorage.getItem("test_user_override");
    if (override) return override;
  }

  try {
    const { data } = await supa.auth.getUser();
    if (data?.user?.id) return data.user.id;
  } catch {
    // fall through to dev fallback
  }

  return devOn()
    ? typeof window !== "undefined"
      ? localStorage.getItem("player_id")
      : null
    : null;
}

export async function isAuthedAsync(): Promise<boolean> {
  const supaAuthed = !!(await getEffectiveUserId());
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

export async function isCurrentUserSiteAdmin(): Promise<boolean> {
  if (devOn() && localAuthed()) return true;

  try {
    const { data } = await supa.auth.getSession();
    if (!data.session?.user?.id) return false;

    const resp = await fetch("/api/site-admin-status", {
      method: "GET",
      headers: await getApiHeaders(),
    });
    if (!resp.ok) return false;

    const body = (await resp.json()) as { is_site_admin?: boolean };
    return body?.is_site_admin === true;
  } catch {
    return false;
  }
}

/** Async admin check with site_admins as production authority and dev fallback */
export async function isAdminAsync(): Promise<boolean> {
  try {
    return await isCurrentUserSiteAdmin();
  } catch {
    return isAdminNow();
  }
}
