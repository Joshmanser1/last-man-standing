import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { OutcomeModal } from "./OutcomeModal";
import { DeadlineBanner } from "./DeadlineBanner";
import { deadlineShownKey, formatCountdown, getDeadlineLevel } from "../lib/deadline";
import { appendNotification } from "../lib/notifyFeed";
import { getEffectiveUserId } from "../lib/auth";
import { supa } from "../lib/supabaseClient";
import {
  clearOutcomeDebug,
  disableOutcomeDebug,
  syncOutcomeDebugEnabled,
  updateOutcomeDebug,
  useOutcomeDebug,
} from "../lib/outcomeDebug";

export type OutcomePayload = {
  type: "progressed" | "eliminated" | "winner";
  title: string;
  body: string;
  emoji?: string;
  key: string;
  stats?: Array<{ label: string; value: string }>;
  ctas?: Array<{ label: string; to?: string; action?: "share" | "close" }>;
};

type Ctx = {
  showOutcome: (p: OutcomePayload) => void;
  showDeadlineReminder: (args: {
    leagueId: string;
    roundId: string;
    deadlineISO: string;
  }) => Promise<void>;
};

const NotificationsCtx = createContext<Ctx | null>(null);
const OUTCOME_DISMISSED_PREFIX = "league_outcome_dismissed:";

function outcomeDismissedKey(outcomeKey: string) {
  return `${OUTCOME_DISMISSED_PREFIX}${outcomeKey}`;
}

export function isOutcomeDismissed(outcomeKey: string) {
  return localStorage.getItem(outcomeDismissedKey(outcomeKey)) === "1";
}

function OutcomeDebugPanel() {
  const debug = useOutcomeDebug();

  if (!debug.enabled) return null;

  return (
    <div className="fixed inset-x-3 bottom-3 z-[120] rounded-xl border border-emerald-500/30 bg-slate-950/95 p-3 text-[11px] text-slate-100 shadow-[0_12px_40px_rgba(0,0,0,0.45)] backdrop-blur md:left-auto md:right-3 md:w-[360px]">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="font-semibold text-emerald-300">Outcome debug</div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded-md bg-white/5 px-2 py-1 text-[10px] text-slate-300 ring-1 ring-white/10 hover:bg-white/10"
            onClick={clearOutcomeDebug}
          >
            Clear debug
          </button>
          <button
            type="button"
            className="rounded-md bg-rose-500/15 px-2 py-1 text-[10px] text-rose-200 ring-1 ring-rose-400/20 hover:bg-rose-500/25"
            onClick={() => {
              if (typeof window !== "undefined") {
                const search = new URLSearchParams(window.location.search);
                search.delete("debugOutcome");
                const qs = search.toString();
                const url = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`;
                window.history.replaceState({}, "", url);
              }
              disableOutcomeDebug();
            }}
          >
            Disable debug
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        <div>Bell sync mounted</div>
        <div>{debug.bellSyncMounted ? "yes" : "no"}</div>
        <div>Auth user resolved</div>
        <div>{debug.playerIdResolved ? "yes" : "no"}</div>
        <div>Visible leagues</div>
        <div>{debug.visibleLeagueCount ?? "—"}</div>
        <div>Current league</div>
        <div className="truncate">{debug.currentLeagueId || "—"}</div>
        <div>Sync returned outcome</div>
        <div>{debug.syncReturnedOutcome ? "yes" : "no"}</div>
        <div>Outcome type</div>
        <div>{debug.returnedOutcomeType || "—"}</div>
        <div>Outcome key</div>
        <div className="truncate">{debug.returnedOutcomeKey || "—"}</div>
        <div>Payload built</div>
        <div>{debug.modalPayloadBuilt ? "yes" : "no"}</div>
        <div>showOutcome called</div>
        <div>{debug.showOutcomeCalled ? "yes" : "no"}</div>
        <div>Provider received</div>
        <div>{debug.providerReceivedPayload ? "yes" : "no"}</div>
        <div>Suppression</div>
        <div className="truncate">{debug.providerSuppressionResult || "—"}</div>
        <div>Previous payload</div>
        <div className="truncate">{debug.previousPayloadKey || "—"}</div>
        <div>Provider payload set</div>
        <div>{debug.providerPayloadSet ? "yes" : "no"}</div>
        <div>Modal mounted</div>
        <div>{debug.modalMounted ? "yes" : "no"}</div>
        <div>Modal open</div>
        <div>{debug.modalOpen ? "yes" : "no"}</div>
      </div>
      {debug.errors.length > 0 && (
        <div className="mt-2 space-y-1 border-t border-white/10 pt-2">
          <div className="font-semibold text-rose-300">Errors</div>
          {debug.errors.map((entry) => (
            <div key={entry} className="break-words text-rose-100">
              {entry}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const [playerId, setPlayerId] = useState("");
  const [payload, setPayload] = useState<OutcomePayload | null>(null);
  const [deadlineState, setDeadlineState] = useState<{
    leagueId: string;
    roundId: string;
    deadlineISO: string;
    level: "t24h" | "t3h" | "t1h";
    countdown: string;
  } | null>(null);
  const payloadKeyRef = useRef("");

  useEffect(() => {
    syncOutcomeDebugEnabled();
  }, []);

  useEffect(() => {
    payloadKeyRef.current = payload?.key ?? "";
  }, [payload?.key]);

  useEffect(() => {
    let mounted = true;

    const refreshUserId = async () => {
      const nextUserId = (await getEffectiveUserId()) || "";
      if (mounted) setPlayerId(nextUserId);
    };

    void refreshUserId();
    const { data: sub } = supa.auth.onAuthStateChange(() => {
      void refreshUserId();
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const showOutcome = useCallback((p: OutcomePayload) => {
    const dismissedKey = outcomeDismissedKey(p.key);
    const suppressed = isOutcomeDismissed(p.key);
    updateOutcomeDebug({
      providerReceivedPayload: true,
      providerSuppressionResult: suppressed ? `dismissed:${dismissedKey}` : `allowed:${dismissedKey}`,
      previousPayloadKey: payloadKeyRef.current,
    });
    if (suppressed) return;
    if (playerId) {
      appendNotification(playerId, {
        key: p.key,
        type: "outcome",
        title: p.title,
        body: p.body,
        cta: p.ctas?.[0],
      });
    }
    setPayload(p);
    updateOutcomeDebug({ providerPayloadSet: true });
  }, [playerId]);

  const close = useCallback(() => {
    setPayload((current) => {
      if (current?.key) {
        localStorage.setItem(current.key, "1");
        localStorage.setItem(outcomeDismissedKey(current.key), "1");
      }
      return null;
    });
  }, []);

  const showDeadlineReminder = useCallback(async (args: {
    leagueId: string;
    roundId: string;
    deadlineISO: string;
  }) => {
    const { leagueId, roundId, deadlineISO } = args;
    const currentPlayerId = (await getEffectiveUserId()) || "";
    if (!currentPlayerId) return;
    const level = getDeadlineLevel(deadlineISO, Date.now());
    if (!level) return;

    const k = deadlineShownKey(leagueId, roundId, currentPlayerId, level);
    if (localStorage.getItem(k)) return;
    localStorage.setItem(k, "1");
    appendNotification(currentPlayerId, {
      type: "deadline",
      title: "Deadline approaching",
      body: "Pick deadline is coming up soon.",
      cta: { label: "Make Pick", to: "/make-pick" },
    });

    setDeadlineState({
      leagueId,
      roundId,
      deadlineISO,
      level,
      countdown: formatCountdown(deadlineISO, Date.now()),
    });
  }, []);

  function dismissDeadline() {
    setDeadlineState(null);
  }

  const ctxValue = useMemo(
    () => ({ showOutcome, showDeadlineReminder }),
    [showOutcome, showDeadlineReminder]
  );

  return (
    <NotificationsCtx.Provider value={ctxValue}>
      {children}
      {deadlineState && (
        <DeadlineBanner
          leagueId={deadlineState.leagueId}
          roundId={deadlineState.roundId}
          deadlineISO={deadlineState.deadlineISO}
          level={deadlineState.level}
          countdown={deadlineState.countdown}
          onDismiss={dismissDeadline}
        />
      )}
      {payload && <OutcomeModal payload={payload} onClose={close} />}
      <OutcomeDebugPanel />
    </NotificationsCtx.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationsCtx);
  if (!ctx) throw new Error("useNotifications must be used inside provider");
  return ctx;
}
