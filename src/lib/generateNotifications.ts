import { supa } from "../lib/supabaseClient";
import { appendNotification } from "./notifyFeed";

const MEMBERS_SNAPSHOT_KEY = "lms_notification_members_v1";

export async function syncLeagueNotifications(playerId: string, leagueId: string) {
  if (!playerId || !leagueId) return;

  const [{ data: league }, { data: rounds }] = await Promise.all([
    supa
      .from("leagues")
      .select("id, name, current_round, status, is_test")
      .eq("id", leagueId)
      .is("deleted_at", null)
      .maybeSingle(),
    supa.from("rounds").select("*").eq("league_id", leagueId).order("round_number", { ascending: true }),
  ]);
  if (!league) return;
  const safeRounds = rounds ?? [];

  const [picksResp, membersResp] = await Promise.all([
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
  if (!picksResp.ok || !membersResp.ok) return;

  const picks = (await picksResp.json()) as Array<any>;
  const members = (await membersResp.json()) as Array<any>;
  const currentRound =
    safeRounds.find((round: any) => round.round_number === league.current_round) ||
    safeRounds[safeRounds.length - 1];

  const currentRoundOpen =
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
      });
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
