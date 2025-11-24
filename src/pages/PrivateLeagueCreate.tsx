// src/pages/PrivateLeagueCreate.tsx
import React, { useEffect, useMemo, useState } from "react";
import { FplGwSelect } from "../components/FplGwSelect";
import { useToast } from "../components/Toast";

const PRIVATE_STORE_KEY = "lms_private_leagues_v1";

type PrivateLeague = {
  id: string;
  name: string;
  ownerId: string;
  createdAt: string;
  startDateUtc?: string;      // FPL GW deadline_time
  fplStartEvent?: number;     // FPL event id (1–38)
  inviteCode: string;         // unique, human-friendly
};

type PrivateMembership = {
  leagueId: string;
  playerId: string;
  joinedAt: string;
  displayName?: string;
};

type PrivateStore = {
  leagues: PrivateLeague[];
  memberships: PrivateMembership[];
};

// --------- helpers ---------

function loadStore(): PrivateStore {
  try {
    const raw = localStorage.getItem(PRIVATE_STORE_KEY);
    if (!raw) return { leagues: [], memberships: [] };
    const parsed = JSON.parse(raw);
    return {
      leagues: parsed.leagues ?? [],
      memberships: parsed.memberships ?? [],
    };
  } catch {
    return { leagues: [], memberships: [] };
  }
}

function saveStore(store: PrivateStore) {
  localStorage.setItem(PRIVATE_STORE_KEY, JSON.stringify(store));
}

function generateInviteCode(existing: Set<string>): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
  while (true) {
    let code = "";
    for (let i = 0; i < 6; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
    if (!existing.has(code)) return code;
  }
}

function uuid() {
  if (typeof crypto !== "undefined" && (crypto as any).randomUUID) {
    return (crypto as any).randomUUID();
  }
  return "priv-" + Math.random().toString(36).slice(2);
}

function getPlayerId() {
  return localStorage.getItem("player_id") || "anon-player";
}

function getPlayerName() {
  return localStorage.getItem("player_name") || "You";
}

function getShareUrl(code: string) {
  const url = new URL(window.location.href);
  url.pathname = "/private/create";
  url.searchParams.set("code", code);
  return url.toString();
}

// --------- main page ---------

export function PrivateLeagueCreate() {
  const toast = useToast();
  const [store, setStore] = useState<PrivateStore>(() => loadStore());

  const [name, setName] = useState("");
  const [startEventId, setStartEventId] = useState<number | null>(null);
  const [startDeadlineISO, setStartDeadlineISO] = useState<string | null>(null);

  const [joinCode, setJoinCode] = useState("");
  const [activeLeagueId, setActiveLeagueId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string>("");

  const playerId = getPlayerId();
  const playerName = getPlayerName();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (code) setJoinCode(code.toUpperCase());
  }, []);

  useEffect(() => {
    saveStore(store);
  }, [store]);

  const myLeagues = useMemo(() => {
    const ids = new Set(
      store.memberships.filter(m => m.playerId === playerId).map(m => m.leagueId)
    );
    const leagues = store.leagues.filter(l => ids.has(l.id));
    if (!activeLeagueId && leagues.length) setActiveLeagueId(leagues[0].id);
    return leagues;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, playerId]);

  const activeLeague = useMemo(
    () => store.leagues.find(l => l.id === activeLeagueId) || null,
    [store.leagues, activeLeagueId]
  );

  const membersForActive = useMemo(() => {
    if (!activeLeague) return [];
    return store.memberships.filter(m => m.leagueId === activeLeague.id);
  }, [store.memberships, activeLeague]);

  // --------- actions ---------

  function showFeedback(
    msg: string,
    variant: "info" | "success" | "error" = "info"
  ) {
    setFeedback(msg);
    toast(msg, { variant });
    setTimeout(() => setFeedback(""), 4000);
  }

  // Create: allow if player does NOT already own a league (they may still have joined one).
  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      showFeedback("Name your private league first.", "error");
      return;
    }

    const alreadyOwner = store.leagues.some(l => l.ownerId === playerId);
    if (alreadyOwner) {
      showFeedback("You’ve already created a private league. Limit is one owned league per player.", "error");
      return;
    }

    const now = new Date().toISOString();
    const inviteCodes = new Set(store.leagues.map(l => l.inviteCode));
    const code = generateInviteCode(inviteCodes);

    const league: PrivateLeague = {
      id: uuid(),
      name: name.trim(),
      ownerId: playerId,
      createdAt: now,
      startDateUtc: startDeadlineISO ?? undefined,
      fplStartEvent: startEventId ?? undefined,
      inviteCode: code,
    };

    // Owner auto-membership (this should NOT block joining one other league later)
    const membership: PrivateMembership = {
      leagueId: league.id,
      playerId,
      joinedAt: now,
      displayName: playerName || "You",
    };

    const next: PrivateStore = {
      leagues: [...store.leagues, league],
      memberships: [...store.memberships, membership],
    };

    setStore(next);
    setName("");
    setStartEventId(null);
    setStartDeadlineISO(null);
    setActiveLeagueId(league.id);
    showFeedback(
      `Private league created. Invite code: ${code}${
        league.fplStartEvent ? ` (starts FPL GW ${league.fplStartEvent})` : ""
      }`,
      "success"
    );
  }

  // Join: allow if player has NOT already joined a non-owned league (they may own one).
  function handleJoin(e: React.FormEvent) {
    e.preventDefault();

    // Check if user already joined a league they don't own
    const joinedNonOwned = store.memberships.some(m => {
      if (m.playerId !== playerId) return false;
      const league = store.leagues.find(l => l.id === m.leagueId);
      return league ? league.ownerId !== playerId : false;
    });
    if (joinedNonOwned) {
      showFeedback("You’ve already joined a private league. Limit is one joined league per player (plus one you own).", "error");
      return;
    }

    const code = joinCode.trim().toUpperCase();
    if (!code) {
      showFeedback("Enter an invite code first.", "error");
      return;
    }
    const league = store.leagues.find(l => l.inviteCode.toUpperCase() === code);
    if (!league) {
      showFeedback("No league found for that code.", "error");
      return;
    }

    // If they’re already a member of THIS league, just surface info
    const already = store.memberships.some(
      m => m.leagueId === league.id && m.playerId === playerId
    );
    if (already) {
      setActiveLeagueId(league.id);
      showFeedback("You’re already in that private league.", "info");
      return;
    }

    const membership: PrivateMembership = {
      leagueId: league.id,
      playerId,
      joinedAt: new Date().toISOString(),
      displayName: playerName || "You",
    };

    const next: PrivateStore = {
      ...store,
      memberships: [...store.memberships, membership],
    };
    setStore(next);
    setActiveLeagueId(league.id);
    showFeedback(`Joined "${league.name}".`, "success");
  }

  function handleCopy(text: string, label: string) {
    navigator.clipboard
      .writeText(text)
      .then(() => showFeedback(`${label} copied to clipboard.`, "success"))
      .catch(() => showFeedback(`Could not copy ${label}.`, "error"));
  }

  function updateActiveLeague(patch: Partial<PrivateLeague>) {
    if (!activeLeague) return;
    const updated: PrivateLeague = { ...activeLeague, ...patch };
    const next: PrivateStore = {
      ...store,
      leagues: store.leagues.map(l => (l.id === activeLeague.id ? updated : l)),
    };
    setStore(next);
  }

  function handleDeleteActive() {
    if (!activeLeague) return;
    const ok = window.confirm(`Delete private league "${activeLeague.name}" for everyone?`);
    if (!ok) return;
    const next: PrivateStore = {
      leagues: store.leagues.filter(l => l.id !== activeLeague.id),
      memberships: store.memberships.filter(m => m.leagueId !== activeLeague.id),
    };
    setStore(next);
    setActiveLeagueId(null);
    showFeedback("Private league deleted.", "success");
  }

  const isOwner = activeLeague && activeLeague.ownerId === playerId;

  // --------- render ---------

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-6">
      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Private Leagues</h1>
          <p className="text-sm text-slate-600">
            Limit: <b>own 1</b> + <b>join 1</b> (max two total).
          </p>
        </div>
      </header>

      {feedback && (
        <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-800">
          {feedback}
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        {/* Create / Join column */}
        <div className="space-y-5">
          {/* Create */}
          <section className="card p-5 space-y-4">
            <div>
              <h2 className="text-lg font-semibold">Create a private league</h2>
              <p className="text-xs text-slate-600">
                You can <b>own one</b> private league.
              </p>
            </div>

            <form onSubmit={handleCreate} className="space-y-3">
              <div>
                <label className="label">League name</label>
                <input
                  className="input mt-1"
                  placeholder="e.g. Saturday Sweepstake, Office LMS"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div>
                <FplGwSelect
                  label="Start FPL Gameweek (optional, for your reference)"
                  onlyUpcoming
                  value={startEventId ?? undefined}
                  onChange={(id, ev) => {
                    setStartEventId(id || null);
                    setStartDeadlineISO(ev?.deadline_time ?? null);
                  }}
                  className="mt-1"
                />
              </div>

              <button type="submit" className="btn btn-primary">
                Create private league
              </button>
            </form>
          </section>

          {/* Join by code */}
          <section className="card p-5 space-y-3">
            <div>
              <h2 className="text-lg font-semibold">Join by invite code</h2>
              <p className="text-xs text-slate-600">
                You can <b>join one</b> private league (in addition to one you own).
              </p>
            </div>

            <form onSubmit={handleJoin} className="space-y-3">
              <div>
                <label className="label">Invite code</label>
                <input
                  className="input mt-1 uppercase"
                  placeholder="ABC123"
                  value={joinCode}
                  onChange={(e) =>
                    setJoinCode(e.target.value.toUpperCase().slice(0, 10))
                  }
                />
              </div>
              <button type="submit" className="btn btn-ghost">
                Join league
              </button>
            </form>
          </section>
        </div>

        {/* Manage / My leagues column */}
        <div className="space-y-4">
          <section className="card p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold">My private leagues</h2>
              {myLeagues.length > 0 && (
                <span className="text-xs text-slate-500">{myLeagues.length} total</span>
              )}
            </div>

            {myLeagues.length === 0 ? (
              <p className="text-sm text-slate-600">
                You’re not in any private leagues yet. Create one on the left,
                or join using an invite code.
              </p>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2 mb-4">
                  {myLeagues.map((lg) => {
                    const selected = lg.id === activeLeagueId;
                    return (
                      <button
                        key={lg.id}
                        type="button"
                        onClick={() => setActiveLeagueId(lg.id)}
                        className={[
                          "px-3 py-1.5 rounded-full text-xs border",
                          selected
                            ? "bg-teal-600 text-white border-teal-600"
                            : "bg-slate-50 text-slate-700 hover:bg-slate-100",
                        ].join(" ")}
                      >
                        {lg.name}
                      </button>
                    );
                  })}
                </div>

                {activeLeague ? (
                  <div className="space-y-4 border-t pt-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold">{activeLeague.name}</div>
                        <div className="text-xs text-slate-600 mt-1 space-y-0.5">
                          <div>
                            Owner: {activeLeague.ownerId === playerId ? "You" : "Another manager"}
                          </div>
                          <div>Created: {new Date(activeLeague.createdAt).toLocaleString()}</div>
                          {activeLeague.fplStartEvent && activeLeague.startDateUtc && (
                            <div>
                              Start FPL GW: <b>GW {activeLeague.fplStartEvent}</b>{" "}
                              <span className="text-[11px] text-slate-500">
                                ({new Date(activeLeague.startDateUtc).toLocaleString()})
                              </span>
                            </div>
                          )}
                          {!activeLeague.fplStartEvent && activeLeague.startDateUtc && (
                            <div>Start date: {new Date(activeLeague.startDateUtc).toLocaleString()}</div>
                          )}
                          <div>Invite code: {activeLeague.inviteCode}</div>
                        </div>
                      </div>

                      <div className="flex flex-col gap-2">
                        <button
                          type="button"
                          className="btn btn-ghost text-xs"
                          onClick={() => handleCopy(activeLeague.inviteCode, "Invite code")}
                        >
                          Copy code
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost text-xs"
                          onClick={() => handleCopy(getShareUrl(activeLeague.inviteCode), "Share link")}
                        >
                          Copy share link
                        </button>
                      </div>
                    </div>

                    {isOwner && (
                      <div className="space-y-3 border-t pt-3">
                        <div className="text-xs font-semibold text-slate-700">Owner tools</div>
                        <div className="space-y-3">
                          <div>
                            <label className="label text-xs">Rename league</label>
                            <input
                              className="input mt-1 text-xs"
                              value={activeLeague.name}
                              onChange={(e) => updateActiveLeague({ name: e.target.value })}
                            />
                          </div>

                          <div>
                            <FplGwSelect
                              label="Start FPL Gameweek (optional)"
                              onlyUpcoming={false}
                              value={activeLeague.fplStartEvent ?? undefined}
                              onChange={(id, ev) =>
                                updateActiveLeague({
                                  fplStartEvent: id || undefined,
                                  startDateUtc: ev?.deadline_time ?? undefined,
                                })
                              }
                              className="mt-1 text-xs"
                            />
                            <p className="mt-1 text-[11px] text-slate-500">
                              Reference only for now – doesn’t auto-drive rounds yet.
                            </p>
                          </div>

                          <button
                            type="button"
                            onClick={handleDeleteActive}
                            className="text-xs rounded-lg border border-rose-300 px-3 py-1.5 text-rose-700 hover:bg-rose-50"
                          >
                            Delete league
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="space-y-2 border-t pt-4">
                      <div className="text-xs font-semibold text-slate-700">
                        Members ({membersForActive.length})
                      </div>
                      {membersForActive.length === 0 ? (
                        <div className="text-xs text-slate-500">No one has joined yet.</div>
                      ) : (
                        <ul className="space-y-1 text-xs">
                          {membersForActive.map((m, i) => (
                            <li key={m.playerId + "-" + i} className="flex items-center gap-2">
                              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-700">
                                {(m.displayName || "User").slice(0, 2).toUpperCase()}
                              </span>
                              <span className="truncate">
                                {m.displayName || m.playerId.slice(0, 8)}
                              </span>
                              {m.playerId === activeLeague.ownerId && (
                                <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                                  Owner
                                </span>
                              )}
                              {m.playerId === getPlayerId() && m.playerId !== activeLeague.ownerId && (
                                <span className="ml-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-800">
                                  You
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-slate-600">
                    Select a private league above to view details and members.
                  </p>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

export default PrivateLeagueCreate;
