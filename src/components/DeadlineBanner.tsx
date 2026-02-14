import { useEffect, useState } from "react";

type Props = {
  leagueId: string;
  roundId: string;
  deadlineISO: string;
  level: "t24h" | "t3h" | "t1h";
  countdown: string;
  onDismiss: () => void;
};

export function DeadlineBanner({
  leagueId,
  roundId,
  deadlineISO,
  level,
  countdown,
  onDismiss,
}: Props) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setOpen(true), 10);
    return () => clearTimeout(t);
  }, []);

  const label =
    level === "t1h"
      ? "Less than 1 hour left"
      : level === "t3h"
      ? "Less than 3 hours left"
      : "Less than 24 hours left";

  const tone =
    level === "t1h"
      ? "ring-rose-400/30"
      : level === "t3h"
      ? "ring-amber-400/30"
      : "ring-emerald-400/30";

  return (
    <div className="fixed top-3 left-0 right-0 z-[55] flex justify-center px-3">
      <div
        data-testid="deadline-banner"
        data-league-id={leagueId}
        data-round-id={roundId}
        className={[
          "w-full max-w-3xl rounded-2xl border border-white/10",
          "bg-gradient-to-r from-slate-900/80 to-slate-950/80 backdrop-blur-xl",
          "ring-1",
          tone,
          "shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_16px_50px_rgba(0,0,0,0.55)]",
          "transition-all duration-200",
          open ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-2",
        ].join(" ")}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between px-4 py-3">
          <div className="text-sm text-slate-200">
            <div className="font-semibold">⏰ {label} to make your pick</div>
            <div className="text-slate-400 text-xs mt-0.5">
              Time remaining: <b className="text-slate-200">{countdown}</b> • Deadline:{" "}
              {new Date(deadlineISO).toLocaleString()}
            </div>
          </div>

          <div className="flex gap-2">
            <button
              data-testid="deadline-banner-cta"
              onClick={() => window.location.assign("/make-pick")}
              className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
            >
              Make Pick
            </button>
            <button
              data-testid="deadline-banner-dismiss"
              onClick={onDismiss}
              className="rounded-xl bg-white/5 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-white/10 ring-1 ring-white/10"
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
