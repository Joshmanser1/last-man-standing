import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useNotifications } from "./Notifications";
import {
  getMarketingDemoScenario,
  isMarketingDemoActive,
  isMarketingDemoRecordingMode,
  prepareMarketingDemoJoinFlow,
  resetMarketingDemo,
  setMarketingDemoScenario,
  toggleMarketingDemoRecordingMode,
  type MarketingDemoScenario,
} from "../demo/runtime";

const POPUP_COPY: Record<
  Exclude<MarketingDemoScenario, "active" | "pick_submitted" | "join_flow">,
  {
    type: "progressed" | "eliminated" | "winner";
    title: string;
    body: string;
    stats: Array<{ label: string; value: string }>;
  }
> = {
  survived: {
    type: "progressed",
    title: "Round survived",
    body: "Arsenal got the win and you're through to Round 4 in Founding Host Demo.",
    stats: [
      { label: "League", value: "Founding Host Demo" },
      { label: "Winning pick", value: "Arsenal" },
    ],
  },
  eliminated: {
    type: "eliminated",
    title: "You were eliminated",
    body: "Arsenal drew in Round 3, so your run in Founding Host Demo is over.",
    stats: [
      { label: "League", value: "Founding Host Demo" },
      { label: "Eliminated in", value: "Round 3" },
    ],
  },
  winner: {
    type: "winner",
    title: "You're the last player standing",
    body: "Founding Host Demo is complete and you've won the £100 winner's prize.",
    stats: [
      { label: "League", value: "Founding Host Demo" },
      { label: "Prize", value: "£100" },
    ],
  },
};

export function MarketingDemoControls() {
  const navigate = useNavigate();
  const location = useLocation();
  const { showOutcome } = useNotifications();
  const active = isMarketingDemoActive();
  const scenario = getMarketingDemoScenario();
  const recordingMode = isMarketingDemoRecordingMode();

  useEffect(() => {
    if (!active) return;
    if (scenario === "active" || scenario === "pick_submitted" || scenario === "join_flow") return;
    const seenKey = `fcc_demo_popup_seen_v1:${scenario}`;
    if (window.localStorage.getItem(seenKey) === "1") return;
    const copy = POPUP_COPY[scenario];
    showOutcome({
      ...copy,
      key: `marketing-demo:${scenario}`,
      emoji: scenario === "winner" ? "🏆" : scenario === "survived" ? "✅" : "❌",
      ctas: [{ label: "Continue", action: "close" }],
    });
    window.localStorage.setItem(seenKey, "1");
  }, [active, scenario, showOutcome]);

  useEffect(() => {
    if (!active) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "v") {
        event.preventDefault();
        toggleMarketingDemoRecordingMode();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active]);

  if (!active) return null;

  return (
    <>
      {!recordingMode && (
        <div className="border-b border-amber-300/40 bg-amber-50/95 backdrop-blur">
          <div className="container-page flex flex-col gap-3 py-3 text-sm text-slate-700 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="font-semibold text-slate-900">Marketing Demo mode</div>
              <div className="text-xs text-slate-600">
                Demo user: Alex Morgan. Local-only state. No production auth or data writes.
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-xs font-medium text-slate-600" htmlFor="demo-scenario">
                Demo Scenario
              </label>
              <select
                id="demo-scenario"
                className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs"
                value={scenario === "join_flow" ? "active" : scenario}
                onChange={(event) => {
                  const next = event.target.value as MarketingDemoScenario;
                  window.localStorage.removeItem(`fcc_demo_popup_seen_v1:${next}`);
                  setMarketingDemoScenario(next);
                }}
              >
                <option value="active">Active round</option>
                <option value="pick_submitted">Pick submitted</option>
                <option value="survived">Survived</option>
                <option value="eliminated">Eliminated</option>
                <option value="winner">Winner</option>
              </select>
              <button
                type="button"
                className="btn btn-ghost text-xs"
                onClick={() => navigate(prepareMarketingDemoJoinFlow(), { replace: true })}
              >
                Join flow
              </button>
              <button
                type="button"
                className="btn btn-ghost text-xs"
                onClick={() => navigate("/private/create")}
              >
                Create league
              </button>
              <button
                type="button"
                className="btn btn-ghost text-xs"
                onClick={toggleMarketingDemoRecordingMode}
              >
                Recording Mode
              </button>
              <button
                type="button"
                className="btn btn-ghost text-xs"
                onClick={() => {
                  resetMarketingDemo();
                  navigate("/demo", { replace: true });
                }}
              >
                Reset Demo
              </button>
            </div>
          </div>
        </div>
      )}
      <button
        type="button"
        aria-label="Toggle recording mode"
        title="Toggle recording mode"
        onClick={toggleMarketingDemoRecordingMode}
        className={[
          "fixed bottom-3 right-3 z-[80] h-3 w-3 rounded-full transition-opacity",
          recordingMode
            ? "bg-slate-900/8 opacity-10 hover:opacity-35"
            : "bg-slate-900/12 opacity-0 hover:opacity-20 focus:opacity-20",
        ].join(" ")}
      />
    </>
  );
}
