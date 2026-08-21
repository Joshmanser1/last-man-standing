import type { League, ManagedLeagueTheme } from "../data/types";

type LeagueLike = League & Record<string, unknown>;

const DEFAULT_TAGLINE = "One team. One win. Survive and go again.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function cleanString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeTheme(value: unknown): ManagedLeagueTheme | null {
  if (!isRecord(value)) return null;

  const enabled = value.enabled;
  const hostName = cleanString(value.hostName);
  if (enabled !== true || !hostName) return null;

  return {
    enabled: true,
    hostName,
    hostLogoUrl: cleanString(value.hostLogoUrl),
    displayName: cleanString(value.displayName),
    primaryColour: cleanString(value.primaryColour),
    secondaryColour: cleanString(value.secondaryColour),
    managed: value.managed === true,
    eyebrow: cleanString(value.eyebrow),
    tagline: cleanString(value.tagline) ?? DEFAULT_TAGLINE,
  };
}

function getThemeFromMetadata(metadata: unknown) {
  if (!isRecord(metadata)) return null;
  return (
    normalizeTheme(metadata.managed_theme) ??
    normalizeTheme(metadata.theme) ??
    normalizeTheme(metadata.branding)
  );
}

export function resolveManagedLeagueTheme(league: LeagueLike | null | undefined) {
  if (!league) return null;

  return (
    normalizeTheme(league.managed_theme) ??
    normalizeTheme(league.theme) ??
    normalizeTheme(league.branding) ??
    getThemeFromMetadata(league.metadata)
  );
}

export { DEFAULT_TAGLINE };
