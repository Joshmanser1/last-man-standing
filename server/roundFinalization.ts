export async function finalizeRound(supabase: any, leagueId: string, roundId: string,
  options: { lockOnly?: boolean; winners?: string[] } = {}) {
  const { data, error } = await supabase.rpc("finalize_fcc_round", {
    p_league_id: leagueId, p_round_id: roundId,
    p_finalize: !options.lockOnly, p_winners: options.winners ?? null,
  });
  if (error) throw new Error(`Round finalisation failed: ${error.message}`);
  if (!data || (!options.lockOnly && !Number.isInteger(data.survivors))) {
    throw new Error("Round finalisation returned no valid result");
  }
  return data as { survivors: number; winner_player_id: string | null; already_finalized: boolean };
}
