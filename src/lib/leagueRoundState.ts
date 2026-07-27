import { supa } from "./supabaseClient";
import { dataService } from "../data/service";
import { getEffectiveUserId } from "./auth";
import { postJsonWithAuth } from "./apiAuth";

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

function joinedBeforeRoundDeadline(member: any, round: any): boolean {
  if (!round) return false;
  const joinedAt = member?.joined_at ? Date.parse(member.joined_at) : Number.NaN;
  const deadlineAt = round?.pick_deadline_utc ? Date.parse(round.pick_deadline_utc) : Number.NaN;
  if (Number.isNaN(joinedAt) || Number.isNaN(deadlineAt)) return true;
  return joinedAt <= deadlineAt;
}

function isResolvedRound(round: any): boolean {
  return round?.status === "locked" || round?.status === "completed";
}

function pickKey(roundId: string, playerId: string) {
  return `${roundId}:${playerId}`;
}

export function wasMemberEligibleForRound(
  member: any,
  round: any,
  rounds: any[],
  allLeaguePicks: any[]
): boolean {
  if (!member?.player_id || !round?.id) return false;
  if (!joinedBeforeRoundDeadline(member, round)) return false;

  const byRoundPlayer = new Map<string, any>();
  for (const pick of allLeaguePicks || []) {
    byRoundPlayer.set(pickKey(String(pick.round_id), String(pick.player_id)), pick);
  }

  const priorRounds = [...(rounds || [])]
    .filter((candidate: any) => (candidate?.round_number ?? 0) < (round?.round_number ?? 0))
    .sort((a: any, b: any) => (a.round_number ?? 0) - (b.round_number ?? 0));

  for (const priorRound of priorRounds) {
    if (!joinedBeforeRoundDeadline(member, priorRound)) continue;
    if (!isResolvedRound(priorRound)) continue;

    const priorPick = byRoundPlayer.get(
      pickKey(String(priorRound.id), String(member.player_id))
    );
    if (!priorPick) return false;
    if (priorPick.status === "eliminated" || priorPick.status === "no-pick") {
      return false;
    }
  }

  return true;
}

export function buildRoundEntries(
  leagueId: string,
  round: any,
  rounds: any[],
  memberships: any[],
  allLeaguePicks: any[],
  shouldSynthesizeNoPicks: boolean
) {
  const selectedRoundPicks = round
    ? allLeaguePicks.filter((pick: any) => String(pick.round_id) === String(round.id))
    : [];

  if (!round) return { selectedRoundPicks, selectedRoundEntries: [] as any[] };

  const selectedRoundEntries = memberships
    .map((member: any) => {
      if (!wasMemberEligibleForRound(member, round, rounds, allLeaguePicks)) {
        return null;
      }
      const existing =
        selectedRoundPicks.find(
          (pick: any) => String(pick.player_id) === String(member.player_id)
        ) ?? null;
      if (existing) return existing;
      if (!shouldSynthesizeNoPicks) return null;
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
    })
    .filter(Boolean);

  return { selectedRoundPicks, selectedRoundEntries };
}

export function getMemberElimination(
  member: any,
  rounds: any[],
  allLeaguePicks: any[],
  leagueId: string
) {
  if (!member?.player_id) return null;
  const resolvedRounds = [...(rounds || [])]
    .filter((round: any) => isResolvedRound(round))
    .sort((a: any, b: any) => (a.round_number ?? 0) - (b.round_number ?? 0));

  for (const round of resolvedRounds) {
    if (!wasMemberEligibleForRound(member, round, rounds, allLeaguePicks)) continue;
    const pick =
      allLeaguePicks.find(
        (entry: any) =>
          String(entry.round_id) === String(round.id) &&
          String(entry.player_id) === String(member.player_id)
      ) ?? null;
    const effectivePick =
      pick ??
      ({
        id: `synthetic-no-pick:${round.id}:${member.player_id}`,
        league_id: leagueId,
        round_id: round.id,
        player_id: member.player_id,
        team_id: null,
        status: "no-pick",
        reason: "no-pick",
        synthetic: true,
      } as any);

    if (
      effectivePick.status === "eliminated" ||
      effectivePick.status === "no-pick"
    ) {
      return {
        round,
        pick: effectivePick,
      };
    }
  }

  return null;
}

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
      postJsonWithAuth("/api/league-picks", { league_id: leagueId }),
      postJsonWithAuth("/api/league-members", { league_id: leagueId }),
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
  const shouldSynthesizeNoPicks =
    !!round && (round.status === "locked" || round.status === "completed" || (league as any)?.status === "completed");
  const { selectedRoundPicks, selectedRoundEntries } = buildRoundEntries(
    leagueId,
    round,
    rounds,
    memberships,
    allLeaguePicks,
    shouldSynthesizeNoPicks
  );

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
  const finalCompletedRound =
    (league as any)?.status === "completed" ? latestCompletedRound : null;
  const finalCompletedEntries = finalCompletedRound
    ? buildRoundEntries(
        leagueId,
        finalCompletedRound,
        rounds,
        memberships,
        allLeaguePicks,
        true
      ).selectedRoundEntries
    : [];
  const survivingEntries = finalCompletedEntries.filter((pick: any) => pick.status === "through");
  const winnerEntry = survivingEntries.length === 1 ? survivingEntries[0] : null;
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
