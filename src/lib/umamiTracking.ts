import { advertisingTrackingAllowed, readAdvertisingConsent } from "./advertisingConsent";

declare global {
  interface Window {
    fccUmamiInitialized?: boolean;
    fccUmamiBeforeSend?: (type: string, payload: Record<string, unknown>) => Record<string, unknown> | false;
  }
}

type PendingEvent = { name: string; properties: Record<string, string | number | boolean>; consentedAt: number };
let pending: PendingEvent[] = [];
export function clearUmamiQueue() { pending = []; }

function previewMode() {
  return import.meta.env.DEV && new URLSearchParams(window.location.search).get("devPreview") === "1" &&
    ["/make-pick", "/my-games", "/leaderboard"].includes(window.location.pathname);
}

export function initializeUmami() {
  if (!advertisingTrackingAllowed() || previewMode() || window.fccUmamiInitialized) return;
  window.fccUmamiInitialized = true;
  // The existing Cloud tracker stores individual page/session/funnel events. It
  // is not an independently configured aggregate-only statistical pipeline.
  window.fccUmamiBeforeSend = (_type, payload) => {
    if (!advertisingTrackingAllowed()) return false;
    const result = { ...payload };
    // Preserve consented campaign dimensions, not arbitrary URLs or auth next/tokens.
    for (const key of ["url", "referrer"]) {
      if (typeof result[key] !== "string" || !result[key]) continue;
      try {
        const url = new URL(result[key] as string, window.location.origin);
        const query = new URLSearchParams();
        if (key === "url") for (const field of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]) {
          const value = url.searchParams.get(field);
          if (value) query.set(field, value.slice(0, 160));
        }
        const search = query.toString();
        result[key] = (key === "referrer" ? url.origin : "") + url.pathname + (search ? `?${search}` : "");
      } catch { result[key] = ""; }
    }
    return result;
  };
  const tracker = document.createElement("script");
  tracker.id = "fcc-umami";
  tracker.async = true;
  tracker.src = "https://cloud.umami.is/script.js";
  tracker.dataset.websiteId = "ba69b2f0-2355-4dcf-a2dd-1069e3b5df3c";
  tracker.dataset.beforeSend = "fccUmamiBeforeSend";
  tracker.dataset.excludeHash = "true";
  tracker.onload = () => {
    const queued = pending;
    pending = [];
    for (const event of queued) {
      if (!advertisingTrackingAllowed() || readAdvertisingConsent()?.updatedAt !== event.consentedAt) break;
      try { window.umami?.track?.(event.name, event.properties); } catch { /* Analytics never blocks the app. */ }
    }
  };
  tracker.onerror = clearUmamiQueue;
  document.head.appendChild(tracker);
}

export function trackConsentedEvent(name: string, properties: Record<string, string | number | boolean>): boolean {
  if (!advertisingTrackingAllowed() || previewMode()) return false;
  try {
    initializeUmami();
    if (typeof window.umami?.track === "function") window.umami.track(name, properties);
    else {
      if (pending.length >= 100) return false;
      // Queue only events occurring after consent; never replay pre-consent history.
      pending.push({ name, properties, consentedAt: readAdvertisingConsent()!.updatedAt });
    }
    return true;
  } catch { return false; }
}
