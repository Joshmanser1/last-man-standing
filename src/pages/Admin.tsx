// src/pages/Admin.tsx
import { useEffect, useMemo, useState } from "react";
import { dataService } from "../data/service";
import { FplGwSelect } from "../components/FplGwSelect";

const STORE_KEY = "lms_store_v1";

type Store = {
  leagues: any[];
  rounds: any[];
  teams: any[];
  players: any[];
  memberships: any[];
  picks: any[];
  fixtures: any[];
};

type SortKey = "home" | "away" | "kickoff" | "result";

export function Admin() {
  const [allLeagues, setAllLeagues] = useState<any[]>([]);
  const [selectedLeagueId, setSelectedLeagueId] = useState<string>("");

  const [league, setLeague] = useState<any>(null);
  const [round, setRound] = useState<any>(null);
  const [teams, setTeams] = useState<any[]>([]);
  const [winners, setWinners] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [fetchSummary, setFetchSummary] = useState<string>("");

  // For "Create Next Round" FPL-based setup
  const [nextFplEvent, setNextFplEvent] = useState<number | null>(null);
  const [nextDeadlineISO, setNextDeadlineISO] = useState<string | null>(null);

  // fixtures table sorting
  const [sortKey, setSortKey] = useState<SortKey>("kickoff");
  const [sortAsc, setSortAsc] = useState<boolean>(true);

  // load leagues on mount
  useEffect(() => {
    (async () => {
      const ls = await (dataService as any).listLeagues?.();
      if (ls && Array.isArray(ls) && ls.length) {
        setAllLeagues(ls);
        setSelectedLeagueId((prev) => prev || ls[0].id);
      } else {
        // seed fallback then reload
        await (dataService as any).seed?.();
        const after = await (dataService as any).listLeagues?.();
        setAllLeagues(after || []);
        setSelectedLeagueId(after?.[0]?.id || "");
      }
    })();
  }, []);

  // toast helper
  function toast(msg: string) {
    alert(msg);
  }

  // load selected league + round + teams (+ auto-lock if deadline passed)
  useEffect(() => {
    if (!selectedLeagueId) return;

    (async () => {
      const store = JSON.parse(localStorage.getItem(STORE_KEY) || "{}") as Store;
      const l = (store.leagues || []).find((x: any) => x.id === selectedLeagueId);
      if (!l) return;
      setLeague(l);

      const r = (store.rounds || []).find(
        (x: any) => x.league_id === l.id && x.round_number === l.current_round
      );
      setRound(r || null);

      const ts = (store.teams || []).filter((t: any) => t.league_id === l.id);
      setTeams([...ts].sort((a: any, b: any) => a.name.localeCompare(b.name)));
      setFetchSummary("");
      setWinners(new Set());

      // 🔒 Auto-lock: if round is still upcoming but its deadline has passed
      if (r && r.pick_deadline_utc && r.status === "upcoming") {
        const deadlineTs = Date.parse(r.pick_deadline_utc);
        if (!Number.isNaN(deadlineTs) && Date.now() >= deadlineTs) {
          try {
            await dataService.lockRound(r.id);
            toast("Round auto-locked at deadline.");
            setRefreshTick((x) => x + 1);
            return; // avoid continuing with stale round data
          } catch (e: any) {
            toast(e?.message ?? "Failed to auto-lock round.");
          }
        }
      }
    })();
  }, [selectedLeagueId, refreshTick]);

  const store: Store | null = useMemo(() => {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      return raw ? (JSON.parse(raw) as Store) : null;
    } catch {
      return null;
    }
  }, [refreshTick]);

  const roundPicks = useMemo(() => {
    if (!store || !round) return [];
    return (store.picks || []).filter((p: any) => p.round_id === round.id);
  }, [store, round]);

  const survivors = useMemo(
    () => roundPicks.filter((p: any) => p.status === "through").length,
    [roundPicks]
  );

  // Derived FPL GW mapping label (if this game was created via Admin with a start date)
  const mappedFplEvent = useMemo(() => {
    if (!league || !round) return null;
    const base: number | undefined = (league as any).fpl_start_event;
    if (typeof base !== "number") return null;
    return base + (round.round_number - 1);
  }, [league, round]);

  function toggleWinner(teamId: string) {
    setWinners((prev) => {
      const copy = new Set(prev);
      copy.has(teamId) ? copy.delete(teamId) : copy.add(teamId);
      return copy;
    });
  }

  function resetAll() {
    localStorage.removeItem(STORE_KEY);
    location.assign("/"); // reseed
  }

  async function lockNow() {
    if (!round) return;
    setLoading(true);
    try {
      await dataService.lockRound(round.id);
      toast("Round locked. No-pick players marked.");
      setRefreshTick((x) => x + 1);
    } catch (e: any) {
      toast(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  // Manual evaluation
  async function saveResults() {
    if (!store || !round) return;
    if (winners.size === 0) {
      toast("Select at least one winning team.");
      return;
    }
    const s = structuredClone(store) as Store;
    const r = (s.rounds || []).find((x: any) => x.id === round.id);
    const picksForRound = (s.picks || []).filter((p: any) => p.round_id === round.id);

    picksForRound.forEach((p: any) => {
      if (p.status === "no-pick") return;
      if (winners.has(p.team_id)) {
        p.status = "through";
        p.reason = undefined;
      } else {
        p.status = "eliminated";
        p.reason = "loss";
      }
    });

    if (r) r.status = "completed";
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
    toast("Results saved. Round completed.");
    setRefreshTick((x) => x + 1);
  }

  async function advanceNow() {
    if (!league) return;
    setLoading(true);
    try {
      await dataService.advanceRound(league.id);
      toast("Advanced. If >1 survivor, Round +1 created.");
      setWinners(new Set());
      setFetchSummary("");
      setRefreshTick((x) => x + 1);
    } catch (e: any) {
      toast(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  // Create next round using FPL GW deadline rather than manual datetime
  async function createNext() {
    if (!league) return;
    if (!nextDeadlineISO || !nextFplEvent) {
      alert("Pick an FPL Gameweek for the next round first.");
      return;
    }
    setLoading(true);
    try {
      // You can still use the FPL GW id inside dataService.createNextRound if needed.
      await dataService.createNextRound(league.id, nextDeadlineISO);
      toast(`Next round created from FPL GW ${nextFplEvent}.`);
      setNextFplEvent(null);
      setNextDeadlineISO(null);
      setFetchSummary("");
      setRefreshTick((x) => x + 1);
    } catch (e: any) {
      toast(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  // ---------- Fixtures (API + fallback) ----------
  async function importFixturesFromLocalBackup() {
    if (!league || !round) return 0;
    try {
      const res = await fetch("/mock-fixtures.json");
      if (!res.ok) throw new Error("No local backup found");
      const data = (await res.json()) as Array<{
        event: number;
        home: string;
        away: string;
        kickoff: string | null;
        homeScore?: number | null;
        awayScore?: number | null;
        finished?: boolean;
      }>;

      const s = JSON.parse(localStorage.getItem(STORE_KEY) || "{}") as Store;
      const byCode = new Map<string, any>(
        (s.teams || [])
          .filter((t: any) => t.league_id === league.id)
          .map((t: any) => [String(t.code).toUpperCase(), t])
      );
      const r = (s.rounds || []).find((rr: any) => rr.id === round.id)!;

      let added = 0;
      for (const fx of data.filter((d) => d.event === league.current_round)) {
        const home = byCode.get(String(fx.home).toUpperCase());
        const away = byCode.get(String(fx.away).toUpperCase());
        if (!home || !away) continue;

        let existing = (s.fixtures || []).find(
          (F: any) =>
            F.round_id === r.id &&
            F.home_team_id === home.id &&
            F.away_team_id === away.id
        );
        if (!existing) {
          existing = {
            id: crypto.randomUUID(),
            round_id: r.id,
            home_team_id: home.id,
            away_team_id: away.id,
            kickoff_utc: fx.kickoff ?? undefined,
            result: "not_set",
            winning_team_id: undefined,
          };
          (s.fixtures ||= []).push(existing as any);
          added++;
        }

        if (fx.finished && fx.homeScore != null && fx.awayScore != null) {
          if (fx.homeScore > fx.awayScore) {
            existing.result = "home_win";
            existing.winning_team_id = home.id;
          } else if (fx.awayScore > fx.homeScore) {
            existing.result = "away_win";
            existing.winning_team_id = away.id;
          } else {
            existing.result = "draw";
            existing.winning_team_id = undefined;
          }
        }
      }

      localStorage.setItem(STORE_KEY, JSON.stringify(s));
      return added;
    } catch {
      return 0;
    }
  }

  async function fetchFixturesFromFpl() {
    if (!league) return;
    setLoading(true);
    try {
      const res = await (dataService as any).importFixturesForCurrentRound(league.id);
      const s = JSON.parse(localStorage.getItem(STORE_KEY) || "{}") as Store;
      const count = (s.fixtures || []).filter(
        (f: any) => f.round_id === (round?.id ?? "")
      ).length;

      const eventLabel =
        typeof res?.event === "number"
          ? `FPL GW ${res.event}`
          : mappedFplEvent != null
          ? `FPL GW ${mappedFplEvent}`
          : `current round`;

      setFetchSummary(`Imported ${count} fixtures for ${eventLabel}.`);
      setRefreshTick((x) => x + 1);
    } catch (e: any) {
      const added = await importFixturesFromLocalBackup();
      if (added > 0) {
        setFetchSummary(
          `FPL unavailable. Loaded ${added} fixtures from local backup.`
        );
        setRefreshTick((x) => x + 1);
      } else {
        setFetchSummary("Failed to fetch fixtures (FPL & local backup).");
        toast(e?.message ?? "Failed to fetch fixtures.");
      }
    } finally {
      setLoading(false);
    }
  }

  async function evaluateFromFixtures() {
    if (!round) return;
    setLoading(true);
    try {
      await (dataService as any).evaluateFromFixtures(round.id);
      toast("Picks evaluated from fixtures.");
      setRefreshTick((x) => x + 1);
    } catch (e: any) {
      toast(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  // ---------- Fixtures table helpers ----------
  const fixturesForRound = useMemo(() => {
    if (!store || !round) return [];
    return (store.fixtures || [])
      .filter((f: any) => f.round_id === round.id)
      .map((f: any) => {
        const home = teams.find((t: any) => t.id === f.home_team_id)?.name ?? "—";
        const away = teams.find((t: any) => t.id === f.away_team_id)?.name ?? "—";
        const kickoffTs = f.kickoff_utc ? Date.parse(f.kickoff_utc) : 0;
        const result =
          f.result === "home_win"
            ? `${home} win`
            : f.result === "away_win"
            ? `${away} win`
            : f.result === "draw"
            ? "Draw"
            : "Pending";
        return { ...f, homeName: home, awayName: away, kickoffTs, resultText: result };
      });
  }, [store, round, teams]);

  const sortedFixtures = useMemo(() => {
    const copy = [...fixturesForRound];
    copy.sort((a: any, b: any) => {
      let av: any, bv: any;
      if (sortKey === "home") {
        av = a.homeName;
        bv = b.homeName;
      } else if (sortKey === "away") {
        av = a.awayName;
        bv = b.awayName;
      } else if (sortKey === "kickoff") {
        av = a.kickoffTs;
        bv = b.kickoffTs;
      } else {
        av = a.resultText;
        bv = b.resultText;
      }
      if (av < bv) return sortAsc ? -1 : 1;
      if (av > bv) return sortAsc ? 1 : -1;
      return 0;
    });
    return copy;
  }, [fixturesForRound, sortKey, sortAsc]);

  function headerBtn(key: SortKey, label: string) {
    const active = sortKey === key;
    return (
      <button
        className={"text-left w-full " + (active ? "font-semibold underline" : "")}
        onClick={() => {
          if (active) setSortAsc((x) => !x);
          else {
            setSortKey(key);
            setSortAsc(true);
          }
        }}
      >
        {label} {active ? (sortAsc ? "▲" : "▼") : ""}
      </button>
    );
  }

  function resultClass(result: string) {
    if (result.includes("win")) return "text-green-700";
    if (result === "Draw") return "text-gray-700";
    if (result === "Pending") return "text-gray-500";
    return "";
  }

  if (!selectedLeagueId || !league || !round) {
    return (
      <div className="min-h-screen grid place-items-center p-6">
        <CreateGamePanel
          onCreated={(lg) => {
            setAllLeagues((prev) => [...prev, lg]);
            setSelectedLeagueId(lg.id);
          }}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-start justify-center p-4">
      <div className="w-full max-w-5xl bg-white rounded-2xl shadow-lg p-6 sm:p-8">
        {/* Top bar: game selector + create */}
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between mb-6">
          <div className="flex items-center gap-2 min-w-[180px]">
            <span className="text-sm text-slate-600">Game:</span>
            <select
              className="border rounded px-2 py-1 flex-1"
              value={selectedLeagueId}
              onChange={(e) => setSelectedLeagueId(e.target.value)}
            >
              {allLeagues.map((l: any) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>

          <CreateGameInline
            onCreated={(lg) => {
              setAllLeagues((prev) => [...prev, lg]);
              setSelectedLeagueId(lg.id);
            }}
          />
        </div>

        <div className="flex items-center justify-between gap-4 mb-6">
          <div>
            <h2 className="text-2xl font-bold">Admin Panel</h2>
            <div className="mt-2 space-y-1 text-sm text-slate-600">
              <div>
                League: <b>{league.name}</b>
              </div>
              <div>
                Current Round: <b>{round.round_number}</b> • Status:{" "}
                <b className="uppercase">{round.status}</b>
              </div>
              <div>
                Deadline:{" "}
                {round.pick_deadline_utc
                  ? new Date(round.pick_deadline_utc).toLocaleString()
                  : "—"}
              </div>
              <div>
                Picks this round: <b>{roundPicks.length}</b> • Survivors (marked):{" "}
                <b>{survivors}</b>
              </div>
              {mappedFplEvent != null && (
                <div>
                  FPL Mapping: <b>GW {mappedFplEvent}</b>{" "}
                  <span className="text-slate-500">
                    (base {league.fpl_start_event} + offset{" "}
                    {round.round_number - 1})
                  </span>
                </div>
              )}
            </div>
          </div>

          <button
            onClick={resetAll}
            className="text-sm rounded-lg border px-3 py-1.5 hover:bg-slate-50"
            title="Clear local data and reseed (dev only)"
          >
            Reset (Dev)
          </button>
        </div>

        {/* Admin actions */}
        <div className="flex flex-wrap gap-3 mb-6">
          <button
            disabled={loading}
            onClick={lockNow}
            className="rounded-lg border px-4 py-2 hover:bg-slate-50"
          >
            Lock Round
          </button>
          <button
            disabled={loading}
            onClick={saveResults}
            className="rounded-lg border px-4 py-2 hover:bg-slate-50"
          >
            Save Results (Manual)
          </button>
          <button
            disabled={loading}
            onClick={advanceNow}
            className="rounded-lg border px-4 py-2 hover:bg-slate-50"
          >
            Advance Round
          </button>

          {/* API-driven */}
          <button
            disabled={loading}
            onClick={fetchFixturesFromFpl}
            className="rounded-lg border px-4 py-2 hover:bg-slate-50"
          >
            Fetch Fixtures (EPL)
          </button>
          <button
            disabled={loading}
            onClick={evaluateFromFixtures}
            className="rounded-lg border px-4 py-2 hover:bg-slate-50"
          >
            Auto-Evaluate from Fixtures
          </button>
        </div>

        {/* Fetch summary */}
        {fetchSummary && (
          <div className="mb-4 text-sm text-slate-700">{fetchSummary}</div>
        )}

        {/* Manual Results UI */}
        <div className="mb-10">
          <h3 className="font-semibold mb-3">
            Select the teams that <span className="underline">won</span> this round
          </h3>
          <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-2">
            {teams.map((t: any) => {
              const isWinner = winners.has(t.id);
              return (
                <label
                  key={t.id}
                  className={[
                    "flex items-center justify-between rounded-lg border px-3 py-2 cursor-pointer",
                    isWinner ? "border-teal-600 bg-teal-50" : "hover:bg-slate-50",
                  ].join(" ")}
                >
                  <span className="font-medium">{t.name}</span>
                  <input
                    type="checkbox"
                    checked={isWinner}
                    onChange={() => toggleWinner(t.id)}
                    className="h-4 w-4"
                  />
                </label>
              );
            })}
          </div>
          <p className="text-xs text-slate-500 mt-2">
            Tip: lock first to auto-mark “no-pick”, then tick winners and press{" "}
            <b>Save Results (Manual)</b>. For EPL you can also use{" "}
            <b>Fetch Fixtures</b> + <b>Auto-Evaluate</b>.
          </p>
        </div>

        {/* Fixtures Viewer */}
        <div className="border-t pt-6 mt-8">
          <h3 className="font-semibold mb-3">Fixtures (Current Round)</h3>
          {sortedFixtures.length ? (
            <div className="overflow-x-auto">
              <table className="min-w-full border border-slate-200 text-sm">
                <thead className="bg-slate-100 text-slate-700">
                  <tr>
                    <th className="px-3 py-2 w-1/4">
                      {headerBtn("home", "Home")}
                    </th>
                    <th className="px-3 py-2 w-1/4">
                      {headerBtn("away", "Away")}
                    </th>
                    <th className="px-3 py-2 w-1/4">
                      {headerBtn("kickoff", "Kickoff")}
                    </th>
                    <th className="px-3 py-2 w-1/4">
                      {headerBtn("result", "Result")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedFixtures.map((f: any, i: number) => (
                    <tr key={i} className="border-t border-slate-200">
                      <td className="px-3 py-2">{f.homeName}</td>
                      <td className="px-3 py-2">{f.awayName}</td>
                      <td className="px-3 py-2">
                        {f.kickoff_utc
                          ? new Date(f.kickoff_utc).toLocaleString()
                          : "—"}
                      </td>
                      <td
                        className={
                          "px-3 py-2 font-medium " + resultClass(f.resultText)
                        }
                      >
                        {f.resultText}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-slate-500 text-sm">
              No fixtures found yet. Click <b>Fetch Fixtures (EPL)</b> to import.
            </div>
          )}
        </div>

        {/* Create Next Round */}
        <div className="border-t pt-6 mt-8">
          <h3 className="font-semibold mb-2">Create Next Round</h3>
          <div className="flex flex-col sm:flex-row gap-3 items-start">
            <div className="flex-1 min-w-[220px]">
              <FplGwSelect
                label="FPL Gameweek for next round"
                onlyUpcoming
                onChange={(id, ev) => {
                  setNextFplEvent(id);
                  if (ev) setNextDeadlineISO(ev.deadline_time);
                }}
              />
            </div>
            <button
              disabled={loading}
              onClick={createNext}
              className="rounded-lg bg-teal-600 text-white px-4 py-2 hover:bg-teal-700 disabled:opacity-60"
            >
              Create
            </button>
            <span className="text-xs text-slate-500 max-w-xs">
              This uses the official FPL deadline for the selected Gameweek as the
              pick deadline for the new round.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------- Inline Components ----------------------------- */

function CreateGameInline({ onCreated }: { onCreated: (lg: any) => void }) {
  const [name, setName] = useState("LMS Game");
  const [startEvent, setStartEvent] = useState<number | null>(null);
  const [startDeadlineISO, setStartDeadlineISO] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function createIt() {
    if (!name.trim()) {
      alert("Please enter a game name.");
      return;
    }
    if (!startDeadlineISO || !startEvent) {
      alert("Pick a starting FPL Gameweek first.");
      return;
    }

    try {
      setSaving(true);
      const lg = await (dataService as any).createGame(
        name.trim(),
        startDeadlineISO
      );
      alert(
        `Created: ${lg.name} (FPL start GW ${
          lg.fpl_start_event ?? startEvent
        })`
      );
      onCreated(lg);
    } catch (err: any) {
      console.error(err);
      alert(err?.message ?? "Failed to create game.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col sm:flex-row items-start gap-2 w-full">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="border rounded px-2 py-1 flex-1 min-w-[160px]"
        placeholder="Game name"
      />
      <div className="flex-1 min-w-[220px]">
        <FplGwSelect
          onlyUpcoming
          onChange={(id, ev) => {
            setStartEvent(id);
            if (ev) setStartDeadlineISO(ev.deadline_time);
          }}
        />
      </div>
      <button
        onClick={createIt}
        disabled={saving}
        className="border rounded px-3 py-1 hover:bg-slate-50 disabled:opacity-60"
      >
        {saving ? "Creating…" : "Create Game"}
      </button>
    </div>
  );
}

function CreateGamePanel({ onCreated }: { onCreated: (lg: any) => void }) {
  return (
    <div className="w-full max-w-xl bg-white rounded-2xl shadow p-6 space-y-4">
      <h2 className="text-xl font-semibold">
        Create your first Last Man Standing game
      </h2>
      <p className="text-slate-600 text-sm">
        Pick a starting FPL Gameweek. We’ll use the official deadline for Round 1
        and map all future rounds to the FPL calendar.
      </p>
      <CreateGameInline onCreated={onCreated} />
    </div>
  );
}
