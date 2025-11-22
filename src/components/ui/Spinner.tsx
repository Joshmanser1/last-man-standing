import React from "react";
export const Spinner = ({ size=16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" className="animate-spin text-teal-600">
    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" opacity=".2"/>
    <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="4" fill="none"/>
  </svg>
);
