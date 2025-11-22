import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

type Variant = "info" | "success" | "error";
type ToastItem = { id: string; message: string; variant: Variant; ttlMs: number };

type ToastCtx = {
  toast: (message: string, opts?: { variant?: Variant; ttlMs?: number }) => void;
};

const Ctx = createContext<ToastCtx | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef<Record<string, number>>({});

  const toast = useCallback((message: string, opts?: { variant?: Variant; ttlMs?: number }) => {
    const id = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);
    const item: ToastItem = {
      id,
      message,
      variant: opts?.variant ?? "info",
      ttlMs: Math.max(1200, Math.min(opts?.ttlMs ?? 2600, 10000)),
    };
    setItems((prev) => [...prev, item]);

    // auto-dismiss
    timers.current[id] = window.setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id));
      delete timers.current[id];
    }, item.ttlMs);
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {/* container */}
      <div className="fixed z-[9999] bottom-4 left-1/2 -translate-x-1/2 w-[92vw] sm:w-auto space-y-2">
        {items.map((t) => (
          <div
            key={t.id}
            className={[
              "mx-auto max-w-md rounded-xl px-4 py-2.5 shadow-lg text-sm backdrop-blur border",
              t.variant === "success" && "bg-emerald-50/95 border-emerald-200 text-emerald-900",
              t.variant === "error" && "bg-rose-50/95 border-rose-200 text-rose-900",
              t.variant === "info" && "bg-slate-50/95 border-slate-200 text-slate-900",
            ].join(" ")}
          >
            {t.message}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx.toast;
}
