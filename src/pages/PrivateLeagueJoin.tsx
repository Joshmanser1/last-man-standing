import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useToast } from "../components/Toast";
import { supa } from "../lib/supabaseClient";
import { dataService } from "../data/service";

type LeaguePreview = {
  id: string;
  name: string;
  join_code: string;
  is_public?: boolean;
  is_test?: boolean;
  created_by?: string;
};

export function PrivateLeagueJoin() {
  const [code, setCode] = useState("");
  const [preview, setPreview] = useState<LeaguePreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(true);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const navigate = useNavigate();
  const toast = useToast();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setCode((params.get("code") || "").toUpperCase());
  }, []);

  useEffect(() => {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) {
      setPreview(null);
      setLoadingPreview(false);
      setError("This invite link is missing a join code.");
      return;
    }

    let active = true;

    const loadPreview = async () => {
      setLoadingPreview(true);
      setError(null);
      try {
        const resp = await fetch("/api/league-by-code", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ join_code: trimmed }),
        });

        let body: any = null;
        try {
          body = await resp.json();
        } catch {}

        if (!active) return;

        if (!resp.ok || !body?.id) {
          setPreview(null);
          setError(body?.error || "This invite link is invalid or expired.");
          return;
        }

        setPreview(body as LeaguePreview);
      } catch (err: any) {
        if (!active) return;
        setPreview(null);
        setError(err?.message || "Failed to load this invite.");
      } finally {
        if (active) setLoadingPreview(false);
      }
    };

    void loadPreview();
    return () => {
      active = false;
    };
  }, [code]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmed = code.trim().toUpperCase();
    if (!trimmed) {
      setError("Enter an invite code first.");
      return;
    }

    if (!preview?.id) {
      setError("This invite link is invalid or expired.");
      return;
    }

    try {
      setJoining(true);
      const { data } = await supa.auth.getUser();
      const user = data.user;
      if (!user?.id) {
        setError("You must be logged in to join this league.");
        return;
      }

      const joinRes = await fetch("/api/join-league", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          join_code: trimmed,
          player_id: user.id,
          role: "player",
        }),
      });

      let body: any = null;
      try {
        body = await joinRes.json();
      } catch {}

      if (!joinRes.ok) {
        setError(body?.error || "Failed to join league.");
        return;
      }

      localStorage.setItem("active_league_id", preview.id);
      try {
        await dataService.getCurrentRound(preview.id);
      } catch {
        // active league selection does not depend on current-round lookup succeeding
      }

      toast(`Joined ${preview.name}`, { variant: "success" });
      navigate("/private/create", { replace: true });
    } catch (err: any) {
      setError(err?.message || "Failed to join league.");
    } finally {
      setJoining(false);
    }
  }

  const subtitle = useMemo(() => {
    if (loadingPreview) return "Loading invite...";
    if (preview) return `League: ${preview.name}`;
    if (error) return error;
    return "Enter a valid invite code to continue.";
  }, [error, loadingPreview, preview]);

  return (
    <div className="max-w-lg mx-auto p-4 sm:p-6 space-y-4">
      <header>
        <h1 className="text-2xl font-bold mb-2">Join a private league</h1>
        <p className="text-sm text-slate-600">
          Confirm before joining. This page will not join the league automatically.
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
          <div className="mt-1 text-xs text-slate-600">{subtitle}</div>
          {preview ? (
            <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <div className="font-medium text-slate-900">{preview.name}</div>
              <div className="mt-1 text-xs text-slate-600">Code: {preview.join_code}</div>
            </div>
          ) : null}
        </div>

        <button
          type="submit"
          className="btn btn-primary"
          disabled={loadingPreview || joining || !preview}
        >
          {joining ? "Joining..." : "Confirm & join"}
        </button>

        {error && !loadingPreview && (
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
