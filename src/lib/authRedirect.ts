const KEY = "pending_auth_redirect";

function isSafePath(value: string | null | undefined) {
  return !!value && value.startsWith("/") && !value.startsWith("//");
}

export function clearLegacyPendingAuthRedirect() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(KEY);
}

export function rememberPendingAuthRedirect(path: string) {
  if (typeof window === "undefined" || !isSafePath(path)) return;
  clearLegacyPendingAuthRedirect();
  sessionStorage.setItem(KEY, path);
}

export function getNextParamRedirect(search: string) {
  if (typeof window === "undefined") return null;
  const next = new URLSearchParams(search).get("next");
  return isSafePath(next) ? next : null;
}

export function consumePendingAuthRedirect() {
  if (typeof window === "undefined") return null;
  clearLegacyPendingAuthRedirect();
  const stored = sessionStorage.getItem(KEY);
  sessionStorage.removeItem(KEY);
  return isSafePath(stored) ? stored : null;
}
