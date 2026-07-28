import { appendNotification } from "./notifyFeed";
import { postJsonWithAuth } from "./apiAuth";
import { getMemberElimination } from "./leagueRoundState";

const MEMBERS_SNAPSHOT_KEY = "lms_notification_members_v1";

export async function syncLeagueNotifications(playerId: string, leagueId: string) {
  if (!playerId || !leagueId) return;

  const stateResp = await postJsonWithAuth("/api/league-state", { league_id: leagueId });
  if (!stateResp.ok) return;
  const state = (await stateResp.json()) as {
    league?: any;
    rounds?: any[];
    teams?: any[];
  };
  const league = state.league;
  if (!league) return;
  const safeRounds = state.rounds ?? [];
  const teams = state.teams ?? [];
  const teamById = new Map<string, string>(
    (teams ?? []).map((team: any) => [String(team.id), String(team.name)])
  );

  const [picksResp, membersResp] = await Promise.all([
    postJsonWithAuth("/api/league-picks", { league_id: leagueId }),
    postJsonWithAuth("/api/league-members", { league_id: leagueId }),
  ]);
  if (!picksResp.ok || !membersResp.ok) return;

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

  if (league.status === "completed" && latestCompletedRound) {
    const finalRoundPicks = picks.filter((pick: any) => pick.round_id === latestCompletedRound.id);
    const myMembership =
      members.find((member: any) => String(member.player_id) === String(playerId)) ?? null;
    const myElimination = myMembership
      ? getMemberElimination(myMembership, safeRounds, picks, leagueId)
      : null;
    const through = finalRoundPicks.filter((pick: any) => pick.status === "through");
    const winner = through.length === 1 ? through[0] : null;

    if (winner?.player_id === playerId) {
      appendNotification(playerId, {
        key: `league:${leagueId}:winner:${latestCompletedRound.round_number}`,
        type: "winner",
        title: `You won ${league.name}`,
        body: `You were the last player standing after Round ${latestCompletedRound.round_number}.`,
        cta: { label: "View League", to: "/league" },
      });
    } else if (myElimination?.pick?.status === "eliminated") {
      const teamName =
        myElimination.pick?.team_id
          ? teamById.get(String(myElimination.pick.team_id)) ?? "Your team"
          : "Your team";
      appendNotification(playerId, {
        key: `league:${leagueId}:eliminated:${myElimination.round.round_number}:${playerId}`,
        type: "eliminated",
        title: "You were eliminated",
        body: `${teamName} did not win in Round ${myElimination.round.round_number}.`,
        cta: { label: "View Results", to: "/results" },
      });
    } else if (myElimination?.pick?.status === "no-pick") {
      appendNotification(playerId, {
        key: `league:${leagueId}:no-pick:${myElimination.round.round_number}:${playerId}`,
        type: "eliminated",
        title: "You were eliminated",
        body: `No pick was submitted before the Round ${myElimination.round.round_number} deadline.`,
        cta: { label: "View Results", to: "/results" },
      });
    }
  } else {
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
      } else if (myPrevPick?.status === "eliminated" || myPrevPick?.status === "no-pick") {
        appendNotification(playerId, {
          key: `league:${leagueId}:eliminated:${previousRound.round_number}`,
          type: "eliminated",
          title: `You were eliminated in Round ${previousRound.round_number}`,
          body: "Results are available in your league pages.",
          cta: { label: "View Results", to: "/results" },
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
}
