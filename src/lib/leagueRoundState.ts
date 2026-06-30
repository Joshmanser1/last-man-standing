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
  playersById: Record<string, any>;
  submittedCount: number;
  pendingCount: number;
  throughCount: number;
  eliminatedCount: number;
  noPickCount: number;
  topPickedTeams: Array<{ teamId: string; teamName: string; count: number }>;
  viewerPick: any | null;
  viewerId: string;
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
  const currentRound = await dataService.getCurrentRound(leagueId).catch(() => null);
  const round =
    (selectedRoundId ? rounds.find((r: any) => r.id === selectedRoundId) : null) ??
    currentRound ??
    rounds[rounds.length - 1] ??
    null;
  const selectedRoundPicks = round
    ? allLeaguePicks.filter((pick: any) => pick.round_id === round.id)
    : [];

  const playersById: Record<string, any> = {};
  for (const member of memberships) {
    if (typeof member.player_id === "string") {
      playersById[member.player_id] = {
        id: member.player_id,
        display_name: member.display_name ?? null,
      };
    }
  }

  const submittedCount = selectedRoundPicks.filter((p: any) => p.status !== "no-pick").length;
  const pendingCount = selectedRoundPicks.filter((p: any) => p.status === "pending").length;
  const throughCount = selectedRoundPicks.filter((p: any) => p.status === "through").length;
  const eliminatedCount = selectedRoundPicks.filter((p: any) => p.status === "eliminated").length;
  const noPickCount = selectedRoundPicks.filter((p: any) => p.status === "no-pick").length;

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
      ? selectedRoundPicks.find((pick: any) => pick.player_id === viewerId) ?? null
      : null;

  return {
    league: league ?? null,
    rounds,
    round,
    memberships,
    teams: teams || [],
    allLeaguePicks,
    selectedRoundPicks,
    playersById,
    submittedCount,
    pendingCount,
    throughCount,
    eliminatedCount,
    noPickCount,
    topPickedTeams,
    viewerPick,
    viewerId,
  };
}
