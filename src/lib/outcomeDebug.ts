import { useSyncExternalStore } from "react";

export type OutcomeDebugSnapshot = {
  enabled: boolean;
  bellSyncMounted: boolean;
  playerIdResolved: boolean;
  visibleLeagueCount: number | null;
  currentLeagueId: string;
  syncReturnedOutcome: boolean;
  returnedOutcomeType: string;
  returnedOutcomeKey: string;
  modalPayloadBuilt: boolean;
  showOutcomeCalled: boolean;
  providerReceivedPayload: boolean;
  providerSuppressionResult: string;
  providerPayloadSet: boolean;
  previousPayloadKey: string;
  modalMounted: boolean;
  modalOpen: boolean;
  errors: string[];
};

const DEBUG_KEY = "lms_debug_outcome";

const initialState: OutcomeDebugSnapshot = {
  enabled: false,
  bellSyncMounted: false,
  playerIdResolved: false,
  visibleLeagueCount: null,
  currentLeagueId: "",
  syncReturnedOutcome: false,
  returnedOutcomeType: "",
  returnedOutcomeKey: "",
  modalPayloadBuilt: false,
  showOutcomeCalled: false,
  providerReceivedPayload: false,
  providerSuppressionResult: "",
  providerPayloadSet: false,
  previousPayloadKey: "",
  modalMounted: false,
  modalOpen: false,
  errors: [],
};

let state: OutcomeDebugSnapshot = initialState;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

export function isOutcomeDebugEnabled() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(DEBUG_KEY) === "1";
  } catch {
    return false;
  }
}

export function syncOutcomeDebugEnabled() {
  const enabled = isOutcomeDebugEnabled();
  if (state.enabled === enabled) return;
  state = { ...state, enabled };
  emit();
}

export function enableOutcomeDebug() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DEBUG_KEY, "1");
    state = { ...state, enabled: true };
    emit();
  } catch {
    // ignore storage failures in diagnostic mode
  }
}

export function disableOutcomeDebug() {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(DEBUG_KEY);
    } catch {
      // ignore storage failures in diagnostic mode
    }
  }
  state = { ...initialState, enabled: false };
  emit();
}

export function updateOutcomeDebug(partial: Partial<OutcomeDebugSnapshot>) {
  if (!isOutcomeDebugEnabled()) return;
  state = { ...state, ...partial };
  emit();
}

export function pushOutcomeDebugError(scope: string, message: string) {
  if (!isOutcomeDebugEnabled()) return;
  state = {
    ...state,
    errors: [`${scope}: ${message}`, ...state.errors].slice(0, 8),
  };
  emit();
}

export function clearOutcomeDebug() {
  state = { ...initialState, enabled: state.enabled };
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return state;
}

export function useOutcomeDebug() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
