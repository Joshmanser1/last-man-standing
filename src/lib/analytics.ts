type FunnelEvent =
  | "league_landing_view"
  | "join_clicked"
  | "auth_started"
  | "auth_completed"
  | "league_joined"
  | "first_pick_submitted";

type EventProperties = Record<string, string | number | boolean>;

type InviteAttribution = {
  inviteCode: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  ref?: string;
  leagueId?: string;
  tracked?: Partial<Record<FunnelEvent, true>>;
};

declare global {
  interface Window {
    umami?: {
      track?: (event: string, properties?: EventProperties) => void;
    };
  }
}

const STORAGE_KEY = "fcc_invite_attribution_v1";
const ATTRIBUTION_FIELDS = [
  ["utm_source", "utmSource"],
  ["utm_medium", "utmMedium"],
  ["utm_campaign", "utmCampaign"],
  ["utm_content", "utmContent"],
  ["utm_term", "utmTerm"],
  ["ref", "ref"],
] as const;

function clean(value: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 160) : undefined;
}

function isTrackingSuppressed() {
  if (typeof window === "undefined") return true;
  return (
    localStorage.getItem("dev_switcher") === "1" ||
    !!localStorage.getItem("test_user_override")
  );
}

function readAttribution(): InviteAttribution | null {
  if (typeof window === "undefined") return null;
  try {
    const value = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "null");
    return value && typeof value.inviteCode === "string" ? value : null;
  } catch {
    return null;
  }
}

function writeAttribution(value: InviteAttribution) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

function sameAttribution(a: InviteAttribution, b: InviteAttribution) {
  return (
    a.inviteCode === b.inviteCode &&
    ATTRIBUTION_FIELDS.every(([, key]) => a[key] === b[key])
  );
}

export function captureInviteAttribution(search: string): InviteAttribution | null {
  if (typeof window === "undefined") return null;

  const params = new URLSearchParams(search);
  const inviteCode = clean(params.get("code"))?.toUpperCase();
  if (!inviteCode) return null;

  const next: InviteAttribution = { inviteCode };
  for (const [param, key] of ATTRIBUTION_FIELDS) {
    const value = clean(params.get(param));
    if (value) next[key] = value;
  }

  const current = readAttribution();
  if (current && sameAttribution(current, next)) return current;

  writeAttribution(next);
  return next;
}

export function captureInviteAttributionFromPath(path: string | null) {
  if (typeof window === "undefined" || !path) return null;
  try {
    const url = new URL(path, window.location.origin);
    return url.pathname === "/private/join" ? captureInviteAttribution(url.search) : null;
  } catch {
    return null;
  }
}

export function inviteEventProperties(
  attribution: InviteAttribution | null,
  properties: EventProperties = {}
): EventProperties {
  const result: EventProperties = { ...properties };
  if (!attribution) return result;

  result.invite_code = attribution.inviteCode;
  if (attribution.utmSource) result.utm_source = attribution.utmSource;
  if (attribution.utmMedium) result.utm_medium = attribution.utmMedium;
  if (attribution.utmCampaign) result.utm_campaign = attribution.utmCampaign;
  if (attribution.utmContent) result.utm_content = attribution.utmContent;
  if (attribution.utmTerm) result.utm_term = attribution.utmTerm;
  if (attribution.ref) result.ref = attribution.ref;
  return result;
}

export function trackFunnelEvent(event: FunnelEvent, properties: EventProperties = {}) {
  if (isTrackingSuppressed()) return false;
  try {
    if (typeof window.umami?.track !== "function") return false;
    window.umami.track(event, properties);
    return true;
  } catch {
    return false;
  }
}

export function trackInviteEventOnce(
  event: FunnelEvent,
  attribution: InviteAttribution | null,
  properties: EventProperties = {}
) {
  if (!attribution || attribution.tracked?.[event]) return false;
  if (!trackFunnelEvent(event, inviteEventProperties(attribution, properties))) return false;

  const updated = {
    ...attribution,
    tracked: { ...attribution.tracked, [event]: true },
  };
  writeAttribution(updated);
  return true;
}

export function hasTrackedInviteEvent(event: FunnelEvent, attribution: InviteAttribution | null) {
  return attribution?.tracked?.[event] === true;
}

export function bindInviteAttributionToLeague(leagueId: string) {
  const attribution = readAttribution();
  if (!attribution || !leagueId) return null;
  const updated = { ...attribution, leagueId };
  writeAttribution(updated);
  return updated;
}

export function getInviteAttributionForLeague(leagueId: string) {
  const attribution = readAttribution();
  return attribution?.leagueId === leagueId ? attribution : null;
}
