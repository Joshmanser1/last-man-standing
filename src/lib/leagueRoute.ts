const ACTIVE_LEAGUE_KEY = "active_league_id";

export function leagueIdFromSearch(search: string): string | null {
  const value = new URLSearchParams(search).get("league_id")?.trim();
  return value || null;
}

export function activateLeagueFromSearch(
  search: string,
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage
): string {
  const requested = leagueIdFromSearch(search);
  if (requested) {
    storage.setItem(ACTIVE_LEAGUE_KEY, requested);
    return requested;
  }
  return storage.getItem(ACTIVE_LEAGUE_KEY) ?? "";
}
