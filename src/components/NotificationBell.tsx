import { useEffect, useMemo, useRef, useState } from "react";
import {
  clearNotifications,
  getNotifications,
  getUnreadCount,
  markAllRead,
} from "../lib/notifyFeed";

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

export function NotificationBell() {
  const playerId = localStorage.getItem("player_id") || "";
  const [open, setOpen] = useState(false);
  const [tick, setTick] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  const items = useMemo(() => (playerId ? getNotifications(playerId) : []), [playerId, tick]);
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

  if (!playerId) return null;

  return (
    <div ref={wrapRef} className="relative" data-testid="notification-bell">
      <button
        type="button"
        onClick={() => setOpen((x) => !x)}
        className="relative grid place-items-center h-9 w-9 rounded-xl bg-white/5 hover:bg-white/10 ring-1 ring-white/10 transition"
        aria-label="Notifications"
      >
        <span className="text-lg">🔔</span>

        {unread > 0 && (
          <span
            data-testid="notification-bell-badge"
            className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-emerald-500 text-[11px] font-bold text-black grid place-items-center ring-2 ring-slate-950"
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          data-testid="notification-dropdown"
          className="absolute right-0 mt-2 w-[340px] max-w-[80vw] rounded-2xl border border-white/10 bg-gradient-to-b from-slate-900/85 to-slate-950/85 backdrop-blur-xl ring-1 ring-white/10 shadow-[0_18px_60px_rgba(0,0,0,0.65)] overflow-hidden z-[70]"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
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
            {items.length ? (
              <div className="p-2 space-y-2">
                {items.slice(0, 12).map((n: any) => (
                  <div
                    key={n.id}
                    className={[
                      "rounded-xl px-3 py-2 ring-1 transition",
                      n.read ? "bg-white/5 ring-white/10" : "bg-white/10 ring-emerald-400/20",
                    ].join(" ")}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div
                          className={
                            n.read ? "text-xs text-slate-300" : "text-xs text-white font-semibold"
                          }
                        >
                          {n.title}
                        </div>
                        {n.body && <div className="text-[11px] text-slate-400 mt-0.5">{n.body}</div>}
                      </div>
                      <div className="text-[10px] text-slate-500 whitespace-nowrap">
                        {timeAgo(n.ts)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-4 text-xs text-slate-400">No notifications yet.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
