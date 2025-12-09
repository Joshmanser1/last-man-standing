// src/components/DevUserSwitcher.tsx
import { useEffect, useState, useCallback } from "react";

const KEY = "lms_dev_users_v1";

function setDevIdentity(id: string, name?: string) {
  const display = name || (id === "demo-a" ? "Demo A" : id === "demo-b" ? "Demo B" : id);
  localStorage.setItem("player_id", id);
  localStorage.setItem("player_name", display);
  // keep admin off by default unless explicitly set elsewhere
  if (!localStorage.getItem("is_admin")) localStorage.setItem("is_admin", "0");

  // clear current league on switch (so each user can have their own)
  localStorage.removeItem("active_league_id");

  // notify app that local store changed
  window.dispatchEvent(new Event("lms:store-updated"));
}

export function DevUserSwitcher() {
  const [users, setUsers] = useState<string[]>([]);
  const [current, setCurrent] = useState<string | null>(
    typeof window !== "undefined" ? localStorage.getItem("player_id") : null
  );

  useEffect(() => {
    const raw = localStorage.getItem(KEY);
    setUsers(raw ? JSON.parse(raw) : ["demo-a", "demo-b"]);

    const onStore = () => setCurrent(localStorage.getItem("player_id"));
    window.addEventListener("lms:store-updated", onStore);
    window.addEventListener("storage", onStore);
    return () => {
      window.removeEventListener("lms:store-updated", onStore);
      window.removeEventListener("storage", onStore);
    };
  }, []);

  const switchTo = useCallback((id: string) => {
    setDevIdentity(id);
    setCurrent(id);
  }, []);

  const addUser = useCallback(() => {
    const id = prompt("New test user id (e.g., demo-c):")?.trim();
    if (!id) return;
    const next = Array.from(new Set([...users, id]));
    setUsers(next);
    localStorage.setItem(KEY, JSON.stringify(next));
    switchTo(id);
  }, [users, switchTo]);

  const clearUser = useCallback(() => {
    localStorage.removeItem("player_id");
    localStorage.removeItem("player_name");
    window.dispatchEvent(new Event("lms:store-updated"));
    setCurrent(null);
  }, []);

  return (
    <div className="fixed bottom-3 right-3 z-50 rounded-xl border border-slate-200 bg-white/95 shadow-lg p-2 text-xs">
      <div className="font-semibold mb-1">Dev: Switch User</div>
      <div className="flex gap-1 flex-wrap">
        {users.map((u) => (
          <button
            key={u}
            onClick={() => switchTo(u)}
            className={
              "px-2 py-1 rounded border " +
              (current === u ? "bg-emerald-600 text-white border-emerald-700" : "bg-white")
            }
            title={`Set player_id=${u}`}
          >
            {u}
          </button>
        ))}
        <button onClick={addUser} className="px-2 py-1 rounded border">+ Add</button>
        <button onClick={clearUser} className="px-2 py-1 rounded border">Clear</button>
      </div>
      <div className="mt-2 text-[10px] text-slate-600">
        Tip: append <code>?dev=1</code> once to enable this on production (local only).
      </div>
    </div>
  );
}
