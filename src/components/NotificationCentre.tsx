import { useEffect, useState } from "react";
import { clearNotifications, getNotifications, markAllRead } from "../lib/notifyFeed";

export function NotificationCentre() {
  const playerId = localStorage.getItem("player_id") || "";
  const [items, setItems] = useState<any[]>([]);

  function load() {
    if (!playerId) return;
    setItems(getNotifications(playerId));
  }

  useEffect(() => {
    load();
  }, []);

  if (!items.length) return null;

  return (
    <div
      data-testid="notification-centre"
      className="rounded-2xl border border-white/10 bg-gradient-to-b from-slate-900/70 to-slate-950/70 backdrop-blur-xl ring-1 ring-white/10 p-4"
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-white">Notifications</h3>
        <div className="flex gap-2">
          <button
            onClick={() => {
              markAllRead(playerId);
              load();
            }}
            className="text-xs text-emerald-400 hover:text-emerald-300"
          >
            Mark all read
          </button>
          <button
            onClick={() => {
              clearNotifications(playerId);
              load();
            }}
            className="text-xs text-slate-400 hover:text-slate-200"
          >
            Clear
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {items.map((n) => (
          <div
            key={n.id}
            className={[
              "rounded-xl px-3 py-2 ring-1",
              n.read
                ? "bg-white/5 ring-white/10 text-slate-400"
                : "bg-white/10 ring-emerald-400/20 text-white",
            ].join(" ")}
          >
            <div className="text-xs font-semibold">{n.title}</div>
            {n.body && <div className="text-[11px] mt-0.5">{n.body}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
