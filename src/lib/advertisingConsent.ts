// Independent of FCC's authenticated promotional email preference.
export const ADVERTISING_CONSENT_KEY = "fcc_advertising_consent_v1";
export const ADVERTISING_CONSENT_VERSION = "fcc-advertising-v2";
export const CONSENT_LIFETIME_MS = 180 * 24 * 60 * 60 * 1000;
export type AdvertisingChoice = "accepted" | "rejected";
export type AdvertisingConsent = { version: string; choice: AdvertisingChoice; updatedAt: number };
const BLOCK_KEY = "fcc_advertising_blocked_v2";
declare global { interface Window { fccAdvertisingBlocked?: boolean } }

export function blockAdvertisingInBrowserFlow() {
  window.fccAdvertisingBlocked = true;
  try { sessionStorage.setItem(BLOCK_KEY, "1"); } catch { /* The URL guard also protects the reloaded document. */ }
}

export function allowAdvertisingInBrowserFlow() {
  try { sessionStorage.removeItem(BLOCK_KEY); } catch { return false; }
  window.fccAdvertisingBlocked = false;
  return true;
}

export function readAdvertisingConsent(): AdvertisingConsent | null {
  // A fail-closed escape hatch if a browser stops allowing preference writes.
  if (new URLSearchParams(window.location.search).get("fcc_ads") === "off") blockAdvertisingInBrowserFlow();
  if (window.fccAdvertisingBlocked) return null;
  try { if (sessionStorage.getItem(BLOCK_KEY) === "1") return null; } catch { return null; }
  try {
    const value = JSON.parse(localStorage.getItem(ADVERTISING_CONSENT_KEY) || "null");
    if (value?.version !== ADVERTISING_CONSENT_VERSION ||
      !["accepted", "rejected"].includes(value.choice) ||
      !Number.isFinite(value.updatedAt) || value.updatedAt > Date.now() ||
      Date.now() - value.updatedAt >= CONSENT_LIFETIME_MS) return null;
    return value;
  } catch { return null; }
}

export function saveAdvertisingConsent(choice: AdvertisingChoice): boolean {
  try {
    if (choice === "accepted" && readAdvertisingConsent()?.choice === "accepted") return true;
    const value: AdvertisingConsent = { version: ADVERTISING_CONSENT_VERSION, choice, updatedAt: Date.now() };
    const serialized = JSON.stringify(value);
    localStorage.setItem(ADVERTISING_CONSENT_KEY, serialized);
    return localStorage.getItem(ADVERTISING_CONSENT_KEY) === serialized;
  } catch { return false; }
}

export function clearAdvertisingAttribution() {
  for (const key of ["fcc_attribution_first_touch_v1", "fcc_attribution_join_touch_v1"]) {
    try { localStorage.removeItem(key); } catch { /* Storage may be unavailable. */ }
  }
  try { sessionStorage.removeItem("fcc_invite_attribution_v1"); } catch { /* No auth/navigation storage is removed. */ }
}

export function advertisingTrackingAllowed(): boolean {
  if (readAdvertisingConsent()?.choice !== "accepted") return false;
  const url = new URL(window.location.href);
  const credentials = /(?:^|[?&#])(?:access_token|refresh_token|id_token|token_hash|token|email)=/i;
  if (credentials.test(url.search + url.hash) || credentials.test(document.referrer) ||
    (url.searchParams.has("code") && url.pathname !== "/private/join")) return false;
  if (document.referrer) {
    try {
      const referrer = new URL(document.referrer);
      if (referrer.searchParams.has("code") && referrer.pathname !== "/private/join") return false;
    } catch { return false; }
  }
  return true;
}

export function clearAdvertisingCookies() {
  // Only X cookies accessible on this host; never touch auth or attribution storage.
  const domains = ["", window.location.hostname, "." + window.location.hostname];
  const parts = window.location.hostname.split(".");
  for (let i = 1; i < parts.length - 1; i++) domains.push("." + parts.slice(i).join("."));
  for (const name of ["_twclid", "_twpid", "_twsid"]) {
    for (const domain of domains) {
      document.cookie = `${name}=; Max-Age=0; path=/; SameSite=Lax${domain ? `; domain=${domain}` : ""}`;
    }
  }
}
