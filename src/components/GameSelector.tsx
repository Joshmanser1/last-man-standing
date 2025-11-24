// src/components/GameSelector.tsx
import { useEffect, useState } from "react";
import { dataService, subscribeStore } from "../data/service";

type Props = {
  /** Controlled selected id. If omitted we read/write localStorage('active_league_id') */
  value?: string;
  /** Called when user picks a league (id). Also writes active_league_id. */
  onChange?: (leagueId: string) => void;
  /** Visual tweaks for header vs default usage */
  variant?: "header" | "default";
  /** Optional label text (hidden in header variant) */
  label?: string;
};

type LeagueLite = { id: string; name: string };

export function GameSelector({
  value,
  onChange,
  variant = "default",
  label = "Game",
}: Props) {
  const [leagues, setLeagues] = useState<LeagueLite[]>([]);
  const [selected, setSelected] = useState<string>(
    value ?? localStorage.getItem("active_league_id") ?? ""
  );

  async function reload() {
    const ls = (await (dataService as any).listLeagues?.()) as
      | LeagueLite[]
      | undefined;
    const list = ls ?? [];
    setLeagues(list);

    // keep selection valid
    const active = localStorage.getItem("active_league_id");
    const valid = active && list.some((l) => l.id === active);
    if (!value) {
      setSelected(valid ? (active as string) : list[0]?.id ?? "");
      if (!valid && list[0]?.id) {
        localStorage.setItem("active_league_id", list[0].id);
      }
      if (!valid && !list.length) {
        localStorage.removeItem("active_league_id");
      }
    }
  }

  useEffect(() => {
    reload();
    const unsub = subscribeStore(reload);
    const onFocus = () => reload();
    window.addEventListener("focus", onFocus);
    return () => {
      unsub();
      window.removeEventListener("focus", onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (value !== undefined) setSelected(value);
  }, [value]);

  function change(id: string) {
    if (!id) return;
    localStorage.setItem("active_league_id", id);
    setSelected(id);
    onChange?.(id);
  }

  // Header select: compact, white background (so the native dropdown is readable),
  // fixed width + truncate to avoid pushing into the Logout button.
  const cls =
    variant === "header"
      ? "h-9 w-[220px] max-w-[260px] truncate border border-white/20 rounded-md bg-white text-slate-900 px-3 py-1 shadow-sm focus:outline-none"
      : "input !w-full";

  return (
    <div className={variant === "header" ? "flex items-center gap-2" : ""}>
      {variant !== "header" && label ? (
        <span className="label mb-1">{label}</span>
      ) : null}
      <select
        className={cls}
        value={selected}
        onChange={(e) => change(e.target.value)}
        title={
          leagues.find((l) => l.id === selected)?.name ??
          "Select a game"
        }
      >
        {leagues.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>
    </div>
  );
}

export default GameSelector;
