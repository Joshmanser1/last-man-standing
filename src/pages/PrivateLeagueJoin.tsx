import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useToast } from "../components/Toast";
import { supa } from "../lib/supabaseClient";
import { dataService } from "../data/service";
import { postJsonWithAuth } from "../lib/apiAuth";

type LeaguePreview = {
  name: string;
  current_round: number;
  pick_deadline_utc: string | null;
  managed_theme: ManagedThemePreview | null;
};

type ManagedThemePreview = {
  hostName: string;
  displayName?: string;
  hostLogoUrl?: string;
  primaryColour?: string;
  secondaryColour?: string;
  eyebrow?: string;
  tagline?: string;
};

function isHexColour(value: string | undefined, fallback: string) {
  return value && /^#[0-9a-f]{3,8}$/i.test(value) ? value : fallback;
}

function formatDeadline(value: string | null) {
  if (!value) return "To be confirmed";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "To be confirmed"
    : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function getInitials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "FCC";
}

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

        if (!resp.ok || !body?.league?.name) {
          setPreview(null);
          setError(
            resp.status === 404
              ? "This invite link is invalid or unavailable."
              : body?.error || "We couldn't load this invite preview."
          );
          return;
        }

        setPreview(body.league as LeaguePreview);
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

    if (!preview) {
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

      const joinRes = await postJsonWithAuth("/api/join-league", {
        join_code: trimmed,
        role: "player",
      });

      let body: any = null;
      try {
        body = await joinRes.json();
      } catch {}

      if (!joinRes.ok) {
        setError(body?.error || "Failed to join league.");
        return;
      }

      const joinedLeagueId = typeof body?.league_id === "string" ? body.league_id : "";
      if (!joinedLeagueId) {
        setError("Joined the league, but we couldn't open it. Please try again from My Games.");
        return;
      }

      localStorage.setItem("active_league_id", joinedLeagueId);
      try {
        await dataService.getCurrentRound(joinedLeagueId);
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

  const theme = preview?.managed_theme ?? null;
  const primary = isHexColour(theme?.primaryColour, "#0f766e");
  const secondary = isHexColour(theme?.secondaryColour, "#0f172a");
  const title = theme?.displayName || preview?.name || "Private league";
  const ctaLabel = theme?.hostName ? `JOIN ${theme.hostName.toUpperCase()}'S LEAGUE` : "JOIN LEAGUE";

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 px-0 py-1 sm:py-4">
      {loadingPreview && (
        <section className="rounded-3xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-xl font-bold text-slate-900">Loading your league invite...</h1>
          <p className="mt-2 text-sm text-slate-600">Checking the league details.</p>
        </section>
      )}

      {!loadingPreview && !preview && (
        <section className="rounded-3xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-xl font-bold text-slate-900">Invite unavailable</h1>
          <p className="mt-2 text-sm text-slate-600">{error || "Enter a valid invite code to view this league."}</p>
          <div className="mx-auto mt-5 max-w-xs text-left">
            <label className="label">Invite code</label>
            <input className="input mt-1 w-full uppercase" placeholder="ABC123" value={code} onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 10))} autoFocus />
          </div>
        </section>
      )}

      {preview && (
        <>
          <section
            className="overflow-hidden rounded-3xl border border-slate-200 shadow-sm"
            style={{ background: `linear-gradient(145deg, ${primary} 0%, ${secondary} 100%)` }}
          >
            <div className="bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.22),_transparent_40%)] px-5 py-6 text-white sm:px-8 sm:py-8">
              <div className="flex min-w-0 items-start gap-3">
                {theme?.hostLogoUrl ? (
                  <img src={theme.hostLogoUrl} alt={`${theme.hostName} logo`} className="h-14 w-14 flex-none rounded-2xl border border-white/25 bg-white/10 object-cover" />
                ) : (
                  <div className="flex h-14 w-14 flex-none items-center justify-center rounded-2xl border border-white/25 bg-white/10 text-lg font-bold">{getInitials(theme?.hostName || "FCC")}</div>
                )}
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/75">{theme?.eyebrow || (theme ? "Community league" : "Fantasy Command Centre")}</p>
                  <p className="truncate text-lg font-bold tracking-wide">{theme?.hostName || "Fantasy Command Centre"}</p>
                </div>
              </div>
              <h1 className="mt-7 text-3xl font-bold uppercase leading-tight tracking-[0.04em] sm:text-4xl">{title}</h1>
              <p className="mt-3 max-w-xl text-sm leading-6 text-white/85 sm:text-base">{theme?.tagline || "One team. One win. Survive and go again."}</p>
            </div>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Current round</p><p className="mt-1 text-xl font-bold text-slate-900">Round {preview.current_round}</p></div>
              <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Pick deadline</p><p className="mt-1 text-sm font-semibold text-slate-900">{formatDeadline(preview.pick_deadline_utc)}</p></div>
            </div>
            <div className="mt-5 border-t border-slate-100 pt-5">
              <h2 className="text-base font-bold text-slate-900">Last Man Standing</h2>
              <ul className="mt-2 space-y-1 text-sm leading-6 text-slate-600"><li>Pick one Premier League team each round.</li><li>Win and you survive.</li><li>Draw, lose or miss your pick and you're out.</li><li>You can't reuse a team.</li></ul>
            </div>
            <form onSubmit={handleSubmit} className="mt-6 space-y-3">
              <button type="submit" className="btn w-full border-0 bg-emerald-500 font-bold text-slate-950 hover:bg-emerald-400" disabled={joining}>
                {joining ? "Joining..." : ctaLabel}
              </button>
              <p className="text-center text-xs text-slate-500">You will need to log in before joining this league.</p>
              {error && <div className="rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
            </form>
          </section>
        </>
      )}
    </div>
  );
}

export default PrivateLeagueJoin;
