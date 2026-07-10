import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createPortal } from "react-dom";
import {
  clearNotifications,
  getLastViewedAt,
  getNotifications,
  getUnreadCount,
  markAllRead,
  setLastViewedAt,
} from "../lib/notifyFeed";
import { syncLeagueNotifications } from "../lib/generateNotifications";

function timeAgo(ts: number) {
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function NotificationList({
  items,
  lastViewedAt,
  playerId,
  navigate,
  close,
}: {
  items: any[];
  lastViewedAt: number;
  playerId: string;
  navigate: ReturnType<typeof useNavigate>;
  close: () => void;
}) {
  if (!items.length) {
    return <div className="p-4 text-xs text-slate-400">No notifications yet.</div>;
  }

  return (
    <div className="space-y-2 p-2 md:p-3">
      {items.slice(0, 12).map((n: any) => {
        const seen = n.read || n.ts <= lastViewedAt;

        return (
          <div
            key={n.id}
            className={[
              "rounded-xl px-3 py-2 ring-1 transition",
              seen ? "bg-white/5 ring-white/10" : "bg-white/10 ring-emerald-400/20",
            ].join(" ")}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className={seen ? "text-xs text-slate-300" : "text-xs font-semibold text-white"}>
                  {n.title}
                </div>
                {n.body && <div className="mt-0.5 text-[11px] text-slate-400">{n.body}</div>}
                {n.cta?.to && (
                  <button
                    type="button"
                    className="mt-2 text-[11px] font-semibold text-emerald-400 hover:text-emerald-300"
                    onClick={() => {
                      setLastViewedAt(playerId);
                      navigate(n.cta.to);
                      close();
                    }}
                  >
                    {n.cta.label ?? "Open"}
                  </button>
                )}
              </div>
              <div className="whitespace-nowrap text-[10px] text-slate-500">{timeAgo(n.ts)}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function NotificationBell() {
  const navigate = useNavigate();
  const playerId = localStorage.getItem("player_id") || "";
  const activeLeagueId = localStorage.getItem("active_league_id") || "";
  const [open, setOpen] = useState(false);
  const [tick, setTick] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  const items = useMemo(() => (playerId ? getNotifications(playerId) : []), [playerId, tick]);
  const lastViewedAt = useMemo(() => (playerId ? getLastViewedAt(playerId) : 0), [playerId, tick]);
  const unread = useMemo(() => (playerId ? getUnreadCount(playerId) : 0), [playerId, tick]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    const t = window.setInterval(() => setTick((x) => x + 1), 1200);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    if (!playerId || !activeLeagueId) return;
    let disposed = false;

    const run = async () => {
      await syncLeagueNotifications(playerId, activeLeagueId);
      if (!disposed) setTick((x) => x + 1);
    };

    void run();
    const t = window.setInterval(run, 30000);
    return () => {
      disposed = true;
      window.clearInterval(t);
    };
  }, [playerId, activeLeagueId]);

  useEffect(() => {
    if (!open) return;
    if (window.innerWidth >= 768) return;

    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!playerId) return null;

  return (
    <div ref={wrapRef} className="relative" data-testid="notification-bell">
      <button
        type="button"
        onClick={() =>
          setOpen((x) => {
            const next = !x;
            if (next) {
              setLastViewedAt(playerId);
              setTick((v) => v + 1);
            }
            return next;
          })
        }
        className="relative grid h-9 w-9 place-items-center rounded-xl bg-white/5 ring-1 ring-white/10 transition hover:bg-white/10"
        aria-label="Notifications"
      >
        <span className="text-lg">{"\uD83D\uDD14"}</span>

        {unread > 0 && (
          <span
            data-testid="notification-bell-badge"
            className="absolute -right-1 -top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-emerald-500 px-1 text-[11px] font-bold text-black ring-2 ring-slate-950"
          >
            {unread > 9 ? "9+" : unread}
          </span>
      )}
      </button>

      {open && (
        <>
          <div
            data-testid="notification-dropdown"
            className="absolute right-0 z-[70] mt-2 hidden w-[340px] max-w-[80vw] overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-slate-900/85 to-slate-950/85 shadow-[0_18px_60px_rgba(0,0,0,0.65)] ring-1 ring-white/10 backdrop-blur-xl md:block"
          >
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <div className="text-sm font-semibold text-white">Notifications</div>
              <div className="flex gap-2">
                <button
                  className="text-xs text-emerald-400 hover:text-emerald-300"
                  onClick={() => {
                    markAllRead(playerId);
                    setTick((x) => x + 1);
                  }}
                >
                  Mark read
                </button>
                <button
                  className="text-xs text-slate-400 hover:text-slate-200"
                  onClick={() => {
                    clearNotifications(playerId);
                    setTick((x) => x + 1);
                  }}
                >
                  Clear
                </button>
              </div>
            </div>

            <div className="max-h-[360px] overflow-auto">
              <NotificationList
                items={items}
                lastViewedAt={lastViewedAt}
                playerId={playerId}
                navigate={navigate}
                close={() => setOpen(false)}
              />
            </div>
          </div>

          {typeof document !== "undefined"
            ? createPortal(
                <div className="fixed inset-0 z-[100] md:hidden">
                  <button
                    type="button"
                    aria-label="Close notifications"
                    className="absolute inset-0 bg-black/50"
                    onClick={() => setOpen(false)}
                  />
                  <div
                    className="absolute inset-x-0 bottom-0 overflow-hidden rounded-t-3xl border border-white/10 bg-gradient-to-b from-slate-900 to-slate-950 shadow-[0_-18px_60px_rgba(0,0,0,0.65)] ring-1 ring-white/10"
                    style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
                  >
                    <div className="mx-auto mt-2 h-1.5 w-12 rounded-full bg-white/20" />
                    <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                      <div className="text-sm font-semibold text-white">Notifications</div>
                      <div className="flex items-center gap-3">
                        <button
                          className="text-xs text-emerald-400 hover:text-emerald-300"
                          onClick={() => {
                            markAllRead(playerId);
                            setTick((x) => x + 1);
                          }}
                        >
                          Mark read
                        </button>
                        <button
                          className="text-xs text-slate-400 hover:text-slate-200"
                          onClick={() => {
                            clearNotifications(playerId);
                            setTick((x) => x + 1);
                          }}
                        >
                          Clear
                        </button>
                        <button
                          type="button"
                          className="text-xs text-slate-300 hover:text-white"
                          onClick={() => setOpen(false)}
                        >
                          Close
                        </button>
                      </div>
                    </div>

                    <div className="max-h-[75dvh] overflow-auto">
                      <NotificationList
                        items={items}
                        lastViewedAt={lastViewedAt}
                        playerId={playerId}
                        navigate={navigate}
                        close={() => setOpen(false)}
                      />
                    </div>
                  </div>
                </div>,
                document.body
              )
            : null}
        </>
      )}
    </div>
  );
}
