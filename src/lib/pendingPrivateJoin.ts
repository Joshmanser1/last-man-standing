const KEY = "fcc_pending_private_join_v1";
const MAX_AGE_MS = 15 * 60 * 1000;

type PendingJoin = {
  id: string;
  path: string;
  code: string;
  createdAt: number;
  userId?: string;
};

function inviteCode(path: string) {
  try {
    if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return null;
    const url = new URL(path, window.location.origin);
    if (url.origin !== window.location.origin || url.pathname !== "/private/join") return null;
    const codes = url.searchParams.getAll("code");
    return codes.length === 1 ? codes[0].trim().toUpperCase() || null : null;
  } catch {
    return null;
  }
}

export function clearPendingPrivateJoin() {
  try { sessionStorage.removeItem(KEY); } catch { /* No automatic continuation without storage. */ }
}

function readPendingJoin(): PendingJoin | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(KEY) ?? "null");
    if (value && typeof value.id === "string" && value.id && typeof value.path === "string" &&
      typeof value.code === "string" && value.code && value.code === inviteCode(value.path) && typeof value.createdAt === "number" &&
      value.createdAt <= Date.now() && Date.now() - value.createdAt < MAX_AGE_MS &&
      (value.userId === undefined || typeof value.userId === "string")) return value;
  } catch { /* Malformed, expired or unavailable storage cannot authorize a join. */ }
  clearPendingPrivateJoin();
  return null;
}

export function rememberPrivateJoin(path: string): string | null {
  clearPendingPrivateJoin();
  const code = inviteCode(path);
  if (!code) return null;
  try {
    const intent: PendingJoin = { id: crypto.randomUUID(), path, code, createdAt: Date.now() };
    sessionStorage.setItem(KEY, JSON.stringify(intent));
    // Back can occur before React mounts /login, so its cleanup is insufficient.
    window.addEventListener("popstate", clearPendingPrivateJoin, { once: true });
    return intent.id;
  } catch {
    return null;
  }
}

// The identifier travels only in router history state, never in a shareable URL.
export function retainPrivateJoin(id: unknown, path: string | null) {
  const intent = readPendingJoin();
  if (!intent || intent.id !== id || intent.path !== path || intent.userId) clearPendingPrivateJoin();
  else window.addEventListener("popstate", clearPendingPrivateJoin, { once: true });
}

export function cancelPrivateJoin(id: unknown) {
  const intent = readPendingJoin();
  if (intent && intent.id === id && !intent.userId) clearPendingPrivateJoin();
}

export function authorizePrivateJoin(id: unknown, path: string, userId: string): string | null {
  const intent = readPendingJoin();
  if (!intent || intent.id !== id || intent.path !== path || intent.userId || !userId) {
    clearPendingPrivateJoin();
    return null;
  }
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...intent, userId }));
    return intent.id;
  } catch {
    clearPendingPrivateJoin();
    return null;
  }
}

export function consumePrivateJoin(id: unknown, path: string, expectedCode = inviteCode(path)): string | null {
  const intent = readPendingJoin();
  try {
    // Claim before any async work: failed/uncertain requests must never replay.
    sessionStorage.removeItem(KEY);
  } catch {
    return null;
  }
  return intent && intent.id === id && intent.path === path && intent.code === inviteCode(path) && intent.code === expectedCode
    ? intent.userId || null : null;
}
