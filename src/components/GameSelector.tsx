// src/components/GameSelector.tsx
import React, { useEffect, useState } from "react";
import { dataService } from "../data/service";

type LeagueLite = {
  id: string;
  name: string;
  current_round: number;
  status: string;
  fpl_start_event?: number;
};

type GameSelectorProps = {
  /** Optional controlled value – falls back to localStorage / first league */
  value?: string;
  /** Fired when user switches game */
  onChange?: (leagueId: string, league?: LeagueLite) => void;
  /** Small label shown to the left/top */
  label?: string;
  /** Styling variant: header (dark) vs default (light) */
  variant?: "header" | "default";
  className?: string;
};

const STORAGE_KEY = "active_league_id";

export function GameSelector({
  value,
  onChange,
  label = "Game",
  variant = "default",
  className = "",
}: GameSelectorProps) {
  const [leagues, setLeagues] = useState<LeagueLite[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");

  // Load leagues once
  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const ls = (await (dataService as any).listLeagues?.()) as LeagueLite[] | undefined;
        if (!isMounted) return;
        if (Array.isArray(ls) && ls.length) {
          setLeagues(ls);

          // Initial selected: prop -> localStorage -> first league
          const stored = localStorage.getItem(STORAGE_KEY) || "";
          const initial =
            value ||
            (stored && ls.some((l) => l.id === stored) ? stored : "") ||
            ls[0].id;

          setSelectedId(initial);
          if (!localStorage.getItem(STORAGE_KEY)) {
            localStorage.setItem(STORAGE_KEY, initial);
          }
        } else {
          setLeagues([]);
        }
      } catch (e) {
        console.warn("GameSelector: failed to load leagues", e);
      }
    })();
    return () => {
      isMounted = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync when parent drives the value
  useEffect(() => {
    if (value && value !== selectedId) {
      setSelectedId(value);
    }
  }, [value]);

  function handleChange(id: string) {
    setSelectedId(id);
    localStorage.setItem(STORAGE_KEY, id);

    const league = leagues.find((l) => l.id === id);
    onChange?.(id, league);
  }

  if (!leagues.length) {
    return null;
  }

  const baseSelectCls =
    variant === "header"
      ? "rounded-lg bg-white/10 text-white px-2 py-1 text-sm outline-none hover:bg-white/15"
      : "border rounded-lg px-3 py-2 text-sm text-slate-800 bg-white outline-none hover:bg-slate-50";

  return (
    <div
      className={
        "flex items-center gap-2 " +
        (variant === "header" ? "text-white/80" : "text-slate-700") +
        " " +
        className
      }
    >
      {label && (
        <span
          className={
            "text-xs " +
            (variant === "header" ? "text-white/70" : "text-slate-500")
          }
        >
          {label}
        </span>
      )}
      <select
        className={baseSelectCls}
        value={selectedId}
        onChange={(e) => handleChange(e.target.value)}
      >
        {leagues.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name} (R{l.current_round})
          </option>
        ))}
      </select>
    </div>
  );
}
