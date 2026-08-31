// src/pages/Admin.tsx
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import ManagedLeagueStrip from "../components/ManagedLeagueStrip";
import { dataService } from "../data/service";
import { FplGwSelect } from "../components/FplGwSelect";
import { postJsonWithAuth } from "../lib/apiAuth";
import { fetchBootstrap } from "../lib/fpl";
import type { League, ManagedLeagueTheme } from "../data/types";
import { devOn, localAuthed } from "../lib/auth";
import {
  deleteManagedBrandingLogo,
  getManagedBrandingLogoFilename,
  isManagedBrandingLogoUrl,
  uploadManagedBrandingLogo,
  validateManagedBrandingLogoFile,
} from "../lib/managedBrandingLogo";

const STORE_KEY = "lms_store_v1";
const SEED_SENTINEL = "lms_seed_done";

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

const TEST_USERS = [
  { id: "43951243-7e27-4af1-99ec-bf9d2eef195c", name: "Angel" },
  { id: "31c1e106-1df5-4832-b3c3-576f2984c44e", name: "Josh M" },
  { id: "cdf92fde-fd55-4688-8b8e-2330f6cdca9c", name: "Matthew Nixon" },
] as const;

type ManagedThemeDraft = {
  enabled: boolean;
  managed: boolean;
  hostName: string;
  hostLogoUrl: string;
  displayName: string;
  primaryColour: string;
  secondaryColour: string;
  eyebrow: string;
  tagline: string;
};

type FounderLeagueDraft = {
  name: string;
  isPublic: boolean;
  joinCode: string;
  startEventId: number | null;
  startDeadlineISO: string | null;
};

const EMPTY_MANAGED_THEME_DRAFT: ManagedThemeDraft = {
  enabled: false,
  managed: true,
  hostName: "",
  hostLogoUrl: "",
  displayName: "",
  primaryColour: "",
  secondaryColour: "",
  eyebrow: "",
  tagline: "",
};

const EMPTY_FOUNDER_LEAGUE_DRAFT: FounderLeagueDraft = {
  name: "Founder League",
  isPublic: false,
  joinCode: "",
  startEventId: null,
  startDeadlineISO: null,
};

function getUnavailableRound(leagueLike: { current_round?: number | null } | null) {
  return {
    id: "",
    round_number:
      typeof leagueLike?.current_round === "number" ? leagueLike.current_round : 0,
    status: "unavailable",
    pick_deadline_utc: "",
  };
}

function generateInviteCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

function draftFromManagedTheme(theme: unknown): ManagedThemeDraft {
  if (!theme || typeof theme !== "object" || Array.isArray(theme)) {
    return { ...EMPTY_MANAGED_THEME_DRAFT };
  }

  const source = theme as Record<string, unknown>;
  return {
    enabled: source.enabled === true,
    managed: source.managed !== false,
    hostName: typeof source.hostName === "string" ? source.hostName : "",
    hostLogoUrl: typeof source.hostLogoUrl === "string" ? source.hostLogoUrl : "",
    displayName: typeof source.displayName === "string" ? source.displayName : "",
    primaryColour: typeof source.primaryColour === "string" ? source.primaryColour : "",
    secondaryColour: typeof source.secondaryColour === "string" ? source.secondaryColour : "",
    eyebrow: typeof source.eyebrow === "string" ? source.eyebrow : "",
    tagline: typeof source.tagline === "string" ? source.tagline : "",
  };
}

function buildManagedThemePayload(draft: ManagedThemeDraft): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    enabled: draft.enabled,
    managed: draft.managed,
  };

  const assignIfPresent = (
    key:
      | "hostName"
      | "hostLogoUrl"
      | "displayName"
      | "primaryColour"
      | "secondaryColour"
      | "eyebrow"
      | "tagline"
  ) => {
    const value = draft[key].trim();
    if (value) payload[key] = value;
  };

  assignIfPresent("hostName");
  assignIfPresent("hostLogoUrl");
  assignIfPresent("displayName");
  assignIfPresent("primaryColour");
  assignIfPresent("secondaryColour");
  assignIfPresent("eyebrow");
  assignIfPresent("tagline");

  return payload;
}

export function Admin() {
  async function runTickNow() {
    try {
      const key =
        (import.meta as any)?.env?.VITE_CRON_SECRET ||
        localStorage.getItem("cron_secret") ||
        "";

      const res = await fetch("/api/tick?key=" + encodeURIComponent(key), {
        cache: "no-store",
      });

      const json = await res.json();
      alert(JSON.stringify(json, null, 2));
    } catch (err: any) {
      alert(err?.message ?? "Failed to run tick.");
    }
  }
  const [allLeagues, setAllLeagues] = useState<any[]>([]);
  const [selectedLeagueId, setSelectedLeagueId] = useState<string>("");

  const [league, setLeague] = useState<any>(null);
  const [round, setRound] = useState<any>(null);
  const [teams, setTeams] = useState<any[]>([]);
  const [winners, setWinners] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [fetchSummary, setFetchSummary] = useState<string>("");

  // Next round (FPL)
  const [nextFplEvent, setNextFplEvent] = useState<number | null>(null);
  const [nextDeadlineISO, setNextDeadlineISO] = useState<string | null>(null);

  // Fixtures table sorting
  const [sortKey, setSortKey] = useState<SortKey>("kickoff");
  const [sortAsc, setSortAsc] = useState<boolean>(true);
  const [e2eSeedStatus, setE2eSeedStatus] = useState<string>("");
  const [e2eResolveStatus, setE2eResolveStatus] = useState<string>("");
  const [siteAdminChecked, setSiteAdminChecked] = useState(false);
  const [siteAdminAllowed, setSiteAdminAllowed] = useState(false);
  const [brandingDraft, setBrandingDraft] = useState<ManagedThemeDraft>(
    EMPTY_MANAGED_THEME_DRAFT
  );
  const [brandingLoading, setBrandingLoading] = useState(false);
  const [brandingNotice, setBrandingNotice] = useState("");
  const [brandingError, setBrandingError] = useState("");
  const [brandingLogoUploading, setBrandingLogoUploading] = useState(false);
  const [brandingLogoError, setBrandingLogoError] = useState("");
  const [persistedBrandingLogoUrl, setPersistedBrandingLogoUrl] = useState("");
  const [founderDraft, setFounderDraft] = useState<FounderLeagueDraft>(
    EMPTY_FOUNDER_LEAGUE_DRAFT
  );
  const [founderCreating, setFounderCreating] = useState(false);
  const [founderError, setFounderError] = useState("");
  const [founderNotice, setFounderNotice] = useState("");
  const [roundPicks, setRoundPicks] = useState<any[]>([]);
  const [effectiveTestUserId, setEffectiveTestUserId] = useState<string>(
    () => localStorage.getItem("test_user_override") || localStorage.getItem("player_id") || ""
  );
  const brandingLogoInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const syncEffectiveTestUser = () => {
      setEffectiveTestUserId(
        localStorage.getItem("test_user_override") || localStorage.getItem("player_id") || ""
      );
    };

    window.addEventListener("storage", syncEffectiveTestUser);
    window.addEventListener("lms:store-updated", syncEffectiveTestUser);
    return () => {
      window.removeEventListener("storage", syncEffectiveTestUser);
      window.removeEventListener("lms:store-updated", syncEffectiveTestUser);
    };
  }, []);

  function toast(msg: string) {
    alert(msg);
  }
  function readStore(): Store {
    return JSON.parse(localStorage.getItem(STORE_KEY) || "{}") as Store;
  }
  function writeStore(s: Store) {
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
  }

  function switchTestUser(userId: string, userName: string) {
    localStorage.setItem("player_id", userId);
    localStorage.setItem("player_name", userName);
    localStorage.setItem("test_user_override", userId);
    localStorage.removeItem("active_league_id");
    setEffectiveTestUserId(userId);
    window.dispatchEvent(new Event("lms:store-updated"));
  }

  function clearTestUserOverride() {
    localStorage.removeItem("test_user_override");
    localStorage.removeItem("player_id");
    localStorage.removeItem("player_name");
    localStorage.removeItem("active_league_id");
    setEffectiveTestUserId("");
    window.dispatchEvent(new Event("lms:store-updated"));
  }

  // Load leagues (filter soft-deleted)
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const preferredLeagueId =
        typeof window !== "undefined" ? localStorage.getItem("active_league_id") || "" : "";

      try {
        const resp = await postJsonWithAuth("/api/admin", {
          action: "list-leagues",
        });
        if (resp.ok) {
          const adminLeagues = (await resp.json()) as Array<any>;
          const filtered = (adminLeagues || []).filter((l: any) => !l.deleted_at);
          if (cancelled) return;
          setAllLeagues(filtered);
          setSelectedLeagueId((prev) => {
            if (prev && filtered.some((l: any) => l.id === prev)) return prev;
            if (preferredLeagueId && filtered.some((l: any) => l.id === preferredLeagueId)) {
              return preferredLeagueId;
            }
            return filtered[0]?.id || "";
          });
          return;
        }
      } catch {
        // fall through to existing dev/local fallback
      }

      if (!(devOn() && localAuthed())) {
        if (cancelled) return;
        setAllLeagues([]);
        setSelectedLeagueId("");
        return;
      }

      const serverList = await (dataService as any).listLeagues?.();
      if (serverList && Array.isArray(serverList)) {
        const filtered = serverList.filter((l: any) => !l.deleted_at);
        if (cancelled) return;
        setAllLeagues(filtered);
        setSelectedLeagueId((prev) => {
          if (prev && filtered.some((l: any) => l.id === prev)) return prev;
          if (preferredLeagueId && filtered.some((l: any) => l.id === preferredLeagueId)) {
            return preferredLeagueId;
          }
          return filtered[0]?.id || "";
        });
        return;
      }

      // first run: seed
      if (!localStorage.getItem(SEED_SENTINEL)) {
        await (dataService as any).seed?.();
        localStorage.setItem(SEED_SENTINEL, "1");
        const after = (await (dataService as any).listLeagues?.()) || [];
        const filtered = after.filter((l: any) => !l.deleted_at);
        if (cancelled) return;
        setAllLeagues(filtered);
        setSelectedLeagueId((prev) => {
          if (prev && filtered.some((l: any) => l.id === prev)) return prev;
          if (preferredLeagueId && filtered.some((l: any) => l.id === preferredLeagueId)) {
            return preferredLeagueId;
          }
          return filtered[0]?.id || "";
        });
      } else {
        if (cancelled) return;
        setAllLeagues([]);
        setSelectedLeagueId("");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Load selected league/round
  useEffect(() => {
    if (!selectedLeagueId) return;
    let cancelled = false;

    (async () => {
      const selectedFromList = allLeagues.find((x: any) => x.id === selectedLeagueId);
      if (!selectedFromList || selectedFromList.deleted_at) {
        if (cancelled) return;
        setLeague(null);
        setRound(null);
        setTeams([]);
        setRoundPicks([]);
        return;
      }

      if (typeof window !== "undefined") {
        localStorage.setItem("active_league_id", selectedLeagueId);
      }

      setFetchSummary("");
      setWinners(new Set());

      try {
        const resp = await postJsonWithAuth("/api/admin", {
          action: "league-state",
          league_id: selectedLeagueId,
        });
        if (!resp.ok) {
          throw new Error("Failed to load admin league state");
        }
        const state = (await resp.json()) as {
          league?: League | null;
          current_round?: any;
          teams?: any[];
          current_round_picks?: any[];
        };
        if (cancelled) return;

        const authoritativeLeague = state.league ?? selectedFromList;
        const currentRound = state.current_round ?? getUnavailableRound(authoritativeLeague);
        const leagueTeams = state.teams ?? [];
        const picks = state.current_round_picks ?? [];

        setLeague(authoritativeLeague as any);
        setRound(currentRound);
        setTeams([...(leagueTeams || [])].sort((a: any, b: any) => a.name.localeCompare(b.name)));
        setRoundPicks(picks || []);

        if (currentRound && currentRound.pick_deadline_utc && currentRound.status === "upcoming") {
          const deadlineTs = Date.parse(currentRound.pick_deadline_utc);
          if (!Number.isNaN(deadlineTs) && Date.now() >= deadlineTs) {
            try {
              await dataService.lockRound(currentRound.id);
              setRefreshTick((x) => x + 1);
              return;
            } catch {
              // Keep passive auto-lock silent; explicit actions still show feedback.
            }
          }
        }
      } catch {
        if (cancelled) return;
        setRound(getUnavailableRound(selectedFromList));
        setTeams([]);
        setRoundPicks([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedLeagueId, refreshTick, allLeagues]);

  // Derived
  const store: Store | null = useMemo(() => {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      return raw ? (JSON.parse(raw) as Store) : null;
    } catch {
      return null;
    }
  }, [refreshTick]);

  const survivors = useMemo(
    () => roundPicks.filter((p: any) => p.status === "through").length,
    [roundPicks]
  );

  const mappedFplEvent = useMemo(() => {
    if (!league || !round?.id) return null;
    const base: number | undefined = (league as any).fpl_start_event;
    if (typeof base !== "number") return null;
    return base + (round.round_number - 1);
  }, [league, round]);

  const selectedLeagueRecord = useMemo(
    () =>
      (allLeagues.find((candidate: any) => candidate.id === selectedLeagueId) as League | undefined) ??
      null,
    [allLeagues, selectedLeagueId]
  );

  const brandingPreviewTheme = useMemo(() => {
    const payload = buildManagedThemePayload(brandingDraft);
    if (payload.enabled !== true || typeof payload.hostName !== "string") return null;
    return payload as unknown as ManagedLeagueTheme;
  }, [brandingDraft]);

  useEffect(() => {
    if (!selectedLeagueId) {
      setSiteAdminChecked(false);
      setSiteAdminAllowed(false);
      setBrandingDraft(EMPTY_MANAGED_THEME_DRAFT);
      setBrandingError("");
      setBrandingNotice("");
      setBrandingLogoError("");
      setBrandingLogoUploading(false);
      setPersistedBrandingLogoUrl("");
      return;
    }

    let cancelled = false;
    setBrandingLoading(true);
    setBrandingError("");
    setBrandingNotice("");

    (async () => {
      const resp = await postJsonWithAuth("/api/admin", {
        action: "get-managed-theme",
        league_id: selectedLeagueId,
      });

      if (cancelled) return;

      let body: any = null;
      try {
        body = await resp.json();
      } catch {
        body = null;
      }

      if (resp.status === 401 || resp.status === 403) {
        setSiteAdminAllowed(false);
        setSiteAdminChecked(true);
        const fallbackDraft = draftFromManagedTheme(selectedLeagueRecord?.managed_theme ?? null);
        setBrandingDraft(fallbackDraft);
        setPersistedBrandingLogoUrl(fallbackDraft.hostLogoUrl);
        setBrandingLoading(false);
        return;
      }

      if (!resp.ok) {
        setSiteAdminAllowed(false);
        setSiteAdminChecked(true);
        setBrandingError(body?.error ?? "Failed to load managed branding.");
        const fallbackDraft = draftFromManagedTheme(selectedLeagueRecord?.managed_theme ?? null);
        setBrandingDraft(fallbackDraft);
        setPersistedBrandingLogoUrl(fallbackDraft.hostLogoUrl);
        setBrandingLoading(false);
        return;
      }

      const nextTheme = body?.managed_theme ?? null;
      const nextDraft = draftFromManagedTheme(nextTheme);
      setSiteAdminAllowed(true);
      setSiteAdminChecked(true);
      setBrandingDraft(nextDraft);
      setPersistedBrandingLogoUrl(nextDraft.hostLogoUrl);
      setAllLeagues((prev) =>
        prev.map((item: any) =>
          item.id === selectedLeagueId ? { ...item, managed_theme: nextTheme } : item
        )
      );
      if (league?.id === selectedLeagueId) {
        setLeague((prev: any) => (prev ? { ...prev, managed_theme: nextTheme } : prev));
      }
      setBrandingLoading(false);
    })().catch((err: any) => {
      if (cancelled) return;
      setSiteAdminAllowed(false);
      setSiteAdminChecked(true);
      setBrandingError(err?.message ?? "Failed to load managed branding.");
      setBrandingLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [selectedLeagueId]);

  // Actions
  function isE2ESwitchOn() {
    try {
      return localStorage.getItem("dev_switcher") === "1";
    } catch {
      return false;
    }
  }

  async function e2eSeedGame() {
    setLoading(true);
    setE2eSeedStatus("seeding");
    try {
      const name = `E2E Seed ${new Date().toISOString().slice(0, 19)}`;
      let startDeadlineISO = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      try {
        const boot = await fetchBootstrap();
        const events = (boot?.events || []) as Array<{
          id: number;
          is_next: boolean;
          is_current: boolean;
          finished: boolean;
          deadline_time: string;
        }>;
        const chosen =
          events.find((e) => e.is_next) ||
          events.find((e) => e.is_current) ||
          events.find((e) => !e.finished) ||
          events[0];
        if (chosen?.deadline_time) startDeadlineISO = chosen.deadline_time;
      } catch {
        // fallback above keeps seed deterministic enough for E2E
      }

      const lg = await (dataService as any).createGame(name, startDeadlineISO);

      if ((dataService as any).setLeagueVisibility) {
        await (dataService as any).setLeagueVisibility(lg.id, true);
      } else if ((dataService as any).updateLeague) {
        await (dataService as any).updateLeague(lg.id, { is_public: true });
      } else {
        const st = readStore() as any;
        const idx = (st.leagues || []).findIndex((x: any) => x.id === lg.id);
        if (idx >= 0) {
          st.leagues[idx] = { ...st.leagues[idx], is_public: true };
          writeStore(st);
        }
      }

      localStorage.setItem("active_league_id", lg.id);
      localStorage.setItem("e2e_last_league_id", lg.id);

      if ((dataService as any).importFixturesForCurrentRound) {
        try {
          await (dataService as any).importFixturesForCurrentRound(lg.id);
        } catch {
          // best effort only
        }
      }

      setAllLeagues((prev) => [...prev, { ...lg, is_public: true }]);
      setSelectedLeagueId(lg.id);
      setE2eSeedStatus("done");
      toast("E2E seed complete.");
      setRefreshTick((x) => x + 1);
    } catch (e: any) {
      console.error(e);
      setE2eSeedStatus("failed");
      toast(e?.message ?? "E2E seed failed");
    } finally {
      setLoading(false);
    }
  }

  async function e2eResolveRound() {
    if (!league || !round?.id) return;
    setLoading(true);
    setE2eResolveStatus("resolving");
    try {
      try {
        await dataService.lockRound(round.id);
      } catch {
        // safe if already locked
      }

      const st = readStore();
      const r = (st.rounds || []).find((x: any) => x.id === round.id);
      const picksForRound = (st.picks || []).filter((p: any) => p.round_id === round.id);

      if (!picksForRound.length) {
        throw new Error("No picks found for this round (need players to pick first).");
      }

      const firstPlayable = picksForRound.find(
        (p: any) => p.status !== "no-pick" && p.team_id
      );
      const winningTeamId = firstPlayable?.team_id || picksForRound[0].team_id;
      if (!winningTeamId) throw new Error("Could not determine a winning team_id.");

      picksForRound.forEach((p: any) => {
        if (p.status === "no-pick") return;
        if (p.team_id === winningTeamId) {
          p.status = "through";
          p.reason = undefined;
        } else {
          p.status = "eliminated";
          p.reason = "loss";
        }
      });

      if (r) r.status = "completed";
      writeStore(st);

      try {
        await dataService.advanceRound(league.id);
      } catch {
        // best effort
      }

      setE2eResolveStatus("done");
      toast("E2E resolve complete.");
      setRefreshTick((x) => x + 1);
    } catch (e: any) {
      console.error(e);
      setE2eResolveStatus("failed");
      toast(e?.message ?? "E2E resolve failed");
    } finally {
      setLoading(false);
    }
  }

  function toggleWinner(teamId: string) {
    setWinners((prev) => {
      const copy = new Set(prev);
      copy.has(teamId) ? copy.delete(teamId) : copy.add(teamId);
      return copy;
    });
  }

  function resetAll() {
    localStorage.removeItem(STORE_KEY);
    localStorage.removeItem(SEED_SENTINEL);
    location.assign("/");
  }

  async function lockNow() {
    if (!round?.id) return;
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

  async function saveResults() {
    if (!store || !round?.id) return;
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
    writeStore(s);
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

  async function createNext() {
    if (!league) return;
    if (!nextDeadlineISO || !nextFplEvent) {
      alert("Pick an FPL Gameweek for the next round first.");
      return;
    }
    setLoading(true);
    try {
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

  async function saveManagedBranding(nextTheme: Record<string, unknown> | null) {
    if (!selectedLeagueId) return;

    const previousPersistedLogoUrl = persistedBrandingLogoUrl;
    const currentDraftLogoUrl = brandingDraft.hostLogoUrl.trim();
    const nextLogoUrl =
      nextTheme && typeof nextTheme.hostLogoUrl === "string" ? nextTheme.hostLogoUrl : "";

    setBrandingLoading(true);
    setBrandingError("");
    setBrandingNotice("");

    try {
      const resp = await postJsonWithAuth("/api/admin", {
        action: "save-managed-theme",
        league_id: selectedLeagueId,
        managed_theme: nextTheme,
      });

      let body: any = null;
      try {
        body = await resp.json();
      } catch {
        body = null;
      }

      if (resp.status === 401 || resp.status === 403) {
        setSiteAdminAllowed(false);
        setSiteAdminChecked(true);
        setBrandingError(body?.error ?? "You are not allowed to manage league branding.");
        return;
      }

      if (!resp.ok) {
        setBrandingError(body?.error ?? "Failed to save managed branding.");
        return;
      }

      const savedTheme = body?.managed_theme ?? null;
      const savedDraft = draftFromManagedTheme(savedTheme);
      setSiteAdminAllowed(true);
      setSiteAdminChecked(true);
      setBrandingDraft(savedDraft);
      setPersistedBrandingLogoUrl(savedDraft.hostLogoUrl);
      setBrandingNotice(savedTheme ? "Managed branding saved." : "Managed branding cleared.");
      setAllLeagues((prev) =>
        prev.map((item: any) =>
          item.id === selectedLeagueId ? { ...item, managed_theme: savedTheme } : item
        )
      );
      if (league?.id === selectedLeagueId) {
        setLeague((prev: any) => (prev ? { ...prev, managed_theme: savedTheme } : prev));
      }

      if (
        previousPersistedLogoUrl &&
        previousPersistedLogoUrl !== nextLogoUrl &&
        isManagedBrandingLogoUrl(previousPersistedLogoUrl)
      ) {
        try {
          await deleteManagedBrandingLogo(previousPersistedLogoUrl);
        } catch (cleanupErr: any) {
          setBrandingNotice(
            `Managed branding saved, but the previous hosted logo could not be deleted: ${
              cleanupErr?.message ?? "cleanup failed"
            }`
          );
        }
      }

      if (
        currentDraftLogoUrl &&
        currentDraftLogoUrl !== previousPersistedLogoUrl &&
        currentDraftLogoUrl !== nextLogoUrl &&
        isManagedBrandingLogoUrl(currentDraftLogoUrl)
      ) {
        try {
          await deleteManagedBrandingLogo(currentDraftLogoUrl);
        } catch {
          // Best effort cleanup for draft-only uploads after a successful save.
        }
      }
    } catch (err: any) {
      setBrandingError(err?.message ?? "Failed to save managed branding.");
    } finally {
      setBrandingLoading(false);
    }
  }

  function updateBrandingField(
    key: keyof ManagedThemeDraft,
    value: string | boolean
  ) {
    setBrandingDraft((prev) => ({
      ...prev,
      [key]: value,
    }));
  }

  function openBrandingLogoPicker() {
    if (brandingLoading || brandingLogoUploading) return;
    brandingLogoInputRef.current?.click();
  }

  async function handleManagedBrandingLogoSelected(
    event: ChangeEvent<HTMLInputElement>
  ) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !selectedLeagueId) return;

    const validation = validateManagedBrandingLogoFile(file);
    if (!validation.ok) {
      setBrandingLogoError(validation.error);
      return;
    }

    setBrandingLogoUploading(true);
    setBrandingLogoError("");
    setBrandingNotice("");

    const previousDraftLogoUrl = brandingDraft.hostLogoUrl;

    try {
      const uploaded = await uploadManagedBrandingLogo(file, selectedLeagueId);
      if (
        previousDraftLogoUrl &&
        previousDraftLogoUrl !== persistedBrandingLogoUrl &&
        isManagedBrandingLogoUrl(previousDraftLogoUrl)
      ) {
        try {
          await deleteManagedBrandingLogo(previousDraftLogoUrl);
        } catch {
          // Best effort cleanup for abandoned draft uploads only.
        }
      }

      setBrandingDraft((prev) => ({
        ...prev,
        hostLogoUrl: uploaded.publicUrl,
      }));
      setBrandingNotice("Logo uploaded. Save managed branding to persist the new logo.");
    } catch (err: any) {
      setBrandingLogoError(err?.message ?? "Failed to upload logo.");
    } finally {
      setBrandingLogoUploading(false);
    }
  }

  async function handleManagedBrandingLogoRemove() {
    if (brandingLoading || brandingLogoUploading) return;

    const currentLogoUrl = brandingDraft.hostLogoUrl.trim();
    if (
      currentLogoUrl &&
      currentLogoUrl !== persistedBrandingLogoUrl &&
      isManagedBrandingLogoUrl(currentLogoUrl)
    ) {
      try {
        await deleteManagedBrandingLogo(currentLogoUrl);
      } catch {
        // Best effort cleanup for unsaved draft uploads only.
      }
    }

    setBrandingLogoError("");
    setBrandingDraft((prev) => ({
      ...prev,
      hostLogoUrl: "",
    }));
  }

  async function handleManagedBrandingSave() {
    await saveManagedBranding(buildManagedThemePayload(brandingDraft));
  }

  async function handleManagedBrandingClear() {
    const ok = window.confirm(
      `Clear managed branding for "${selectedLeagueRecord?.name ?? league?.name ?? "this league"}"?`
    );
    if (!ok) return;
    await saveManagedBranding(null);
  }

  function handleFounderLeagueCreated(createdLeague: any) {
    if (!createdLeague?.id) return;
    localStorage.setItem("active_league_id", createdLeague.id);
    setAllLeagues((prev) => {
      const withoutExisting = prev.filter((leagueItem: any) => leagueItem.id !== createdLeague.id);
      return [...withoutExisting, createdLeague];
    });
    setSelectedLeagueId(createdLeague.id);
    setRefreshTick((x) => x + 1);
  }

  async function handleFounderLeagueCreate() {
    if (!founderDraft.name.trim()) {
      setFounderError("Please enter a league name.");
      return;
    }
    if (!founderDraft.startDeadlineISO || !founderDraft.startEventId) {
      setFounderError("Pick a starting FPL Gameweek first.");
      return;
    }

    setFounderCreating(true);
    setFounderError("");
    setFounderNotice("");

    try {
      const resp = await postJsonWithAuth("/api/admin", {
        action: "create-founder-league",
        name: founderDraft.name.trim(),
        is_public: founderDraft.isPublic,
        join_code: founderDraft.joinCode.trim() || null,
        fpl_start_event: founderDraft.startEventId,
        start_date_utc: founderDraft.startDeadlineISO,
      });

      let body: any = null;
      try {
        body = await resp.json();
      } catch {
        body = null;
      }

      if (resp.status === 401 || resp.status === 403) {
        setFounderError(body?.error ?? "You are not allowed to create founder leagues.");
        return;
      }

      if (!resp.ok) {
        setFounderError(body?.error ?? "Failed to create founder league.");
        return;
      }

      const createdLeague = body?.league ?? null;
      if (!createdLeague?.id) {
        setFounderError("Founder league creation returned no league id.");
        return;
      }

      handleFounderLeagueCreated(createdLeague);
      setFounderDraft({
        ...EMPTY_FOUNDER_LEAGUE_DRAFT,
        startEventId: founderDraft.startEventId,
        startDeadlineISO: founderDraft.startDeadlineISO,
      });
      setFounderNotice(
        `Founder league created: ${createdLeague.name}${
          createdLeague.join_code ? ` (${createdLeague.join_code})` : ""
        }`
      );
    } catch (err: any) {
      setFounderError(err?.message ?? "Failed to create founder league.");
    } finally {
      setFounderCreating(false);
    }
  }

  async function handleDeleteLeague() {
    if (!selectedLeagueId || !league) return;
    const ok = window.confirm(
      `Are you sure you want to permanently delete “${league.name}”? This will remove its rounds, fixtures, picks and memberships.`
    );
    if (!ok) return;

    setLoading(true);
    try {
      if ((dataService as any).deleteLeague) {
        await (dataService as any).deleteLeague(selectedLeagueId);
      } else {
        const s = readStore();
        const idx = (s.leagues || []).findIndex((l: any) => l.id === selectedLeagueId);
        if (idx >= 0) {
          (s.leagues as any[])[idx] = {
            ...s.leagues[idx],
            deleted_at: new Date().toISOString(),
          };
          writeStore(s);
        }
      }

      setAllLeagues((prev) => prev.filter((l) => l.id !== selectedLeagueId));
      if (localStorage.getItem("active_league_id") === selectedLeagueId) {
        localStorage.removeItem("active_league_id");
      }
      setRefreshTick((x) => x + 1);
      const next = allLeagues.find((l) => l.id !== selectedLeagueId);
      setSelectedLeagueId(next?.id || "");
      toast("League deleted.");
    } catch (e: any) {
      console.error(e);
      toast(e?.message ?? "Failed to delete league.");
    } finally {
      setLoading(false);
    }
  }

  async function setVisibility(nextPublic: boolean) {
    if (!league) return;
    setLoading(true);
    try {
      if ((dataService as any).setLeagueVisibility) {
        await (dataService as any).setLeagueVisibility(league.id, nextPublic);
      } else if ((dataService as any).updateLeague) {
        await (dataService as any).updateLeague(league.id, { is_public: nextPublic });
      } else {
        const s = readStore();
        const idx = (s.leagues || []).findIndex((l: any) => l.id === league.id);
        if (idx >= 0) {
          (s.leagues as any[])[idx] = { ...s.leagues[idx], is_public: nextPublic };
          writeStore(s);
        }
      }

      setLeague((prev: any) => ({ ...prev, is_public: nextPublic }));
      setAllLeagues((prev) =>
        prev.map((l) => (l.id === league.id ? { ...l, is_public: nextPublic } : l))
      );
      toast(`Marked as ${nextPublic ? "Public" : "Private"}.`);
    } catch (e: any) {
      console.error(e);
      toast(e?.message ?? "Failed to change visibility.");
    } finally {
      setLoading(false);
    }
  }

  // Fixtures — FPL with local fallback
  async function importFixturesFromLocalBackup() {
    if (!league || !round?.id) return 0;
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

      const s = readStore();
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

      writeStore(s);
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
      const s = readStore();
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
        setFetchSummary(`FPL unavailable. Loaded ${added} fixtures from local backup.`);
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
    if (!round?.id) return;
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

  // Fixtures table
  const fixturesForRound = useMemo(() => {
    if (!store || !round?.id) return [];
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
      } else {
        av = a.kickoffTs;
        bv = b.kickoffTs;
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

  const effectiveTestUser =
    TEST_USERS.find((user) => user.id === effectiveTestUserId) ||
    (effectiveTestUserId
      ? {
          id: effectiveTestUserId,
          name: localStorage.getItem("player_name") || effectiveTestUserId,
        }
      : null);

  if (!selectedLeagueId || !league) {
    return (
      <div data-testid="admin-page" className="min-h-screen grid place-items-center p-6">
        <CreateGamePanel
          onCreated={(lg) => {
            handleFounderLeagueCreated(lg);
          }}
          founderDraft={founderDraft}
          setFounderDraft={setFounderDraft}
          founderCreating={founderCreating}
          founderError={founderError}
          founderNotice={founderNotice}
          onFounderCreate={handleFounderLeagueCreate}
        />
      </div>
    );
  }

  return (
    <div data-testid="admin-page" className="min-h-screen flex items-start justify-center p-4">
      <div className="w-full max-w-5xl bg-white rounded-2xl shadow-lg p-6 sm:p-8">
        {/* Top bar: game selector + create */}
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between mb-6">
          <div className="flex items-center gap-2 min-w-[220px]">
            <span className="text-sm text-slate-600">Game:</span>
            <select
              className="border rounded px-2 py-1 flex-1"
              value={selectedLeagueId}
              onChange={(e) => setSelectedLeagueId(e.target.value)}
            >
              {allLeagues.map((l: any) => (
                <option key={l.id} value={l.id}>
                  {l.name} {l.is_public ? "— Public" : "— Private"}
                </option>
              ))}
            </select>
          </div>

          <CreateFounderLeagueInline
            onCreated={(lg) => {
              handleFounderLeagueCreated(lg);
            }}
            founderDraft={founderDraft}
            setFounderDraft={setFounderDraft}
            founderCreating={founderCreating}
            founderError={founderError}
            founderNotice={founderNotice}
            onFounderCreate={handleFounderLeagueCreate}
          />
        </div>
        <div className="mb-6">
          <CreateTestLeagueInline
            onCreated={(lg) => {
              setAllLeagues((prev) => [...prev, lg]);
              setSelectedLeagueId(lg.id);
            }}
          />
        </div>

        {/* Header row: left info + right controls */}
        <div className="flex items-start justify-between gap-4 mb-6">
          {/* LEFT: info */}
          <div>
            <h2 className="text-2xl font-bold">Admin Panel</h2>
            <div className="mt-2 space-y-1 text-sm text-slate-600">
              <div>
                League: <b>{league.name}</b>{" "}
                <span
                  className={
                    "ml-2 inline-block rounded-full px-2 py-0.5 text-xs font-semibold " +
                    (league.is_public
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-slate-200 text-slate-700")
                  }
                >
                  {league.is_public ? "Public" : "Private"}
                </span>
              </div>

              {!league.is_public && (
                <div>
                  Join code:{" "}
                  <button
                    type="button"
                    className="font-mono text-emerald-700 underline decoration-dotted select-all"
                    title={league?.join_code ? "Click to copy" : "No code yet"}
                    onClick={() => {
                      if (league?.join_code) {
                        navigator.clipboard.writeText(league.join_code);
                        alert(`Copied join code: ${league.join_code}`);
                      }
                    }}
                  >
                    {league?.join_code ?? "—"}
                  </button>
                </div>
              )}

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
                    (base {league.fpl_start_event} + offset {round.round_number - 1})
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT: controls */}
          <div className="flex items-center gap-2">
            <label className="mr-2 text-sm text-slate-700 flex items-center gap-2">
              <input
                type="checkbox"
                checked={!!league.is_public}
                onChange={(e) => setVisibility(e.target.checked)}
              />
              Public
            </label>

            <button
              onClick={resetAll}
              className="text-sm rounded-lg border px-3 py-1.5 hover:bg-slate-50"
              title="Clear local data and reseed (dev only)"
            >
              Reset (Dev)
            </button>

            <button
              type="button"
              disabled={loading}
              onClick={handleDeleteLeague}
              className="text-sm rounded-lg border border-rose-300 px-3 py-1.5 text-rose-700 hover:bg-rose-50 disabled:opacity-60"
              title="Permanently delete this league"
            >
              Delete league
            </button>
            {isE2ESwitchOn() && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  data-testid="admin-e2e-seed-game-btn"
                  disabled={loading}
                  onClick={e2eSeedGame}
                  className="text-sm rounded-lg border border-emerald-300 px-3 py-1.5 text-emerald-700 hover:bg-emerald-50 disabled:opacity-60"
                  title="Dev-only: create a public game and seed fixtures for E2E tests"
                >
                  {e2eSeedStatus === "seeding" ? "Seeding..." : "E2E Seed Game"}
                </button>
                <span data-testid="admin-e2e-seed-status" className="text-xs text-slate-500">
                  {e2eSeedStatus}
                </span>
                <button
                  type="button"
                  data-testid="admin-e2e-resolve-round-btn"
                  disabled={loading}
                  onClick={e2eResolveRound}
                  className="text-sm rounded-lg border border-slate-300 px-3 py-1.5 text-slate-800 hover:bg-slate-50 disabled:opacity-60"
                  title="Dev-only: lock + resolve results + advance (deterministic for E2E)"
                >
                  {e2eResolveStatus === "resolving" ? "Resolving..." : "E2E Resolve Round"}
                </button>
                <span data-testid="admin-e2e-resolve-status" className="text-xs text-slate-500">
                  {e2eResolveStatus}
                </span>
              </div>
            )}
          </div>
        </div>

        {siteAdminChecked && siteAdminAllowed && (
          <div className="border-t pt-6 mt-8">
            <div className="mb-4">
              <h3 className="font-semibold">Managed Branding</h3>
              <p className="mt-1 text-xs text-slate-500">
                FCC site-admin only. Updates only <code>leagues.managed_theme</code>.
              </p>
            </div>

            {brandingError && (
              <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {brandingError}
              </div>
            )}

            {brandingNotice && (
              <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                {brandingNotice}
              </div>
            )}

            <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.8fr)]">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={brandingDraft.enabled}
                      disabled={brandingLoading}
                      onChange={(e) => updateBrandingField("enabled", e.target.checked)}
                    />
                    Managed branding enabled
                  </label>

                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={brandingDraft.managed}
                      disabled={brandingLoading}
                      onChange={(e) => updateBrandingField("managed", e.target.checked)}
                    />
                    Managed by FCC flag
                  </label>

                  <div className="sm:col-span-2">
                    <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Host name
                    </label>
                    <input
                      type="text"
                      value={brandingDraft.hostName}
                      disabled={brandingLoading}
                      onChange={(e) => updateBrandingField("hostName", e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                      placeholder="Chels Zone"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Display / competition name
                    </label>
                    <input
                      type="text"
                      value={brandingDraft.displayName}
                      disabled={brandingLoading}
                      onChange={(e) => updateBrandingField("displayName", e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                      placeholder="Last Man Standing"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Host logo
                    </label>
                    <div className="mt-1 rounded-xl border border-slate-300 bg-white p-3">
                      <input
                        ref={brandingLogoInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="hidden"
                        disabled={brandingLoading || brandingLogoUploading}
                        onChange={handleManagedBrandingLogoSelected}
                      />

                      {brandingDraft.hostLogoUrl ? (
                        <div className="space-y-3">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                            <div className="flex h-24 w-full max-w-[180px] items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 p-3">
                              <img
                                src={brandingDraft.hostLogoUrl}
                                alt="Host logo preview"
                                className="max-h-full max-w-full object-contain"
                              />
                            </div>
                            <div className="min-w-0 flex-1 text-sm text-slate-600">
                              <div className="truncate font-medium text-slate-800">
                                {getManagedBrandingLogoFilename(brandingDraft.hostLogoUrl) ||
                                  "Current logo preview"}
                              </div>
                              <div className="mt-1 text-xs text-slate-500">
                                PNG, JPG, or WebP up to 5 MB.
                              </div>
                            </div>
                          </div>

                          <div className="flex flex-col gap-2 sm:flex-row">
                            <button
                              type="button"
                              disabled={brandingLoading || brandingLogoUploading}
                              onClick={openBrandingLogoPicker}
                              className="min-h-[44px] rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                            >
                              {brandingLogoUploading ? "Uploading..." : "Change logo"}
                            </button>
                            <button
                              type="button"
                              disabled={brandingLoading || brandingLogoUploading}
                              onClick={handleManagedBrandingLogoRemove}
                              className="min-h-[44px] rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <button
                            type="button"
                            disabled={brandingLoading || brandingLogoUploading}
                            onClick={openBrandingLogoPicker}
                            className="min-h-[44px] w-full rounded-lg border border-dashed border-slate-300 px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 sm:w-auto"
                          >
                            {brandingLogoUploading ? "Uploading..." : "Upload logo / Choose image"}
                          </button>
                          <p className="text-xs text-slate-500">
                            Works with mobile photo libraries, Files, and desktop file pickers.
                          </p>
                        </div>
                      )}

                      {brandingLogoError && (
                        <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                          {brandingLogoError}
                        </div>
                      )}

                      <div className="mt-4">
                        <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
                          Or use image URL
                        </label>
                        <input
                          type="url"
                          value={brandingDraft.hostLogoUrl}
                          disabled={brandingLoading || brandingLogoUploading}
                          onChange={(e) => {
                            setBrandingLogoError("");
                            updateBrandingField("hostLogoUrl", e.target.value);
                          }}
                          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                          placeholder="https://example.com/logo.png"
                        />
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Primary colour
                    </label>
                    <input
                      type="text"
                      value={brandingDraft.primaryColour}
                      disabled={brandingLoading}
                      onChange={(e) => updateBrandingField("primaryColour", e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                      placeholder="#034694"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Secondary colour
                    </label>
                    <input
                      type="text"
                      value={brandingDraft.secondaryColour}
                      disabled={brandingLoading}
                      onChange={(e) => updateBrandingField("secondaryColour", e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                      placeholder="#ffffff"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Eyebrow / community label
                    </label>
                    <input
                      type="text"
                      value={brandingDraft.eyebrow}
                      disabled={brandingLoading}
                      onChange={(e) => updateBrandingField("eyebrow", e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                      placeholder="Community league"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Tagline
                    </label>
                    <textarea
                      value={brandingDraft.tagline}
                      disabled={brandingLoading}
                      onChange={(e) => updateBrandingField("tagline", e.target.value)}
                      className="mt-1 min-h-[84px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                      placeholder="One team. One win. Survive and go again."
                    />
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-3">
                  <button
                    type="button"
                    disabled={brandingLoading || brandingLogoUploading}
                    onClick={handleManagedBrandingSave}
                    className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
                  >
                    {brandingLogoUploading
                      ? "Uploading logo..."
                      : brandingLoading
                      ? "Saving..."
                      : "Save managed branding"}
                  </button>
                  <button
                    type="button"
                    disabled={brandingLoading || brandingLogoUploading}
                    onClick={handleManagedBrandingClear}
                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-white disabled:opacity-60"
                  >
                    Clear stored theme
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <h4 className="text-sm font-semibold text-slate-800">Preview</h4>
                  <p className="mt-1 text-xs text-slate-500">
                    Compact managed identity preview using the current draft.
                  </p>
                </div>

                {brandingPreviewTheme ? (
                  <ManagedLeagueStrip
                    league={
                      ({
                        id: selectedLeagueId,
                        name: selectedLeagueRecord?.name ?? league?.name ?? "League",
                        status: league?.status ?? "upcoming",
                        current_round: league?.current_round ?? 1,
                      } as League)
                    }
                    theme={brandingPreviewTheme}
                  />
                ) : (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-5 text-sm text-slate-500">
                    Enable branding and add a host name to preview the managed identity.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Automation (Dev/Ops) */}
        <div className="border-t pt-6 mt-8">
          <h3 className="font-semibold mb-2">Automation</h3>

          <div className="flex items-center gap-3">
            <button
              onClick={runTickNow}
              className="rounded-lg bg-emerald-600 text-white px-4 py-2 hover:bg-emerald-700"
            >
              Run Automation Now
            </button>

            <span className="text-xs text-slate-500">
              Manually triggers cron lifecycle: lock -&gt; evaluate -&gt; advance.
            </span>
          </div>
        </div>

        <div className="border-t pt-6 mt-8">
          <h3 className="font-semibold mb-2">Test User Switcher</h3>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-wrap gap-2">
              {TEST_USERS.map((user) => {
                const active = effectiveTestUserId === user.id;
                return (
                  <button
                    key={user.id}
                    type="button"
                    onClick={() => switchTestUser(user.id, user.name)}
                    className={[
                      "rounded-lg border px-3 py-1.5 text-sm",
                      active
                        ? "border-emerald-700 bg-emerald-600 text-white"
                        : "border-slate-300 bg-white hover:bg-slate-100",
                    ].join(" ")}
                  >
                    {user.name}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={clearTestUserOverride}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-100"
              >
                Clear Override
              </button>
            </div>
            <div className="mt-3 text-sm text-slate-600">
              Current test user:{" "}
              <b>{effectiveTestUser ? effectiveTestUser.name : "None"}</b>
              {effectiveTestUser ? (
                <span className="ml-2 font-mono text-xs text-slate-500">
                  {effectiveTestUser.id}
                </span>
              ) : null}
            </div>
          </div>
        </div>

        {/* Admin actions */}
        <div className="flex flex-wrap gap-3 mb-6">
          <button
            disabled={loading || !round?.id}
            onClick={lockNow}
            className="rounded-lg border px-4 py-2 hover:bg-slate-50"
          >
            Lock Round
          </button>
          <button
            disabled={loading || !round?.id}
            onClick={saveResults}
            className="rounded-lg border px-4 py-2 hover:bg-slate-50"
          >
            Save Results (Manual)
          </button>
          <button
            disabled={loading || !round?.id}
            onClick={advanceNow}
            className="rounded-lg border px-4 py-2 hover:bg-slate-50"
          >
            Advance Round
          </button>

          <button
            disabled={loading || !round?.id}
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
            <b>Save Results (Manual)</b>. For EPL you can also use <b>Fetch Fixtures</b>{" "}
            + <b>Auto-Evaluate</b>.
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
                    <th className="px-3 py-2 w-1/4">{headerBtn("home", "Home")}</th>
                    <th className="px-3 py-2 w-1/4">{headerBtn("away", "Away")}</th>
                    <th className="px-3 py-2 w-1/4">{headerBtn("kickoff", "Kickoff")}</th>
                    <th className="px-3 py-2 w-1/4">{headerBtn("result", "Result")}</th>
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
                      <td className={"px-3 py-2 font-medium " + resultClass(f.resultText)}>
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
              This uses the official FPL deadline for the selected Gameweek as the pick
              deadline for the new round.
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
  const [makePublic, setMakePublic] = useState<boolean>(false);

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
      const lg = await (dataService as any).createGame(name.trim(), startDeadlineISO);

      if ((dataService as any).setLeagueVisibility) {
        await (dataService as any).setLeagueVisibility(lg.id, makePublic);
      } else if ((dataService as any).updateLeague) {
        await (dataService as any).updateLeague(lg.id, { is_public: makePublic });
      } else {
        const s = JSON.parse(localStorage.getItem(STORE_KEY) || "{}") as Store;
        const idx = (s.leagues || []).findIndex((l: any) => l.id === lg.id);
        if (idx >= 0) {
          (s.leagues as any[])[idx] = { ...s.leagues[idx], is_public: makePublic };
          localStorage.setItem(STORE_KEY, JSON.stringify(s));
        }
      }

      alert(
        `Created: ${lg.name} (FPL start GW ${lg.fpl_start_event ?? startEvent}) — ${
          makePublic ? "Public" : "Private"
        }`
      );
      onCreated({ ...lg, is_public: makePublic });
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
        data-testid="admin-game-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="border rounded px-2 py-1 flex-1 min-w-[160px]"
        placeholder="Game name"
      />
      <div data-testid="admin-start-gw" className="flex-1 min-w-[220px]">
        <FplGwSelect
          selectTestId="admin-start-gw-select"
          label="Start FPL Gameweek"
          onlyUpcoming
          onChange={(id, ev) => {
            setStartEvent(id);
            if (ev) setStartDeadlineISO(ev.deadline_time);
          }}
        />
      </div>
      <label className="text-sm text-slate-700 flex items-center gap-2">
        <input
          data-testid="admin-make-public"
          type="checkbox"
          checked={makePublic}
          onChange={(e) => setMakePublic(e.target.checked)}
        />
        Public
      </label>
      <button
        data-testid="admin-create-game-btn"
        onClick={createIt}
        disabled={saving}
        className="border rounded px-3 py-1 hover:bg-slate-50 disabled:opacity-60"
      >
        {saving ? "Creating…" : "Create Game"}
      </button>
    </div>
  );
}

function CreateFounderLeagueInline({
  onCreated: _onCreated,
  founderDraft,
  setFounderDraft,
  founderCreating,
  founderError,
  founderNotice,
  onFounderCreate,
}: {
  onCreated: (lg: any) => void;
  founderDraft: FounderLeagueDraft;
  setFounderDraft: React.Dispatch<React.SetStateAction<FounderLeagueDraft>>;
  founderCreating: boolean;
  founderError: string;
  founderNotice: string;
  onFounderCreate: () => Promise<void>;
}) {
  return (
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 space-y-3">
      <div>
        <h3 className="font-semibold text-emerald-900">Create Founder League</h3>
        <p className="text-xs text-emerald-800">
          FCC site admins can create managed or founder leagues here without touching the
          normal consumer flow or host limits.
        </p>
      </div>

      {founderError ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {founderError}
        </div>
      ) : null}

      {founderNotice ? (
        <div className="rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm text-emerald-700">
          {founderNotice}
        </div>
      ) : null}

      <div className="flex flex-col gap-3">
        <input
          data-testid="admin-founder-league-name"
          value={founderDraft.name}
          onChange={(e) =>
            setFounderDraft((current) => ({ ...current, name: e.target.value }))
          }
          className="border rounded px-2 py-1 min-w-[160px] bg-white"
          placeholder="Founder league name"
        />

        <div data-testid="admin-founder-start-gw" className="min-w-[220px]">
          <FplGwSelect
            selectTestId="admin-founder-start-gw-select"
            label="Start FPL Gameweek"
            onlyUpcoming
            onChange={(id, ev) => {
              setFounderDraft((current) => ({
                ...current,
                startEventId: id,
                startDeadlineISO: ev?.deadline_time ?? null,
              }));
            }}
          />
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <label className="text-sm text-slate-700 flex items-center gap-2">
            <input
              data-testid="admin-founder-make-public"
              type="checkbox"
              checked={founderDraft.isPublic}
              onChange={(e) =>
                setFounderDraft((current) => ({ ...current, isPublic: e.target.checked }))
              }
            />
            Public
          </label>

          <input
            data-testid="admin-founder-join-code"
            value={founderDraft.isPublic ? "" : founderDraft.joinCode}
            onChange={(e) =>
              setFounderDraft((current) => ({
                ...current,
                joinCode: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12),
              }))
            }
            className="border rounded px-2 py-1 min-w-[180px] bg-white disabled:bg-slate-100"
            placeholder="Optional join code"
            disabled={founderDraft.isPublic}
          />
        </div>

        <button
          data-testid="admin-create-founder-league-btn"
          type="button"
          onClick={() => {
            void onFounderCreate();
          }}
          disabled={founderCreating}
          className="rounded-lg bg-emerald-700 text-white px-4 py-2 hover:bg-emerald-800 disabled:opacity-60 self-start"
        >
          {founderCreating ? "Creating..." : "Create Founder League"}
        </button>
      </div>
    </div>
  );
}

function CreateTestLeagueInline({ onCreated }: { onCreated: (lg: any) => void }) {
  const [name, setName] = useState("Pre-Season Test League");
  const [startEvent, setStartEvent] = useState<number | null>(null);
  const [startDeadlineISO, setStartDeadlineISO] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function createIt() {
    if (!name.trim()) {
      alert("Please enter a league name.");
      return;
    }
    if (!startDeadlineISO || !startEvent) {
      alert("Pick an FPL Gameweek first.");
      return;
    }

    try {
      setSaving(true);
      const joinCode = generateInviteCode();
      const lg = await (dataService as any).createGame(name.trim(), startDeadlineISO, {
        fplStartEvent: startEvent,
        joinCode,
        isTest: true,
      });
      alert(
        `Created test league: ${lg.name} (historical FPL GW ${startEvent}) - invite code ${joinCode}`
      );
      onCreated({ ...lg, is_public: false, is_test: true, join_code: joinCode });
    } catch (err: any) {
      console.error(err);
      alert(err?.message ?? "Failed to create test league.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 space-y-3">
      <div>
        <h3 className="font-semibold text-amber-900">Pre-Season Test Mode</h3>
        <p className="text-xs text-amber-800">
          Admin-only historical FPL league creation for off-season testing.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row items-start gap-2 w-full">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="border rounded px-2 py-1 flex-1 min-w-[160px] bg-white"
          placeholder="Test league name"
        />
        <div className="flex-1 min-w-[220px]">
          <FplGwSelect
            label="Historical FPL Gameweek"
            onChange={(id, ev) => {
              setStartEvent(id);
              if (ev) setStartDeadlineISO(ev.deadline_time);
            }}
          />
        </div>
        <button
          type="button"
          onClick={createIt}
          disabled={saving}
          className="rounded-lg bg-amber-600 text-white px-3 py-1 hover:bg-amber-700 disabled:opacity-60"
        >
          {saving ? "Creating..." : "Create Test League"}
        </button>
      </div>
    </div>
  );
}

function CreateGamePanel({
  onCreated,
  founderDraft,
  setFounderDraft,
  founderCreating,
  founderError,
  founderNotice,
  onFounderCreate,
}: {
  onCreated: (lg: any) => void;
  founderDraft: FounderLeagueDraft;
  setFounderDraft: React.Dispatch<React.SetStateAction<FounderLeagueDraft>>;
  founderCreating: boolean;
  founderError: string;
  founderNotice: string;
  onFounderCreate: () => Promise<void>;
}) {
  return (
    <div className="w-full max-w-xl bg-white rounded-2xl shadow p-6 space-y-4">
      <h2 className="text-xl font-semibold">Create your first founder or managed league</h2>
      <p className="text-slate-600 text-sm">
        Pick a <b>starting FPL Gameweek</b>. We’ll use the official FPL deadline for Round 1 and map
        future rounds to the FPL calendar.
      </p>
      <CreateFounderLeagueInline
        onCreated={onCreated}
        founderDraft={founderDraft}
        setFounderDraft={setFounderDraft}
        founderCreating={founderCreating}
        founderError={founderError}
        founderNotice={founderNotice}
        onFounderCreate={onFounderCreate}
      />
      <CreateTestLeagueInline onCreated={onCreated} />
    </div>
  );
}
