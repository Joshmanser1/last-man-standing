// src/components/FplGwSelect.tsx
import React, { useEffect, useState } from "react";

type FplEvent = {
  id: number;
  name: string;
  deadline_time: string; // ISO
  finished: boolean;
  is_current: boolean;
  is_next: boolean;
};

type FplGwSelectProps = {
  value?: number;
  onChange?: (eventId: number, event?: FplEvent) => void;
  label?: string;
  onlyUpcoming?: boolean;
  className?: string;
  /** Optional alternate source if /fpl/api/bootstrap-static/ fails (403 etc.) */
  fallbackUrl?: string; // defaults to /mock-fpl-bootstrap.json
};

async function loadBootstrap(): Promise<{ events: FplEvent[] }> {
  // 1) Try live FPL (via our /fpl rewrite)
  const live = await fetch("/fpl/api/bootstrap-static/");
  if (live.ok) return live.json();

  // 2) If that fails (403 etc), try fallback file
  const backup = await fetch("/mock-fpl-bootstrap.json");
  if (!backup.ok) {
    const msg = `Failed to load FPL events: ${live.status}`;
    throw new Error(msg);
  }
  return backup.json();
}

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
        const data = await loadBootstrap();
        let evs = (data.events || []) as FplEvent[];

        if (onlyUpcoming) {
          const now = Date.now();
          evs = evs.filter(
            (e) => !e.finished && Date.parse(e.deadline_time) >= now
          );
        }

        if (!isMounted) return;
        setEvents(evs);

        if (!value && evs.length) {
          const current =
            evs.find((e) => e.is_current) ||
            evs.find((e) => e.is_next) ||
            evs[0];
          setSelected(current.id);
          onChange?.(current.id, current);
        } else if (value) {
          setSelected(value);
        }
      } catch (e: any) {
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
        {label && <label className="label mb-1">{label}</label>}
        <div className="text-xs text-slate-500">Loading FPL calendar…</div>
      </div>
    );
  }

  if (error && !events.length) {
    return (
      <div className={className}>
        {label && <label className="label mb-1">{label}</label>}
        <div className="text-xs text-rose-600">
          {error} — using fallback failed too.
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      {label && <label className="label mb-1">{label}</label>}
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
        If the live FPL API blocks requests, we automatically use a local fallback.
      </p>
    </div>
  );
}
