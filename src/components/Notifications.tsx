import { createContext, useContext, useState } from "react";
import { OutcomeModal } from "./OutcomeModal";
import { DeadlineBanner } from "./DeadlineBanner";
import { deadlineShownKey, formatCountdown, getDeadlineLevel } from "../lib/deadline";
import { appendNotification } from "../lib/notifyFeed";

type OutcomePayload = {
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
    playerId: string;
  }) => void;
};

const NotificationsCtx = createContext<Ctx | null>(null);

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const [payload, setPayload] = useState<OutcomePayload | null>(null);
  const [deadlineState, setDeadlineState] = useState<{
    leagueId: string;
    roundId: string;
    deadlineISO: string;
    level: "t24h" | "t3h" | "t1h";
    countdown: string;
  } | null>(null);

  function showOutcome(p: OutcomePayload) {
    const shown = localStorage.getItem(p.key);
    if (shown) return;
    localStorage.setItem(p.key, "1");
    const playerId = localStorage.getItem("player_id");
    if (playerId) {
      appendNotification(playerId, {
        type: "outcome",
        title: p.title,
        body: p.body,
        cta: p.ctas?.[0],
      });
    }
    setPayload(p);
  }

  function close() {
    setPayload(null);
  }

  function showDeadlineReminder(args: {
    leagueId: string;
    roundId: string;
    deadlineISO: string;
    playerId: string;
  }) {
    const { leagueId, roundId, deadlineISO, playerId } = args;
    const level = getDeadlineLevel(deadlineISO, Date.now());
    if (!level) return;

    const k = deadlineShownKey(leagueId, roundId, playerId, level);
    if (localStorage.getItem(k)) return;
    localStorage.setItem(k, "1");
    appendNotification(playerId, {
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
  }

  function dismissDeadline() {
    setDeadlineState(null);
  }

  return (
    <NotificationsCtx.Provider value={{ showOutcome, showDeadlineReminder }}>
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
    </NotificationsCtx.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationsCtx);
  if (!ctx) throw new Error("useNotifications must be used inside provider");
  return ctx;
}
