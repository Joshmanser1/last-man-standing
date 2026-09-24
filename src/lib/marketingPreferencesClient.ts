import { getApiHeaders } from "./apiAuth";
import { MARKETING_CONSENT_VERSION, type MarketingCaptureSource, type MarketingPreference } from "./marketingConsent";

export function marketingConsentDisabled(): boolean {
  if (typeof window === "undefined") return true;
  const query = new URLSearchParams(window.location.search);
  return import.meta.env.VITE_ENABLE_MARKETING_DEMO === "true"
    || window.location.pathname === "/demo"
    || query.get("marketingDemo") === "true" || query.get("devPreview") === "1"
    || window.sessionStorage.getItem("fcc_current_recording_v1") !== null
    || window.sessionStorage.getItem("fcc_marketing_demo_active_v1") === "1"
    || !!window.localStorage.getItem("test_user_override")
    || window.localStorage.getItem("dev_switcher") === "1";
}

async function request(update?: { marketing_opt_in: boolean; capture_source: MarketingCaptureSource }): Promise<MarketingPreference> {
  if (marketingConsentDisabled()) throw new Error("Email preferences are disabled in demo and test mode.");
  const headers = await getApiHeaders();
  if (!headers.Authorization) throw new Error("Sign in to manage email preferences.");
  if (marketingConsentDisabled()) throw new Error("Email preferences are disabled in demo and test mode.");
  const response = await fetch("/api/marketing-preferences", {
    method: update ? "POST" : "GET", headers,
    ...(update ? { body: JSON.stringify({ ...update, consent_version: MARKETING_CONSENT_VERSION }) } : {}),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body) throw new Error(body?.error || "Email preferences are temporarily unavailable.");
  return body as MarketingPreference;
}

export const getMarketingPreference = () => request();
export const setMarketingPreference = (optIn: boolean, source: MarketingCaptureSource) =>
  request({ marketing_opt_in: optIn, capture_source: source });
