import { advertisingTrackingAllowed } from "./advertisingConsent";

type Twq = {
  (...args: unknown[]): void;
  exe?: (...args: unknown[]) => void;
  queue: unknown[][];
  version: string;
  dontSetCookie?: boolean;
};

declare global {
  interface Window {
    twq?: Twq;
    fccXPixelInitialized?: boolean;
    fccXPixelStopping?: boolean;
  }
}

export function xPixelInitialized() { return window.fccXPixelInitialized === true; }
export function advertisingTrackingInitialized() { return xPixelInitialized() || window.fccUmamiInitialized === true; }

export function initializeXPixel() {
  if (!advertisingTrackingAllowed() || xPixelInitialized()) return;
  // Official base snippet, with a document-wide guard covering both script and config.
  // Do not tie initialization to React Router navigation.
  window.fccXPixelInitialized = true;
  if (!window.twq) {
    const twq: Twq = function (...args: unknown[]) {
      if (twq.exe) twq.exe(...args);
      else twq.queue.push(args);
    };
    twq.version = "1.1";
    twq.queue = [];
    window.twq = twq;
    const script = document.createElement("script");
    script.async = true;
    script.src = "https://static.ads-twitter.com/uwt.js";
    script.id = "fcc-x-pixel";
    const first = document.getElementsByTagName("script")[0];
    first.parentNode!.insertBefore(script, first);
  }
  // The current official SDK also enables automatic button/data-layer events and
  // form-field matching by default. Only explicitly requested events are allowed.
  for (const feature of ["autoConfig", "autoAdvancedMatching", "dataLayerTracking", "autoDwellTracking"]) {
    window.twq("set", feature, "false", "rhi65");
  }
  window.twq("config", "rhi65");
}

const firstPickAttempts = new Set<string>();

// The ID is public configuration copied from X Events Manager, never guessed.
export async function trackXFirstPick(result: unknown) {
  try {
    const eventId = String(import.meta.env.VITE_X_FIRST_PICK_EVENT_ID ?? "").trim();
    if (!/^tw-rhi65-[a-z0-9]+$/.test(eventId) || !advertisingTrackingAllowed()) return;
    if (!result || typeof result !== "object") return;
    const pick = result as { id?: unknown; first_pick_submitted?: unknown };
    if (pick.first_pick_submitted !== true || typeof pick.id !== "string" || !pick.id) return;
    // A non-reversible event key avoids sending database/player identifiers.
    // X also deduplicates the same saved pick across concurrent responses/tabs.
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`fcc-first-pick:${pick.id}`));
    const conversionId = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
    const key = `fcc_x_first_pick:${conversionId}`;
    if (!advertisingTrackingAllowed() || firstPickAttempts.has(key)) return;
    if (sessionStorage.getItem(key)) return;
    initializeXPixel();
    if (!window.twq || window.fccXPixelStopping) return;
    firstPickAttempts.add(key);
    sessionStorage.setItem(key, "1");
    window.twq("event", eventId, { conversion_id: conversionId });
  } catch { /* Tracking/storage/SDK failures never affect the saved pick. No retries/replay. */ }
}

export function stopXPixel(preferenceSaved: boolean, explicitWithdrawal = false) {
  if ((!advertisingTrackingInitialized() && !explicitWithdrawal) || window.fccXPixelStopping) return;
  if (!advertisingTrackingInitialized() && preferenceSaved) return;
  window.fccXPixelStopping = true;
  try {
    if (window.twq) {
      window.twq.dontSetCookie = true;
      for (const feature of ["autoConfig", "autoAdvancedMatching", "dataLayerTracking", "autoDwellTracking"]) {
        window.twq("set", feature, "false", "rhi65");
      }
      if (window.twq.queue) window.twq.queue.length = 0;
    }
  } catch { /* Still unload if a vendor script or extension changes the API. */ }
  window.stop(); // Cancel an SDK download still in flight before unloading.
  // Removing a script tag does not stop SDK timers/listeners. Unload the document.
  // Preserve pathname, query (including UTMs/next), hash and session storage.
  if (preferenceSaved) window.location.reload();
  else {
    const url = new URL(window.location.href);
    url.searchParams.set("fcc_ads", "off");
    window.location.replace(url.href);
  }
}
