// src/components/DevUserSwitcher.tsx
import { useEffect, useState } from "react";

const KEY = "lms_dev_users_v1";

export function DevUserSwitcher() {
  const [users, setUsers] = useState<string[]>([]);
  const [current, setCurrent] = useState<string | null>(
    localStorage.getItem("player_id")
  );

  useEffect(() => {
    const raw = localStorage.getItem(KEY);
    setUsers(raw ? JSON.parse(raw) : ["demo-a", "demo-b"]);
  }, []);

  function switchTo(id: string) {
    localStorage.setItem("player_id", id);
    setCurrent(id);
    // Optional: force app to react to store changes
    window.dispatchEvent(new Event("lms:store-updated"));
  }

  function addUser() {
    const id = prompt("New test user id (e.g., demo-c):");
    if (!id) return;
    const next = Array.from(new Set([...users, id]));
    setUsers(next);
    localStorage.setItem(KEY, JSON.stringify(next));
  }

  return (
    <div className="fixed bottom-3 right-3 z-50 rounded-xl border bg-white shadow p-2 text-xs">
      <div className="font-semibold mb-1">Dev: Switch User</div>
      <div className="flex gap-1 flex-wrap">
        {users.map((u) => (
          <button
            key={u}
            onClick={() => switchTo(u)}
            className={
              "px-2 py-1 rounded border " +
              (current === u ? "bg-emerald-600 text-white" : "bg-white")
            }
            title={`Set player_id=${u}`}
          >
            {u}
          </button>
        ))}
        <button onClick={addUser} className="px-2 py-1 rounded border">
          + Add
        </button>
      </div>
    </div>
  );
}
