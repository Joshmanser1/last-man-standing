import React from "react";

export const Spinner = ({ size = 16 }: { size?: number }) => (
  <span
    className="relative inline-grid place-items-center text-emerald-600"
    style={{ width: size, height: size }}
    role="status"
    aria-label="Loading"
  >
    <svg width={size} height={size} viewBox="0 0 24 24" className="animate-spin">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" fill="none" opacity=".18" />
      <path d="M12 3a9 9 0 0 1 8.5 6" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" />
    </svg>
    <span className="absolute h-1 w-1 rounded-full bg-current" aria-hidden="true" />
  </span>
);
