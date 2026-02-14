const STORE_KEY = "lms_store_v1";

function teamName(store: any, leagueId: string, teamId: string | undefined) {
  if (!teamId) return "—";
  const teams = (store.teams || []).filter((t: any) => t.league_id === leagueId);
  return teams.find((t: any) => t.id === teamId)?.name ?? "—";
}

export function computeOutcome(leagueId: string, playerId: string) {
  const raw = localStorage.getItem(STORE_KEY);
  if (!raw) return null;

  const store = JSON.parse(raw);
  const completedRounds = (store.rounds || [])
    .filter((r: any) => r.league_id === leagueId && r.status === "completed")
    .sort((a: any, b: any) => b.round_number - a.round_number);

  if (!completedRounds.length) return null;
  const round = completedRounds[0];

  const pick = (store.picks || []).find(
    (p: any) => p.round_id === round.id && p.player_id === playerId
  );
  if (!pick) return null;

  const pickedTeam = teamName(store, leagueId, pick.team_id);
  const picksForRound = (store.picks || []).filter((p: any) => p.round_id === round.id);
  const through = picksForRound.filter((p: any) => p.status === "through");
  const isWinner = through.length === 1 && through[0]?.player_id === playerId;

  const keyBase = `lms_outcome_shown_v1:${leagueId}:${round.round_number}:${playerId}`;

  if (isWinner) {
    return {
      type: "winner",
      title: "You've won the league",
      body: `Champion of Round ${round.round_number}.`,
      emoji: "🏆",
      stats: [
        { label: "Round", value: String(round.round_number) },
        { label: "Winning pick", value: pickedTeam },
      ],
      ctas: [
        { label: "Share", action: "share" as const },
        { label: "View Results", to: "/results" },
      ],
      key: `${keyBase}:winner`,
    };
  }

  if (pick.status === "through") {
    return {
      type: "progressed",
      title: "You're through to the next round",
      body: `Nice work - your pick survived Round ${round.round_number}.`,
      emoji: "🎉",
      stats: [
        { label: "Round", value: String(round.round_number) },
        { label: "Your pick", value: pickedTeam },
        { label: "Survivors", value: String(through.length) },
      ],
      ctas: [
        { label: "Make next pick", to: "/make-pick" },
        { label: "View Results", to: "/results" },
      ],
      key: `${keyBase}:progressed`,
    };
  }

  if (pick.status === "eliminated" || pick.status === "no-pick") {
    const why = pick.status === "no-pick" ? "Missed pick" : "Lost / draw";
    return {
      type: "eliminated",
      title: "You've been eliminated",
      body: `You're out in Round ${round.round_number}.`,
      emoji: "❌",
      stats: [
        { label: "Round reached", value: String(round.round_number) },
        { label: "Your pick", value: pickedTeam },
        { label: "Reason", value: why },
      ],
      ctas: [
        { label: "View Results", to: "/results" },
        { label: "Join new game", to: "/home" },
      ],
      key: `${keyBase}:eliminated`,
    };
  }

  return null;
}
