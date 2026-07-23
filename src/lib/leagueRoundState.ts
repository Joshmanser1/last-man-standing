import { supa } from "./supabaseClient";
import { dataService } from "../data/service";
import { getEffectiveUserId } from "./auth";

export type LeagueRoundState = {
  league: any | null;
  rounds: any[];
  round: any | null;
  memberships: any[];
  teams: any[];
  allLeaguePicks: any[];
  selectedRoundPicks: any[];
  selectedRoundEntries: any[];
  playersById: Record<string, any>;
  submittedCount: number;
  pendingCount: number;
  throughCount: number;
  eliminatedCount: number;
  noPickCount: number;
  topPickedTeams: Array<{ teamId: string; teamName: string; count: number }>;
  viewerPick: any | null;
  viewerId: string;
  winnerPlayerId: string | null;
  winnerName: string | null;
};

export async function loadLeagueRoundState(
  leagueId: string,
  selectedRoundId?: string
): Promise<LeagueRoundState> {
  const viewerId = (await getEffectiveUserId()) ?? "";
  const [{ data: league }, { data: roundRows }, teams, picksResp, memberResp] =
    await Promise.all([
      supa
        .from("leagues")
        .select("*")
        .eq("id", leagueId)
        .is("deleted_at", null)
        .maybeSingle(),
      supa
        .from("rounds")
        .select("*")
        .eq("league_id", leagueId)
        .order("round_number", { ascending: true }),
      dataService.listTeams(leagueId).catch(() => []),
      fetch("/api/league-picks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ league_id: leagueId }),
      }),
      fetch("/api/league-members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ league_id: leagueId }),
      }),
    ]);

  if (!picksResp.ok) throw new Error("Failed to load league picks");
  if (!memberResp.ok) throw new Error("Failed to load league members");

  const allLeaguePicks = (await picksResp.json()) as any[];
  const memberships = (await memberResp.json()) as any[];
  const rounds = roundRows ?? [];
  const leagueCurrentRound =
    typeof (league as any)?.current_round === "number"
      ? ((league as any).current_round as number)
      : null;
  const currentRound = await dataService.getCurrentRound(leagueId).catch(() => null);
  const latestCompletedRound =
    [...rounds]
      .filter((r: any) => r?.status === "completed")
      .sort((a: any, b: any) => (b.round_number ?? 0) - (a.round_number ?? 0))[0] ?? null;
  const round =
    (selectedRoundId ? rounds.find((r: any) => r.id === selectedRoundId) : null) ??
    ((league as any)?.status === "completed" ? latestCompletedRound : null) ??
    (leagueCurrentRound != null
      ? rounds.find((r: any) => r.round_number === leagueCurrentRound)
      : null) ??
    currentRound ??
    rounds[rounds.length - 1] ??
    null;
  const selectedRoundPicks = round
    ? allLeaguePicks.filter((pick: any) => String(pick.round_id) === String(round.id))
    : [];
  const shouldSynthesizeNoPicks =
    !!round && (round.status === "locked" || round.status === "completed" || (league as any)?.status === "completed");
  const selectedRoundEntries = shouldSynthesizeNoPicks
    ? memberships.map((member: any) => {
        const existing =
          selectedRoundPicks.find((pick: any) => String(pick.player_id) === String(member.player_id)) ?? null;
        if (existing) return existing;
        const joinedAt = member?.joined_at ? Date.parse(member.joined_at) : Number.NaN;
        const deadlineAt = round?.pick_deadline_utc ? Date.parse(round.pick_deadline_utc) : Number.NaN;
        if (!Number.isNaN(joinedAt) && !Number.isNaN(deadlineAt) && joinedAt > deadlineAt) {
          return null;
        }
        return {
          id: `synthetic-no-pick:${round.id}:${member.player_id}`,
          league_id: leagueId,
          round_id: round.id,
          player_id: member.player_id,
          team_id: null,
          status: "no-pick",
          reason: "no-pick",
          synthetic: true,
        };
      }).filter(Boolean)
    : selectedRoundPicks;

  const playersById: Record<string, any> = {};
  for (const member of memberships) {
    if (typeof member.player_id === "string") {
      playersById[member.player_id] = {
        id: member.player_id,
        display_name: member.display_name ?? null,
      };
    }
  }

  const submittedCount = selectedRoundEntries.filter((p: any) => p.status !== "no-pick").length;
  const pendingCount = selectedRoundEntries.filter((p: any) => p.status === "pending").length;
  const throughCount = selectedRoundEntries.filter((p: any) => p.status === "through").length;
  const eliminatedCount = selectedRoundEntries.filter((p: any) => p.status === "eliminated").length;
  const noPickCount = selectedRoundEntries.filter((p: any) => p.status === "no-pick").length;

  const teamById = new Map<string, any>((teams || []).map((team: any) => [team.id, team]));
  const pickCounts = new Map<string, number>();
  for (const pick of selectedRoundPicks) {
    if (!pick.team_id) continue;
    pickCounts.set(pick.team_id, (pickCounts.get(pick.team_id) || 0) + 1);
  }
  const topCount = Math.max(0, ...Array.from(pickCounts.values()));
  const topPickedTeams = Array.from(pickCounts.entries())
    .filter(([, count]) => count === topCount && topCount > 0)
    .map(([teamId, count]) => ({
      teamId,
      teamName: teamById.get(teamId)?.name ?? "—",
      count,
    }))
    .sort((a, b) => a.teamName.localeCompare(b.teamName));

  const viewerPick =
    round && viewerId
      ? selectedRoundEntries.find((pick: any) => String(pick.player_id) === String(viewerId)) ?? null
      : null;
  const winnerEntry =
    ((league as any)?.status === "completed"
      ? selectedRoundEntries.filter((pick: any) => pick.status === "through")
      : []
    )[0] ?? null;
  const winnerPlayerId = typeof winnerEntry?.player_id === "string" ? winnerEntry.player_id : null;
  const winnerName = winnerPlayerId
    ? playersById[winnerPlayerId]?.display_name ?? winnerPlayerId
    : null;

  return {
    league: league ?? null,
    rounds,
    round,
    memberships,
    teams: teams || [],
    allLeaguePicks,
    selectedRoundPicks,
    selectedRoundEntries,
    playersById,
    submittedCount,
    pendingCount,
    throughCount,
    eliminatedCount,
    noPickCount,
    topPickedTeams,
    viewerPick,
    viewerId,
    winnerPlayerId,
    winnerName,
  };
}
