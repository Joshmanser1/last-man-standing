// src/components/DevUserSwitcher.tsx
import React from "react";
if (!localStorage.getItem("player_id")) {
  localStorage.setItem("player_id", "local-user-a");
}

export function DevUserSwitcher() {
  // Only show in dev mode
  if (import.meta.env.PROD) return null;

  const users = [
    { id: "local-user-a", name: "JM (Player A)" },
    { id: "local-user-b", name: "Test User B" },
  ];

  function switchUser(id: string) {
    localStorage.setItem("player_id", id);
    alert(`Switched to ${id}`);
    window.location.reload();
  }

  const current = localStorage.getItem("player_id");

  return (
    <div
      style={{
        position: "fixed",
        bottom: "1rem",
        right: "1rem",
        background: "white",
        border: "1px solid #ddd",
        borderRadius: "8px",
        padding: "8px 12px",
        fontSize: "13px",
        zIndex: 1000,
        boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: "4px" }}>👥 Test Users</div>
      {users.map((u) => (
        <button
          key={u.id}
          onClick={() => switchUser(u.id)}
          style={{
            display: "block",
            margin: "2px 0",
            padding: "4px 8px",
            width: "100%",
            textAlign: "left",
            borderRadius: "6px",
            border: "none",
            background:
              current === u.id ? "rgb(13 148 136 / 0.1)" : "transparent",
            color: current === u.id ? "#0f766e" : "#333",
            cursor: "pointer",
          }}
        >
          {u.name}
          {current === u.id && " ✓"}
        </button>
      ))}
    </div>
  );
}
