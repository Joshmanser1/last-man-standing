// src/components/DevUserSwitcher.tsx
import { useEffect, useState } from "react";

const KEY = "lms_dev_users_v1";

// Small helper to write a "realistic" local dev user shape
function setDevIdentity(id: string) {
  const display =
    id === "demo-a" ? "Demo A" : id === "demo-b" ? "Demo B" : id.toUpperCase();

  localStorage.setItem("player_id", id);
  localStorage.setItem("player_name", display);
  // Optional: mark as non-admin by default
  if (!localStorage.getItem("is_admin")) {
    localStorage.setItem("is_admin", "false");
  }

  // Nudge listeners (or fallback to reload if your app doesn’t listen)
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

    const onStore = () => {
      setCurrent(localStorage.getItem("player_id"));
    };
    window.addEventListener("lms:store-updated", onStore);
    window.addEventListener("storage", onStore);
    return () => {
      window.removeEventListener("lms:store-updated", onStore);
      window.removeEventListener("storage", onStore);
    };
  }, []);

  function switchTo(id: string) {
    setDevIdentity(id);
    setCurrent(id);
  }

  function addUser() {
    const id = prompt("New test user id (e.g., demo-c):");
    if (!id) return;
    const safe = id.trim();
    const next = Array.from(new Set([...users, safe]));
    setUsers(next);
    localStorage.setItem(KEY, JSON.stringify(next));
    switchTo(safe);
  }

  function clearUser() {
    localStorage.removeItem("player_id");
    localStorage.removeItem("player_name");
    setCurrent(null);
    window.dispatchEvent(new Event("lms:store-updated"));
  }

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
    </div>
  );
}
