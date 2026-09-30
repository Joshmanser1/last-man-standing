export type AttributionSnapshot = {
  source?: string;
  medium?: string;
  campaign?: string;
  content?: string;
  capturedAt: string;
};

type JoinAttributionSnapshot = AttributionSnapshot & {
  joinCode: string;
};

const FIRST_TOUCH_KEY = "fcc_attribution_first_touch_v1";
const JOIN_TOUCH_KEY = "fcc_attribution_join_touch_v1";
const MAX_VALUE_LENGTH = 160;

const PARAMETERS = [
  ["utm_source", "source"],
  ["utm_medium", "medium"],
  ["utm_campaign", "campaign"],
  ["utm_content", "content"],
] as const;

function clean(value: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, MAX_VALUE_LENGTH) : undefined;
}

function readJson<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "null");
    return value && typeof value === "object" ? value as T : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Attribution must never block navigation, authentication or joining.
  }
}

function readTrackedValues(search: string): Omit<AttributionSnapshot, "capturedAt"> | null {
  const params = new URLSearchParams(search);
  const values: Omit<AttributionSnapshot, "capturedAt"> = {};
  for (const [parameter, key] of PARAMETERS) {
    const value = clean(params.get(parameter));
    if (value) values[key] = value;
  }
  return Object.keys(values).length ? values : null;
}

export function captureAttribution(pathname: string, search: string): void {
  if (typeof window === "undefined") return;
  const values = readTrackedValues(search);
  if (!values) return;

  const capturedAt = new Date().toISOString();
  if (!readJson<AttributionSnapshot>(FIRST_TOUCH_KEY)) {
    writeJson(FIRST_TOUCH_KEY, { ...values, capturedAt });
  }

  if (pathname !== "/private/join") return;
  const joinCode = clean(new URLSearchParams(search).get("code"))?.toUpperCase();
  if (!joinCode) return;
  writeJson(JOIN_TOUCH_KEY, { ...values, joinCode, capturedAt });
}

export function getAttributionForJoin(joinCode: string): {
  firstAttribution: AttributionSnapshot | null;
  joinAttribution: JoinAttributionSnapshot | null;
} {
  const firstAttribution = readJson<AttributionSnapshot>(FIRST_TOUCH_KEY);
  const joinTouch = readJson<JoinAttributionSnapshot>(JOIN_TOUCH_KEY);
  const normalizedCode = joinCode.trim().toUpperCase();
  return {
    firstAttribution,
    joinAttribution: joinTouch?.joinCode === normalizedCode
      ? {
          ...(joinTouch.source ? { source: joinTouch.source } : {}),
          ...(joinTouch.medium ? { medium: joinTouch.medium } : {}),
          ...(joinTouch.campaign ? { campaign: joinTouch.campaign } : {}),
          ...(joinTouch.content ? { content: joinTouch.content } : {}),
          joinCode: joinTouch.joinCode,
          capturedAt: joinTouch.capturedAt,
        }
      : null,
  };
}
