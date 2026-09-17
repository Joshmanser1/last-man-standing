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
  /** Optional data-testid for the <select> */
  selectTestId?: string;
  /** Optional alternate source if /fpl/api/bootstrap-static/ fails (403 etc.) */
  fallbackUrl?: string; // defaults to /mock-fpl-bootstrap.json
};

function parseBootstrap(text: string, source: string): { events: FplEvent[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${source} returned invalid JSON.`);
  }

  const events = (parsed as { events?: unknown })?.events;
  if (
    !Array.isArray(events) ||
    events.length === 0 ||
    !events.every(
      (event) =>
        typeof event?.id === "number" &&
        typeof event?.name === "string" &&
        typeof event?.deadline_time === "string" &&
        !Number.isNaN(Date.parse(event.deadline_time))
    )
  ) {
    throw new Error(`${source} did not contain valid FPL event data.`);
  }

  return { events: events as FplEvent[] };
}

async function loadBootstrap(fallbackUrl: string): Promise<{ events: FplEvent[] }> {
  let liveError: Error | null = null;

  try {
    // Vercel serves this through api/fpl.ts; Vite development may return source text instead.
    const live = await fetch("/api/fpl?path=%2Fbootstrap-static%2F", { cache: "no-store" });
    if (!live.ok) throw new Error(`Live FPL request failed with ${live.status}.`);
    return parseBootstrap(await live.text(), "Live FPL source");
  } catch (error: any) {
    liveError = error instanceof Error ? error : new Error("Live FPL source failed.");
  }

  try {
    const backup = await fetch(fallbackUrl, { cache: "no-store" });
    if (!backup.ok) throw new Error(`Local FPL fallback failed with ${backup.status}.`);
    return parseBootstrap(await backup.text(), "Local FPL fallback");
  } catch (fallbackError: any) {
    const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : "Local FPL fallback failed.";
    throw new Error(`${liveError.message} ${fallbackMessage}`);
  }
}

export function FplGwSelect({
  value,
  onChange,
  label = "Start FPL Gameweek",
  onlyUpcoming = false,
  className = "",
  selectTestId,
  fallbackUrl = "/mock-fpl-bootstrap.json",
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
        const data = await loadBootstrap(fallbackUrl);
        const allEvents = (data.events || []) as FplEvent[];
        let evs = allEvents;

        if (onlyUpcoming) {
          const now = Date.now();
          evs = evs.filter(
            (e) => !e.finished && Date.parse(e.deadline_time) >= now
          );
          if (!evs.length) {
            evs = allEvents;
          }
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
        <div className="text-xs text-rose-600">{error}</div>
      </div>
    );
  }

  return (
    <div className={className}>
      {label && <label className="label mb-1">{label}</label>}
      <select
        data-testid={selectTestId}
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
