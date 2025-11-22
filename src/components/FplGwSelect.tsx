// src/components/FplGwSelect.tsx
import React, { useEffect, useState } from "react";

type FplEvent = {
  id: number;
  name: string; // "Gameweek 1"
  deadline_time: string; // ISO
  finished: boolean;
  is_current: boolean;
  is_next: boolean;
};

type FplGwSelectProps = {
  /** Selected FPL event id (1–38). If omitted, component manages its own. */
  value?: number;
  /** Called when the user changes GW */
  onChange?: (eventId: number, event?: FplEvent) => void;
  /** Optional label above the select */
  label?: string;
  /** Include only upcoming events? */
  onlyUpcoming?: boolean;
  className?: string;
};

export function FplGwSelect({
  value,
  onChange,
  label = "Start FPL Gameweek",
  onlyUpcoming = false,
  className = "",
}: FplGwSelectProps) {
  const [events, setEvents] = useState<FplEvent[]>([]);
  const [selected, setSelected] = useState<number | undefined>(value);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/fpl/api/bootstrap-static/");
        if (!res.ok) throw new Error(`Failed to load FPL events: ${res.status}`);
        const data = await res.json();
        const evs = (data.events || []) as FplEvent[];

        let filtered = evs;
        if (onlyUpcoming) {
          const now = Date.now();
          filtered = evs.filter(
            (e) => !e.finished && Date.parse(e.deadline_time) >= now
          );
        }

        if (!isMounted) return;
        setEvents(filtered);

        if (!value && filtered.length) {
          // Prefer current / next GW when uncontrolled
          const current =
            filtered.find((e) => e.is_current) ||
            filtered.find((e) => e.is_next) ||
            filtered[0];
          setSelected(current.id);
          onChange?.(current.id, current);
        } else if (value) {
          setSelected(value);
        }
      } catch (e: any) {
        console.error(e);
        if (!isMounted) return;
        setError(e?.message ?? "Failed to load FPL calendar.");
      } finally {
        if (isMounted) setLoading(false);
      }
    })();
    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // keep internal state in sync when parent controls value
  useEffect(() => {
    if (typeof value === "number") setSelected(value);
  }, [value]);

  function handleChange(raw: string) {
    const id = Number(raw) || 0;
    setSelected(id);
    const ev = events.find((e) => e.id === id);
    onChange?.(id, ev);
  }

  if (loading && !events.length) {
    return (
      <div className={className}>
        {label && (
          <label className="label mb-1">
            {label}
          </label>
        )}
        <div className="text-xs text-slate-500">Loading FPL calendar…</div>
      </div>
    );
  }

  if (error && !events.length) {
    return (
      <div className={className}>
        {label && <label className="label mb-1">{label}</label>}
        <div className="text-xs text-rose-600">{error}</div>
      </div>
    );
  }

  return (
    <div className={className}>
      {label && (
        <label className="label mb-1">
          {label}
        </label>
      )}
      <select
        className="input"
        value={selected ?? ""}
        onChange={(e) => handleChange(e.target.value)}
      >
        {events.map((e) => {
          const deadline = new Date(e.deadline_time).toLocaleString();
          return (
            <option key={e.id} value={e.id}>
              GW {e.id} — {deadline}
            </option>
          );
        })}
      </select>
      <p className="mt-1 text-[11px] text-slate-500">
        Deadlines come directly from the official FPL API.
      </p>
    </div>
  );
}
