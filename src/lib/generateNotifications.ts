import { appendNotification } from "./notifyFeed";
import { postJsonWithAuth } from "./apiAuth";
import { getLeagueOutcomeForPlayer } from "./leagueOutcome";
import { loadLeagueRoundState } from "./leagueRoundState";
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

  let state;
  try {
    state = await loadLeagueRoundState(leagueId);
  } catch (err: any) {
    pushOutcomeDebugError("loadLeagueRoundState", err?.message ?? "Failed to load league state");
    return { outcome: null };
  }
  const league = state.league;
  if (!league) return { outcome: null };
  const safeRounds = state.rounds ?? [];
  const teams = state.teams ?? [];
  const picks = state.allLeaguePicks ?? [];
  const members = state.memberships ?? [];
  const currentRound = state.currentLeagueRound ?? safeRounds[safeRounds.length - 1] ?? null;

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

  const playerOutcome = getLeagueOutcomeForPlayer(playerId, leagueId, {
    ...state,
    league,
    rounds: safeRounds,
    teams,
    memberships: members,
    allLeaguePicks: picks,
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
