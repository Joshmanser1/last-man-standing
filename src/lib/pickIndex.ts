type RoundIdentity = { id: string; league_id: string; round_number: number };
type PickIdentity = { league_id: string; round_id: string; player_id: string; synthetic?: boolean };

export function indexPlayerRoundPicks<T extends PickIdentity>(leagueId: string, rounds: RoundIdentity[], picks: T[]) {
  const roundNumbers = new Map(rounds.filter(r => r.league_id === leagueId).map(r => [r.id, r.round_number]));
  const result = new Map<string, Map<number, T>>();
  for (const pick of picks) {
    const number = roundNumbers.get(pick.round_id);
    if (pick.league_id !== leagueId || number === undefined) continue;
    const player = result.get(pick.player_id) ?? new Map<number, T>();
    // A display-only missed-pick entry must never replace a submitted pick.
    if (!player.has(number) || !pick.synthetic) player.set(number, pick);
    result.set(pick.player_id, player);
  }
  return result;
}
