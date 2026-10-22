import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ADVERTISING_CONSENT_KEY, CONSENT_LIFETIME_MS, allowAdvertisingInBrowserFlow, blockAdvertisingInBrowserFlow, clearAdvertisingAttribution, clearAdvertisingCookies, readAdvertisingConsent, saveAdvertisingConsent, type AdvertisingChoice } from "../lib/advertisingConsent";
import { initializeXPixel, stopXPixel, advertisingTrackingInitialized } from "../lib/xPixel";
import { clearUmamiQueue, initializeUmami } from "../lib/umamiTracking";
import { captureAttribution } from "../lib/attribution";

function startConsentedTracking() {
  if (readAdvertisingConsent()?.choice !== "accepted") return;
  captureAttribution(window.location.pathname, window.location.search);
  initializeXPixel();
  initializeUmami();
  window.dispatchEvent(new Event("fcc:advertising-consent"));
}

function clearOptionalTracking() {
  clearUmamiQueue();
  clearAdvertisingAttribution();
  clearAdvertisingCookies();
}

export function AdvertisingConsent() {
  const location = useLocation();
  const [open, setOpen] = useState(() => !readAdvertisingConsent());
  const [choice, setChoice] = useState(() => readAdvertisingConsent()?.choice);
  const [error, setError] = useState("");
  const settings = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const [expiry, setExpiry] = useState(0);

  useEffect(() => {
    // Resume only a deferred base load after leaving a credential-bearing URL.
    // The document-wide guard prevents config/page events on subsequent routes.
    startConsentedTracking();
  }, [location.pathname, location.search, location.hash]);

  useEffect(() => {
    const sync = () => {
      const consent = readAdvertisingConsent();
      setChoice(consent?.choice);
      if (consent?.choice !== "accepted") {
        clearOptionalTracking();
        stopXPixel(!!consent);
      } else startConsentedTracking();
      if (!consent) setOpen(true);
      setExpiry(consent ? consent.updatedAt + CONSENT_LIFETIME_MS : 0);
    };
    const storage = (event: StorageEvent) => {
      if (event.key === ADVERTISING_CONSENT_KEY || event.key === null) sync();
    };
    sync();
    window.addEventListener("storage", storage);
    window.addEventListener("pageshow", sync); // Includes restored browser back/forward cache.
    document.addEventListener("visibilitychange", sync);
    return () => {
      window.removeEventListener("storage", storage);
      window.removeEventListener("pageshow", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);

  useEffect(() => {
    if (!expiry) return;
    // Short checks also catch expiry in long-lived or suspended browser tabs.
    const timer = window.setInterval(() => {
      if (!readAdvertisingConsent()) {
        setChoice(undefined);
        setOpen(true);
        clearOptionalTracking();
        stopXPixel(false);
      }
    }, Math.min(60_000, Math.max(1, expiry - Date.now())));
    return () => window.clearInterval(timer);
  }, [expiry]);

  const choose = (next: AdvertisingChoice) => {
    const previous = readAdvertisingConsent();
    const saved = saveAdvertisingConsent(next);
    if (saved && next === "accepted" && previous?.choice !== "accepted") clearOptionalTracking();
    if (next === "rejected") {
      if (!saved) blockAdvertisingInBrowserFlow();
      clearOptionalTracking();
      stopXPixel(saved, true);
    }
    if (!saved) {
      setError("Your browser could not save this preference. No new advertising tracking was enabled. Allow site storage to save your choice, or choose Reject advertising to stop existing tracking.");
      return;
    }
    if (next === "accepted" && !allowAdvertisingInBrowserFlow()) {
      setError("Your browser could not enable tracking safely. Advertising remains off in this tab.");
      return;
    }
    setChoice(next);
    setExpiry(Date.now() + CONSENT_LIFETIME_MS);
    setError("");
    setOpen(false);
    if (next === "accepted") {
      const url = new URL(window.location.href);
      if (url.searchParams.get("fcc_ads") === "off") {
        url.searchParams.delete("fcc_ads");
        window.history.replaceState(window.history.state, "", url.href);
      }
      startConsentedTracking();
    }
    settings.current?.focus();
  };

  const actionClass = "min-h-11 flex-1 rounded-xl border border-emerald-300/50 bg-emerald-950 px-4 py-2 font-semibold text-white hover:bg-emerald-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300";
  return (
    <div className="relative z-[70] border-t border-emerald-300/20 bg-[#07100f] px-3 py-3 text-sm text-white sm:px-6">
      <div className="mx-auto max-w-3xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button ref={settings} type="button" aria-expanded={open} aria-controls="fcc-advertising-settings"
            className="min-h-11 rounded-lg px-2 underline underline-offset-4 focus-visible:outline focus-visible:outline-emerald-300"
            onClick={() => { setOpen(!open); if (!open) requestAnimationFrame(() => panel.current?.focus()); }}>
            Privacy settings
          </button>
          <Link to="/privacy" className="px-2 py-3 underline underline-offset-4">Privacy notice</Link>
        </div>
        {open && <section ref={panel} tabIndex={-1} id="fcc-advertising-settings" aria-labelledby="fcc-advertising-title" className="pb-2 pt-3">
          <h2 id="fcc-advertising-title" className="text-lg font-bold">Your advertising privacy</h2>
          <p className="mt-2 leading-6 text-white/80">With your permission, FCC uses Umami and campaign storage to measure visits, joins and first picks, including which ads brought visitors here. FCC also uses the X Pixel to measure visits and successful first picks for advertising measurement and campaign optimisation, with possible retargeting and Custom Audiences. X receives page, browser, device and identifier data, may link visits to your X account, and may use visit data to improve advertising and its products. You can accept or reject; either choice lets you join and play.</p>
          <p className="mt-2 text-sm text-white/70">Advertising: {choice === "accepted" ? "on" : "off"}. Your choice lasts 180 days. Change it here at any time. Email preferences are separate.</p>
          {advertisingTrackingInitialized() && <p className="mt-2 font-medium text-amber-200">Rejecting now reloads this page to stop X and Umami tracking. Finish or save any unfinished entry first. A withdrawal in another open FCC tab also reloads tabs running optional tracking.</p>}
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" className={actionClass} onClick={() => choose("accepted")}>Accept advertising</button>
            <button type="button" className={actionClass} onClick={() => choose("rejected")}>Reject advertising{advertisingTrackingInitialized() ? " and reload" : ""}</button>
          </div>
          {error && <p role="alert" className="mt-3 text-amber-200">{error}</p>}
        </section>}
      </div>
    </div>
  );
}
