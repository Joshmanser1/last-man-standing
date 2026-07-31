import { appendNotification } from "./notifyFeed";
import { postJsonWithAuth } from "./apiAuth";
import { getLeagueOutcomeForPlayer } from "./leagueOutcome";
import { pushOutcomeDebugError } from "./outcomeDebug";

const MEMBERS_SNAPSHOT_KEY = "lms_notification_members_v1";

export type LeagueNotificationSyncResult = {
  outcome: ReturnType<typeof getLeagueOutcomeForPlayer>;
};

export async function syncLeagueNotifications(
  playerId: string,
  leagueId: string
): Promise<LeagueNotificationSyncResult> {
  if (!playerId || !leagueId) return { outcome: null };

  const stateResp = await postJsonWithAuth("/api/league-state", { league_id: leagueId });
  if (!stateResp.ok) {
    pushOutcomeDebugError("/api/league-state", `HTTP ${stateResp.status}`);
    return { outcome: null };
  }
  const state = (await stateResp.json()) as {
    league?: any;
    rounds?: any[];
    teams?: any[];
  };
  const league = state.league;
  if (!league) {
    pushOutcomeDebugError("/api/league-state", "Missing league");
    return { outcome: null };
  }
  const safeRounds = state.rounds ?? [];
  const teams = state.teams ?? [];

  const [picksResp, membersResp] = await Promise.all([
    postJsonWithAuth("/api/league-picks", { league_id: leagueId }),
    postJsonWithAuth("/api/league-members", { league_id: leagueId }),
  ]);
  if (!picksResp.ok || !membersResp.ok) {
    pushOutcomeDebugError(
      "league-members/picks",
      `members=${membersResp.status} picks=${picksResp.status}`
    );
    return { outcome: null };
  }

  const picks = (await picksResp.json()) as Array<any>;
  const members = (await membersResp.json()) as Array<any>;
  const currentRound =
    safeRounds.find((round: any) => round.round_number === league.current_round) ||
    safeRounds[safeRounds.length - 1];
  const latestCompletedRound =
    [...safeRounds]
      .filter((round: any) => round.status === "completed")
      .sort((a: any, b: any) => (b.round_number ?? 0) - (a.round_number ?? 0))[0] ?? null;

  const currentRoundOpen =
    league.status !== "completed" &&
    currentRound &&
    currentRound.status !== "completed" &&
    currentRound.status !== "locked" &&
    (league.is_test ||
      !currentRound.pick_deadline_utc ||
      Date.parse(currentRound.pick_deadline_utc) > Date.now());

  if (currentRoundOpen) {
    appendNotification(playerId, {
      key: `league:${leagueId}:round-open:${currentRound.round_number}`,
      type: "round_open",
      title: `Round ${currentRound.round_number} is now open`,
      body: `${league.name} is ready for picks.`,
      cta: { label: "Make Pick", to: "/make-pick" },
    });

    if (currentRound.pick_deadline_utc) {
      const diff = Date.parse(currentRound.pick_deadline_utc) - Date.now();
      if (diff > 0 && diff <= 24 * 60 * 60 * 1000) {
        appendNotification(playerId, {
          key: `league:${leagueId}:deadline:${currentRound.id}`,
          type: "deadline",
          title: "Deadline tomorrow",
          body: `Round ${currentRound.round_number} closes ${new Date(
            currentRound.pick_deadline_utc
          ).toLocaleString()}.`,
          cta: { label: "Make Pick", to: "/make-pick" },
        });
      }
    }
  }

  const winnerPlayerId =
    league.status === "completed" && latestCompletedRound
      ? (() => {
          const finalRoundPicks = picks.filter((pick: any) => pick.round_id === latestCompletedRound.id);
          const through = finalRoundPicks.filter((pick: any) => pick.status === "through");
          return through.length === 1 ? String(through[0].player_id) : null;
        })()
      : null;

  const playerOutcome = getLeagueOutcomeForPlayer(playerId, leagueId, {
    league,
    rounds: safeRounds,
    teams,
    memberships: members,
    allLeaguePicks: picks,
    winnerPlayerId,
  });

  if (playerOutcome?.status === "winner") {
    appendNotification(playerId, {
      key: `league:${leagueId}:winner:${playerOutcome.winningPlayerId ?? playerId}`,
      type: "winner",
      title: `You won ${league.name}`,
      body: `You were the last player standing in ${league.name}.`,
      cta: { label: "View League", to: "/league" },
    });
  } else if (playerOutcome?.status === "eliminated" && playerOutcome.eliminationRound) {
    appendNotification(playerId, {
      key: `league:${leagueId}:eliminated:${playerOutcome.eliminationRound}:${playerId}`,
      type: "eliminated",
      title: "You were eliminated",
      body: playerOutcome.eliminatedByTeam?.name
        ? `${playerOutcome.eliminatedByTeam.name} did not win in Round ${playerOutcome.eliminationRound}.`
        : `You were eliminated in Round ${playerOutcome.eliminationRound}.`,
      cta: { label: "View Leaderboard", to: "/leaderboard" },
    });
  }

  if (league.status !== "completed") {
    const previousRound =
      currentRound && currentRound.round_number > 1
        ? safeRounds.find((round: any) => round.round_number === currentRound.round_number - 1)
        : null;
    if (previousRound) {
      const myPrevPick = picks.find(
        (pick: any) => pick.round_id === previousRound.id && pick.player_id === playerId
      );
      if (myPrevPick?.status === "through") {
        appendNotification(playerId, {
          key: `league:${leagueId}:survived:${previousRound.round_number}`,
          type: "survived",
          title: `You survived Round ${previousRound.round_number}`,
          body: `Round ${currentRound?.round_number ?? previousRound.round_number + 1} is now open.`,
          cta: { label: "Make Pick", to: "/make-pick" },
        });
      }
    }
  }

  const snapshotKey = `${MEMBERS_SNAPSHOT_KEY}:${leagueId}`;
  const previousMemberIds = JSON.parse(localStorage.getItem(snapshotKey) || "[]") as string[];
  const currentMemberIds = members.map((member: any) => member.player_id).filter(Boolean);
  if (previousMemberIds.length > 0) {
    const newMembers = members.filter(
      (member: any) =>
        member.player_id &&
        member.player_id !== playerId &&
        !previousMemberIds.includes(member.player_id)
    );
    newMembers.forEach((member: any) => {
      appendNotification(playerId, {
        key: `league:${leagueId}:member-joined:${member.player_id}`,
        type: "member_joined",
        title: "New player joined the league",
        body: `${member.display_name ?? "A new player"} joined ${league.name}.`,
      });
    });
  }
  localStorage.setItem(snapshotKey, JSON.stringify(currentMemberIds));
  return { outcome: playerOutcome };
}
