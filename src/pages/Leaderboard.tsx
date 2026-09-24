import { displayNameOrFallback as resolveDisplayName } from "../lib/displayName";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import * as htmlToImage from "html-to-image";
import { GameSelector } from "../components/GameSelector";
import ManagedLeagueStrip from "../components/ManagedLeagueStrip";
import { LeagueStatusBanner } from "../components/LeagueStatusBanner";
import { useToast } from "../components/Toast";
import { useFirstPickGuidance } from "../hooks/useFirstPickGuidance";
import { postJsonWithAuth } from "../lib/apiAuth";
import { getEffectiveUserId } from "../lib/auth";
import { resolveManagedLeagueTheme } from "../lib/leagueTheme";
import { isRoundRevealable, shouldHidePickForViewer } from "../lib/roundReveal";
import { buildRoundEntries } from "../lib/leagueRoundState";
import { TeamBadge } from "../components/TeamBadge";
import { fetchFplTeams } from "../lib/fpl";

type ID = string;

type League = {
  id: ID;
  name: string;
  current_round: number;
  fpl_start_event?: number;
  status?: string;
};

type Round = {
  id: ID;
  league_id: ID;
  round_number: number;
  status: "upcoming" | "locked" | "completed";
  pick_deadline_utc?: string;
};

type Player = { id: ID; display_name: string };
type Membership = {
  id: ID;
  league_id: ID;
  player_id: ID;
  is_active: boolean;
  joined_at: string;
  final_position?: number;
};
type Pick = {
  id: ID;
  league_id: ID;
  round_id: ID;
  player_id: ID;
  team_id: ID;
  status: "pending" | "through" | "eliminated" | "no-pick";
  reason?: "loss" | "draw" | "no-pick";
};
type Team = { id: ID; league_id: ID; name: string; code: string; fplTeamCode?: number };
type ViewMode = "leaderboard" | "matrix" | "eliminations";
type EliminationRow = {
  playerId: ID;
  roundNumber: number;
  playerName: string;
  team?: Team;
  teamName: string;
  reason: string;
  when: string;
};

type LeaderboardPreviewState = {
  league: League;
  rounds: Round[];
  teams: Team[];
  memberships: Membership[];
  picks: Pick[];
  playersById: Map<ID, Player>;
  viewerId: ID;
};

function PlayerName({ name, isViewer }: { name: string; isViewer: boolean }) {
  return (
    <span className="leaderboard-player-name">
      <span>{name}</span>
      {isViewer && (
        <span className="leaderboard-you-badge">
          You
        </span>
      )}
    </span>
  );
}

function teamShort(name: string) {
  const cleaned = name.replace(/\s+/g, " ").trim();
  if (cleaned.length <= 4) return cleaned;
  const caps = cleaned
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  if (caps.length >= 3 && caps.length <= 4) return caps.slice(0, 3);
  return cleaned.slice(0, 3);
}

function getDevPreviewState(): LeaderboardPreviewState | null {
  if (!import.meta.env.DEV) return null;

  const leagueId = "dev-leaderboard-command-centre";
  const roundIds = ["dev-leaderboard-r1", "dev-leaderboard-r2", "dev-leaderboard-r3"];
  const players = [
    ["viewer", "Alex Morgan"],
    ["ava", "Ava Patel"],
    ["ben", "Ben Carter"],
    ["chloe", "Chloe Williams"],
    ["dan", "Dan Hughes"],
    ["ella", "Ella Brown"],
    ["frank", "Frank Miller"],
    ["grace", "Grace Hall"],
    ["harry", "Harry Jones"],
    ["isla", "Isla Wilson"],
    ["jack", "Jack Taylor"],
    ["kate", "Kate Evans"],
    ["liam", "Liam Scott"],
    ["mia", "Mia Turner"],
  ] as const;
  const eliminated = new Set(["grace", "harry", "isla", "jack", "kate", "liam", "mia"]);
  const teamRows: Array<[string, string, string, number]> = [
    ["arsenal", "Arsenal", "ARS", 3],
    ["liverpool", "Liverpool", "LIV", 14],
    ["chelsea", "Chelsea", "CHE", 8],
    ["man-city", "Manchester City", "MCI", 43],
    ["spurs", "Tottenham Hotspur", "TOT", 17],
    ["newcastle", "Newcastle United", "NEW", 4],
  ];
  const activePlayers = players.filter(([id]) => !eliminated.has(id));
  const historicalPicks: Pick[] = players.flatMap(([playerId], index) => {
    const roundOneTeam = teamRows[index % teamRows.length][0];
    const eliminatedInRoundOne = playerId === "mia";
    const eliminatedInRoundTwo = ["grace", "harry", "isla", "jack", "kate", "liam"].includes(playerId);
    return [
      {
        id: `dev-r1-${playerId}`,
        league_id: leagueId,
        round_id: roundIds[0],
        player_id: playerId,
        team_id: roundOneTeam,
        status: eliminatedInRoundOne ? "eliminated" : "through",
        ...(eliminatedInRoundOne ? { reason: "loss" as const } : {}),
      },
      ...(!eliminatedInRoundOne
        ? [
            {
              id: `dev-r2-${playerId}`,
              league_id: leagueId,
              round_id: roundIds[1],
              player_id: playerId,
              team_id: teamRows[(index + 1) % teamRows.length][0],
              status: eliminatedInRoundTwo ? ("eliminated" as const) : ("through" as const),
              ...(eliminatedInRoundTwo ? { reason: "draw" as const } : {}),
            },
          ]
        : []),
    ];
  });
  const currentPicks: Pick[] = activePlayers.map(([playerId], index) => ({
    id: `dev-r3-${playerId}`,
    league_id: leagueId,
    round_id: roundIds[2],
    player_id: playerId,
    team_id: teamRows[(index + 2) % teamRows.length][0],
    status: "pending",
  }));

  return {
    league: {
      id: leagueId,
      name: "North London Command Centre LMS",
      current_round: 3,
      fpl_start_event: 6,
      status: "active",
    },
    rounds: [
      { id: roundIds[0], league_id: leagueId, round_number: 1, status: "completed", pick_deadline_utc: "2026-08-30T11:30:00Z" },
      { id: roundIds[1], league_id: leagueId, round_number: 2, status: "completed", pick_deadline_utc: "2026-09-06T11:30:00Z" },
      { id: roundIds[2], league_id: leagueId, round_number: 3, status: "upcoming", pick_deadline_utc: "2026-09-26T11:30:00Z" },
    ],
    teams: teamRows.map(([id, name, code, fplTeamCode]) => ({
      id,
      league_id: leagueId,
      name,
      code,
      fplTeamCode,
    })),
    memberships: players.map(([playerId], index) => ({
      id: `${leagueId}:${playerId}`,
      league_id: leagueId,
      player_id: playerId,
      is_active: !eliminated.has(playerId),
      joined_at: `2026-09-${String(1 + index).padStart(2, "0")}T12:00:00Z`,
    })),
    picks: [...historicalPicks, ...currentPicks],
    playersById: new Map(players.map(([id, display_name]) => [id, { id, display_name }])),
    viewerId: "viewer",
  };
}

export function Leaderboard() {
  const navigate = useNavigate();
  const toast = useToast();
  const location = useLocation();
  const isDevPreview =
    import.meta.env.DEV && new URLSearchParams(location.search).get("devPreview") === "1";
  const previewState = isDevPreview ? getDevPreviewState() : null;
  const [view, setView] = useState<ViewMode>("leaderboard");
  const [showElims, setShowElims] = useState(true);
  const [league, setLeague] = useState<League | null>(() => previewState?.league ?? null);
  const [rounds, setRounds] = useState<Round[]>(() => previewState?.rounds ?? []);
  const [teams, setTeams] = useState<Team[]>(() => previewState?.teams ?? []);
  const [memberships, setMemberships] = useState<Membership[]>(() => previewState?.memberships ?? []);
  const [picks, setPicks] = useState<Pick[]>(() => previewState?.picks ?? []);
  const [playersById, setPlayersById] = useState<Map<ID, Player>>(
    () => previewState?.playersById ?? new Map()
  );
  const [viewerId, setViewerId] = useState(() => previewState?.viewerId ?? "");
  const [loading, setLoading] = useState<boolean>(() => !isDevPreview);
  const [exporting, setExporting] = useState(false);
  const [fplTeamCodes, setFplTeamCodes] = useState<Record<string, number>>({});
  const [showOverflowCue, setShowOverflowCue] = useState(false);
  const [leagueId, setLeagueId] = useState(
    () => previewState?.league.id ?? localStorage.getItem("active_league_id") ?? ""
  );

  const exportRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const guidance = useFirstPickGuidance(isDevPreview ? undefined : leagueId);
  const managedTheme = useMemo(() => resolveManagedLeagueTheme(league as any), [league]);
  const isManagedLeague = !!managedTheme?.enabled;

  function changeView(next: ViewMode) {
    setView(next);
    const search = new URLSearchParams(location.search);
    search.set("view", next);
    navigate(`/leaderboard?${search.toString()}`, { replace: true });
  }

  useEffect(() => {
    const q = new URLSearchParams(location.search).get("view");
    if (q === "eliminations" || q === "matrix" || q === "leaderboard") {
      setView(q);
    }
  }, [location.search]);

  useEffect(() => {
    if (isDevPreview) return;

    (async () => {
      setLoading(true);
      try {
        const uid = (await getEffectiveUserId()) || "";
        setViewerId(uid);
        let nextLeagueId = leagueId;
        if (!nextLeagueId && uid) {
          const resp = await fetch("/api/user-leagues", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ user_id: uid }),
          });
          if (resp.ok) {
            const visible = (await resp.json()) as Array<any>;
            nextLeagueId = visible[0]?.id ?? "";
            if (nextLeagueId) {
              localStorage.setItem("active_league_id", nextLeagueId);
              setLeagueId(nextLeagueId);
            }
          }
        }
        if (!nextLeagueId) {
          setLeague(null);
          setRounds([]);
          setTeams([]);
          setMemberships([]);
          setPicks([]);
          setPlayersById(new Map());
          return;
        }

        const leagueStateResp = await postJsonWithAuth("/api/league-state", {
          league_id: nextLeagueId,
        });
        if (!leagueStateResp.ok) {
          setLeague(null);
          setRounds([]);
          setTeams([]);
          setMemberships([]);
          setPicks([]);
          setPlayersById(new Map());
          return;
        }
        const leagueState = (await leagueStateResp.json()) as {
          league?: League | null;
          rounds?: Round[];
          teams?: Team[];
        };
        if (!leagueState.league) {
          setLeague(null);
          setRounds([]);
          setTeams([]);
          setMemberships([]);
          setPicks([]);
          setPlayersById(new Map());
          return;
        }
        setLeague(leagueState.league);

        const [picksResp, memberResp] = await Promise.all([
          postJsonWithAuth("/api/league-picks", { league_id: nextLeagueId }),
          postJsonWithAuth("/api/league-members", { league_id: nextLeagueId }),
        ]);
        if (!memberResp.ok) throw new Error("Failed to load league members");
        if (!picksResp.ok) throw new Error("Failed to load league picks");
        const memberRows = (await memberResp.json()) as Array<any>;
        const pickRows = (await picksResp.json()) as Pick[];

        setRounds((leagueState.rounds ?? []) as Round[]);
        setTeams((leagueState.teams ?? []) as Team[]);
        setMemberships(
          (memberRows ?? []).map((m: any) => ({
            id: `${m.league_id}:${m.player_id}`,
            league_id: m.league_id,
            player_id: m.player_id,
            is_active: m.is_active,
            joined_at: m.joined_at,
          })) as Membership[]
        );
        setPicks(pickRows ?? []);

        const map = new Map<ID, Player>();
        (memberRows ?? []).forEach((m: any) => {
          if (typeof m.player_id === "string") {
            map.set(m.player_id, { id: m.player_id, display_name: m.display_name ?? "" });
          }
        });
        setPlayersById(map);
      } finally {
        setLoading(false);
      }
    })();
  }, [isDevPreview, leagueId]);

  useEffect(() => {
    if (isDevPreview) return;

    void fetchFplTeams()
      .then((fplTeams) => {
        const codes = Object.fromEntries(
          fplTeams
            .filter((team) => Number.isInteger(team.code) && team.code > 0)
            .flatMap((team) => [
              [team.name.trim().toLowerCase(), team.code],
              [team.short_name.trim().toLowerCase(), team.code],
            ])
        );
        setFplTeamCodes(codes);
      })
      .catch(() => {
        // Crests are decorative; TeamBadge retains the safe initials fallback.
        setFplTeamCodes({});
      });
  }, [isDevPreview]);

  const teamsById = useMemo(() => {
    const map = new Map<ID, Team>();
    for (const t of teams || []) map.set(t.id, t);
    return map;
  }, [teams]);

  const effectivePicks = useMemo(() => {
    const byRound = new Map<string, Round>(rounds.map((round) => [round.id, round]));
    const synthetic: Pick[] = [];

    for (const round of rounds) {
      const { selectedRoundEntries } = buildRoundEntries(
        league?.id ?? leagueId,
        round,
        rounds,
        memberships,
        picks,
        round.status === "locked" || round.status === "completed"
      );
      for (const entry of selectedRoundEntries) {
        if ((entry as any).synthetic) synthetic.push(entry as Pick);
      }
    }

    return [...picks, ...synthetic].filter((pick) => byRound.has(pick.round_id));
  }, [leagueId, league, memberships, picks, rounds]);

  const picksByPlayerByRound = useMemo(() => {
    const map = new Map<ID, Map<number, Pick>>();
    if (!league) return map;
    const leaguePicks = effectivePicks.filter((p) => p.league_id === league.id);
    const roundById = new Map<ID, Round>();
    for (const r of rounds) roundById.set(r.id, r);

    for (const p of leaguePicks) {
      const r = roundById.get(p.round_id);
      if (!r) continue;
      if (!map.has(p.player_id)) map.set(p.player_id, new Map());
      map.get(p.player_id)!.set(r.round_number, p);
    }
    return map;
  }, [effectivePicks, league, rounds]);

  const rows = useMemo(() => {
    const membershipByPlayerId = new Map<ID, Membership>();
    for (const membership of memberships) {
      membershipByPlayerId.set(membership.player_id, membership);
    }
    const playerIds = Array.from(
      new Set([...memberships.map((m) => m.player_id), ...effectivePicks.map((p) => p.player_id)])
    );

    const items = playerIds.map((playerId) => {
      const membership =
        membershipByPlayerId.get(playerId) ??
        ({
          id: `${league?.id ?? leagueId}:${playerId}`,
          league_id: league?.id ?? leagueId,
          player_id: playerId,
          is_active: false,
          joined_at: "",
        } as Membership);
      const player = playersById.get(playerId);
      const display = resolveDisplayName(player?.display_name);
      const alive = !!membership.is_active;
      const state = league?.status === "completed" && alive ? "Winner" : alive ? "Alive" : "Eliminated";
      const lastElimRound = (() => {
        if (alive) return undefined;
        let elim: number | undefined;
        const perRound = picksByPlayerByRound.get(playerId);
        if (perRound) {
          for (const [rd, p] of Array.from(perRound.entries()).sort((a, b) => a[0] - b[0])) {
            if (p.status === "eliminated" || p.status === "no-pick") {
              elim = rd;
              break;
            }
          }
        }
        return elim;
      })();

      return {
        membership,
        playerId,
        name: display,
        isViewer: playerId === viewerId && !!viewerId,
        sortName: display,
        alive,
        state,
        sortKey: alive ? 1e9 : lastElimRound ?? 0,
      };
    });

    const filtered = showElims ? items : items.filter((r) => r.alive);
    filtered.sort((a, b) => {
      if (b.sortKey !== a.sortKey) return b.sortKey - a.sortKey;
      return a.sortName.localeCompare(b.sortName);
    });
    return filtered;
  }, [memberships, playersById, picksByPlayerByRound, showElims, effectivePicks, league, leagueId, viewerId]);

  const matrixRows = useMemo(() => {
    const playersWithSubmittedPicks = new Set(
      picks
        .filter(
          (pick) =>
            pick.league_id === league?.id &&
            pick.status !== "no-pick" &&
            typeof pick.team_id === "string" &&
            teamsById.has(pick.team_id)
        )
        .map((pick) => pick.player_id)
    );
    return rows.filter((row) => playersWithSubmittedPicks.has(row.playerId));
  }, [league, picks, rows, teamsById]);

  const eliminationRows = useMemo(() => {
    const byRound = new Map<string, Round>(rounds.map((r) => [r.id, r]));
    return effectivePicks
      .filter((p) => p.status === "eliminated" || p.status === "no-pick")
      .map((p) => {
        const round = byRound.get(p.round_id);
        const team = teamsById.get(p.team_id);
        return {
          playerId: p.player_id,
          roundNumber: round?.round_number ?? 0,
          playerName: resolveDisplayName(playersById.get(p.player_id)?.display_name),
          team,
          teamName: team?.name ?? "\u2014",
          reason: p.reason ?? (p.status === "no-pick" ? "no-pick" : "loss"),
          when: round?.pick_deadline_utc ?? "",
        } as EliminationRow;
      })
      .sort((a, b) => b.roundNumber - a.roundNumber || a.playerName.localeCompare(b.playerName));
  }, [effectivePicks, rounds, teamsById, playersById]);

  const maxRound = rounds.length > 0 ? Math.max(...rounds.map((r) => r.round_number)) : 0;
  const roundsByNumber = useMemo(
    () => new Map<number, Round>(rounds.map((round) => [round.round_number, round])),
    [rounds]
  );

  function updateOverflowCue() {
    const board = boardRef.current;
    if (!board) return;

    const remaining = board.scrollWidth - board.clientWidth - board.scrollLeft;
    setShowOverflowCue(remaining > 2);
  }

  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;

    const onScroll = () => updateOverflowCue();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(onScroll);
    board.addEventListener("scroll", onScroll, { passive: true });
    observer?.observe(board);
    onScroll();

    return () => {
      board.removeEventListener("scroll", onScroll);
      observer?.disconnect();
    };
  }, [view, maxRound, matrixRows.length, eliminationRows.length]);

  function symbolForPick(p?: Pick) {
    if (!p) return "";
    const team = teamsById.get(p.team_id);
    const code = team?.code?.trim().toUpperCase() || (team ? teamShort(team.name) : "");
    if (p.status === "through") return `${code} \u2713`;
    if (p.status === "eliminated" || p.status === "no-pick") return `${code} \u2715`;
    return `${code}`;
  }

  function matrixCellValue(roundNumber: number, playerId: ID, pick?: Pick) {
    const round = roundsByNumber.get(roundNumber);
    if (!round) return "";
    if (round.round_number > (league?.current_round ?? 0)) return "";
    if (
      shouldHidePickForViewer({
        round,
        viewerId,
        playerId,
      })
    ) {
      return "Hidden until deadline";
    }
    return symbolForPick(pick);
  }

  function fplTeamCodeFor(team?: Team) {
    if (!team) return undefined;
    return (
      team.fplTeamCode ??
      fplTeamCodes[team.code.trim().toLowerCase()] ??
      fplTeamCodes[team.name.trim().toLowerCase()]
    );
  }

  function renderPickCell(roundNumber: number, row: (typeof matrixRows)[number], pick?: Pick) {
    const round = roundsByNumber.get(roundNumber);
    const value = matrixCellValue(roundNumber, row.playerId, pick);
    if (!round || !value) {
      return <span className="leaderboard-empty-cell" aria-hidden="true">-</span>;
    }

    // Eliminated players cannot have a meaningful future survival entry.
    if (!row.alive && !pick && round.round_number > (row.sortKey || 0)) {
      return <span className="leaderboard-empty-cell" aria-hidden="true">-</span>;
    }

    if (value === "Hidden until deadline") {
      return (
        <span className="leaderboard-hidden-pick" title="Hidden until deadline">
          <span aria-hidden="true">&#128274;</span>
          <span>Hidden</span>
        </span>
      );
    }

    const team = teamsById.get(pick?.team_id ?? "");
    if (!team) return <span className="leaderboard-empty-cell">{value}</span>;

    const failed = pick?.status === "eliminated" || pick?.status === "no-pick";
    const through = pick?.status === "through";
    return (
      <span className={`leaderboard-pick-cell ${failed ? "is-failed" : ""}`}>
        <TeamBadge
          code={team.code}
          name={team.name}
          fplTeamCode={fplTeamCodeFor(team)}
          size="sm"
        />
        <span className="leaderboard-pick-code">{team.code}</span>
        {(through || failed) && (
          <span className={`leaderboard-pick-mark ${failed ? "is-failed" : ""}`} aria-label={failed ? "Eliminated" : "Through"}>
            {failed ? "x" : "✓"}
          </span>
        )}
      </span>
    );
  }

  async function exportPNG() {
    if (!exportRef.current || !league || exporting) return;
    setExporting(true);
    const source = exportRef.current;
    const clone = source.cloneNode(true) as HTMLDivElement;
    const wrapper = document.createElement("div");
    wrapper.style.position = "fixed";
    wrapper.style.left = "-100000px";
    wrapper.style.top = "0";
    wrapper.style.background = "#ffffff";
    wrapper.style.padding = "0";
    wrapper.style.margin = "0";
    wrapper.style.zIndex = "-1";

    clone.style.width = `${Math.max(source.scrollWidth, source.clientWidth)}px`;
    clone.style.height = "auto";
    clone.style.overflow = "visible";
    clone.style.background = "#ffffff";

    wrapper.appendChild(clone);
    document.body.appendChild(wrapper);

    try {
      const width = Math.max(clone.scrollWidth, clone.clientWidth);
      const height = Math.max(clone.scrollHeight, clone.clientHeight);
      const pixelRatio = width * height > 6_000_000 ? 1 : 2;
      const filename = `${slug(league.name)}-${view}.png`;

      const blob = await htmlToImage.toBlob(clone, {
        backgroundColor: "#ffffff",
        pixelRatio,
        width,
        height,
        style: {
          overflow: "visible",
          backgroundColor: "#ffffff",
        },
        cacheBust: true,
      });
      if (!blob) throw new Error("PNG export returned no data");

      const file = new File([blob], filename, { type: "image/png" });
      const nav = navigator as Navigator & {
        canShare?: (data?: ShareData) => boolean;
      };
      const canShareFile =
        typeof nav.share === "function" &&
        typeof nav.canShare === "function" &&
        nav.canShare({ files: [file] });

      if (canShareFile) {
        try {
          await nav.share({
            files: [file],
            title: `${league.name} leaderboard`,
            text: `${league.name} leaderboard export`,
          });
          return;
        } catch (err: any) {
          if (err?.name === "AbortError") return;
          const previewUrl = URL.createObjectURL(blob);
          const opened = window.open(previewUrl, "_blank", "noopener,noreferrer");
          window.setTimeout(() => URL.revokeObjectURL(previewUrl), 60_000);
          if (opened) return;
        }
      }

      const blobUrl = URL.createObjectURL(blob);
      const isCoarsePointer =
        typeof window.matchMedia === "function" &&
        window.matchMedia("(pointer: coarse)").matches;

      if (isCoarsePointer) {
        const opened = window.open(blobUrl, "_blank", "noopener,noreferrer");
        if (!opened) {
          const a = document.createElement("a");
          a.download = filename;
          a.href = blobUrl;
          document.body.appendChild(a);
          a.click();
          a.remove();
        }
      } else {
        const a = document.createElement("a");
        a.download = filename;
        a.href = blobUrl;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    } catch (err) {
      console.error("PNG export failed", err);
      toast("Couldn't export the leaderboard. Please try again.", { variant: "error" });
    } finally {
      wrapper.remove();
      setExporting(false);
    }
  }

  if (loading && leagueId) {
    return (
      <div className="container-page py-10 grid place-items-center text-slate-600">
        <div className="text-center">
          <div className="font-semibold mb-2">Loading active league...</div>
        </div>
      </div>
    );
  }

  if (!league) {
    return (
      <div className="container-page py-10 grid place-items-center text-slate-600">
        <div className="text-center">
          <div className="font-semibold mb-2">No active game selected</div>
        </div>
        {!leagueId && (
          <button className="btn btn-primary" onClick={() => navigate("/my-games")}>
            Open My Games
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="container-page py-6 space-y-4">
      {isDevPreview ? (
        <div className="text-right text-xs font-semibold uppercase tracking-[0.14em] text-emerald-300">
          Development preview - in-memory data
        </div>
      ) : (
        <div className="flex justify-end">
          <GameSelector
            value={leagueId}
            label="Viewing game"
            onChange={(id) => {
              setLeagueId(id);
            }}
          />
        </div>
      )}
      <ManagedLeagueStrip league={league as any} theme={managedTheme} />
      {!isDevPreview && <LeagueStatusBanner leagueId={leagueId} />}
      {guidance.shouldGuide ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
          The leaderboard will appear once players have submitted their picks.
        </div>
      ) : (
        <>
          <div className="leaderboard-toolbar">
            <div className="text-lg font-semibold text-slate-100">
              {isManagedLeague ? "Leaderboard" : `${league.name} - Leaderboard`}
            </div>
            <div className="leaderboard-controls">
              <label className="leaderboard-elims-toggle">
                <input
                  type="checkbox"
                  checked={showElims}
                  onChange={(e) => setShowElims(e.target.checked)}
                />
                Show eliminated
              </label>

              <div className="leaderboard-tabs" role="tablist" aria-label="Leaderboard views">
                <button
                  type="button"
                  className={
                    "leaderboard-tab " +
                    (view === "leaderboard"
                      ? "is-active"
                      : "")
                  }
                  onClick={() => changeView("leaderboard")}
                >
                  Standings
                </button>
                <button
                  type="button"
                  className={
                    "leaderboard-tab " +
                    (view === "matrix"
                      ? "is-active"
                      : "")
                  }
                  onClick={() => changeView("matrix")}
                >
                  Pick Matrix
                </button>
                <button
                  type="button"
                  className={
                    "leaderboard-tab " +
                    (view === "eliminations"
                      ? "is-active"
                      : "")
                  }
                  onClick={() => changeView("eliminations")}
                >
                  Eliminations
                </button>
              </div>

              <button
                type="button"
                className="btn btn-ghost leaderboard-export"
                disabled={exporting}
                onClick={exportPNG}
              >
                {exporting ? "Exporting..." : "Export PNG"}
              </button>
            </div>
          </div>

          <div
            ref={(node) => {
              exportRef.current = node;
              boardRef.current = node;
            }}
            className={`leaderboard-board leaderboard-board-${view}`}
          >
            {showOverflowCue && view !== "leaderboard" && (
              <span className="leaderboard-scroll-cue" aria-hidden="true">
                <span>›</span>
              </span>
            )}
            {view === "leaderboard" ? (
              <table className="leaderboard-table leaderboard-standings-table">
                <thead>
                  <tr>
                    <th className="leaderboard-position-heading">#</th>
                    <th>Name</th>
                    <th>State</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr
                      key={r.membership.id}
                      className={`${r.isViewer ? "is-viewer " : ""}${!r.alive ? "is-eliminated" : ""}`}
                    >
                      <td className="leaderboard-position"><span>{i + 1}</span></td>
                      <td className="leaderboard-player"><PlayerName name={r.name} isViewer={r.isViewer} /></td>
                      <td>
                        <span className={`leaderboard-state ${r.alive ? "is-alive" : "is-eliminated"}`}>
                          {r.state}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td className="px-3 py-6 text-center text-slate-500" colSpan={3}>
                        No entrants yet. Invite players to join the league.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            ) : view === "matrix" ? (
              <table className="leaderboard-table leaderboard-matrix-table">
                <thead>
                  <tr>
                    <th className="leaderboard-matrix-name">Name</th>
                    <th className="leaderboard-matrix-state">State</th>
                    {Array.from({ length: maxRound }, (_, i) => (
                      <th key={i} className="leaderboard-round-heading">{`RD${i + 1}`}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matrixRows.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-slate-500" colSpan={2 + maxRound}>
                        No entrants yet. Invite players to join the league.
                      </td>
                    </tr>
                  ) : (
                    matrixRows.map((r) => {
                      const perRound = picksByPlayerByRound.get(r.playerId);
                      return (
                        <tr key={r.membership.id} className={`${r.isViewer ? "is-viewer " : ""}${!r.alive ? "is-eliminated" : ""}`}>
                          <td className="leaderboard-player leaderboard-matrix-name"><PlayerName name={r.name} isViewer={r.isViewer} /></td>
                          <td className="leaderboard-matrix-state">
                            <span className={`leaderboard-state ${r.alive ? "is-alive" : "is-eliminated"}`}>
                              {r.state}
                            </span>
                          </td>
                          {Array.from({ length: maxRound }, (_, i) => {
                            const rd = i + 1;
                            const p = perRound?.get(rd);
                            return (
                              <td key={rd} className="leaderboard-matrix-cell">
                                {renderPickCell(rd, r, p)}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            ) : (
              <table className="leaderboard-table leaderboard-eliminations-table">
                <thead>
                  <tr>
                    <th>Round</th>
                    <th>Player</th>
                    <th>Pick</th>
                    <th>Reason</th>
                    <th className="leaderboard-locked-heading">Locked</th>
                  </tr>
                </thead>
                <tbody>
                  {eliminationRows.map((row, i) => (
                    <tr
                      key={`${row.playerName}:${row.roundNumber}:${i}`}
                      className={i === 0 || eliminationRows[i - 1]?.roundNumber !== row.roundNumber ? "leaderboard-new-elimination-round" : ""}
                    >
                      <td><span className="leaderboard-round-chip">R{row.roundNumber}</span></td>
                      <td className="leaderboard-player">
                        <PlayerName name={row.playerName} isViewer={row.playerId === viewerId && !!viewerId} />
                      </td>
                      <td>
                        {row.team ? (
                          <span className="leaderboard-eliminated-pick">
                            <TeamBadge
                              code={row.team.code}
                              name={row.team.name}
                              fplTeamCode={fplTeamCodeFor(row.team)}
                              size="sm"
                            />
                            <span>{row.teamName}</span>
                          </span>
                        ) : (
                          row.teamName
                        )}
                      </td>
                      <td>
                        <span className="leaderboard-reason">
                          {row.reason === "no-pick" ? "No Pick" : row.reason}
                        </span>
                      </td>
                      <td className="leaderboard-locked-cell">
                        {row.when ? new Date(row.when).toLocaleString() : "\u2014"}
                      </td>
                    </tr>
                  ))}
                  {eliminationRows.length === 0 && (
                    <tr>
                      <td className="px-3 py-6 text-center text-slate-500" colSpan={5}>
                        No eliminations yet. Everyone is still alive.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default Leaderboard;

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
