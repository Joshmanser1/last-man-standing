// src/pages/PrivateLeagueJoin.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useToast } from "../components/Toast";

const PRIVATE_STORE_KEY = "lms_private_leagues_v1";

type PrivateLeague = {
  id: string;
  name: string;
  ownerId: string;
  createdAt: string;
  inviteCode: string;
  startDateUtc?: string;
  fplStartEvent?: number;
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

function getPlayerId() {
  return localStorage.getItem("player_id") || "anon-player";
}

function getPlayerName() {
  return localStorage.getItem("player_name") || "You";
}

// --------- main page ---------

export function PrivateLeagueJoin() {
  const [store, setStore] = useState<PrivateStore>(() => loadStore());

  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const navigate = useNavigate();
  const toast = useToast();

  const playerId = getPlayerId();
  const playerName = getPlayerName();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const c = params.get("code");
    if (c) setCode(c.toUpperCase());
  }, []);

  useEffect(() => {
    saveStore(store);
  }, [store]);

  const found = useMemo(() => {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return null;
    return store.leagues.find(l => l.inviteCode.toUpperCase() === trimmed) || null;
  }, [code, store.leagues]);

  function alreadyJoinedNonOwned(): boolean {
    return store.memberships.some(m => {
      if (m.playerId !== playerId) return false;
      const league = store.leagues.find(l => l.id === m.leagueId);
      return league ? league.ownerId !== playerId : false;
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Enforce: can join at most ONE non-owned league (owning one is fine)
    if (alreadyJoinedNonOwned()) {
      setError("You’ve already joined a private league. Limit is one joined league per player (plus one you own).");
      return;
    }

    const trimmed = code.trim().toUpperCase();
    if (!trimmed) {
      setError("Enter an invite code first.");
      return;
    }

    const league = store.leagues.find(l => l.inviteCode.toUpperCase() === trimmed) || null;
    if (!league) {
      setError(
        "No private league found for that code on this device. In this alpha build, private leagues are stored locally in your browser, so invite codes only work on the device that created the league."
      );
      return;
    }

    // If already member of this league, just inform
    const alreadyHere = store.memberships.some(
      m => m.leagueId === league.id && m.playerId === playerId
    );
    if (alreadyHere) {
      toast(`You’re already in “${league.name}”.`, { variant: "info" });
      navigate("/private/create");
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
    toast(`Joined “${league.name}”.`, { variant: "success" });
    navigate("/private/create");
  }

  return (
    <div className="max-w-lg mx-auto p-4 sm:p-6 space-y-4">
      <header>
        <h1 className="text-2xl font-bold mb-2">Join a private league</h1>
        <p className="text-sm text-slate-600">
          Limit: <b>own 1</b> + <b>join 1</b>.
          <br />
          <span className="text-xs">
            For this alpha build, private leagues are stored locally in your browser —
            invite codes only work on the device that created the league.
          </span>
        </p>
      </header>

      <form onSubmit={handleSubmit} className="card p-5 space-y-3">
        <div>
          <label className="label">Invite code</label>
          <input
            className="input mt-1 uppercase"
            placeholder="ABC123"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 10))}
            autoFocus
          />
          {found ? (
            <div className="mt-1 text-xs text-slate-600">
              League: <b>{found.name}</b>{" "}
              {found.fplStartEvent && found.startDateUtc ? (
                <span className="text-slate-500">
                  (starts GW {found.fplStartEvent} — {new Date(found.startDateUtc).toLocaleString()})
                </span>
              ) : null}
            </div>
          ) : code ? (
            <div className="mt-1 text-xs text-slate-500">No match yet…</div>
          ) : null}
        </div>

        <button type="submit" className="btn btn-primary">
          Check code &amp; join
        </button>

        {error && (
          <div className="text-sm text-rose-700 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
            {error}
          </div>
        )}
      </form>

      <div className="flex items-center gap-2">
        <button className="btn btn-ghost text-sm" onClick={() => navigate("/private/create")}>
          Go to Private hub
        </button>
      </div>
    </div>
  );
}

export default PrivateLeagueJoin;
