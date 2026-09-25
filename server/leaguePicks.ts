// Keyset pagination avoids PostgREST's row cap dropping later players/rounds.
export async function loadLeaguePicks(supabase: any, leagueId: string) {
  const picks: any[] = [];
  let after: string | undefined;
  for (;;) {
    let query = supabase.from("picks")
      .select("id, league_id, round_id, player_id, team_id, status, reason")
      .eq("league_id", leagueId).order("id", { ascending: true }).limit(500);
    if (after) query = query.gt("id", after);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    if (!data?.length) return picks;
    picks.push(...data);
    after = data[data.length - 1].id;
  }
}
