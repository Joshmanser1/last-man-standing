import { useEffect, useState } from "react";

type TeamBadgeProps = {
  code?: string | null;
  logoUrl?: string | null;
  fplTeamCode?: number | null;
  name: string;
  size?: "sm" | "md";
};

// Populate only with supplied, versioned local crest assets.
const LOCAL_CRESTS_BY_CODE: Record<string, string> = {};

function getTrustedLocalCrest(code: string, logoUrl?: string | null) {
  const mapped = LOCAL_CRESTS_BY_CODE[code];
  if (mapped) return mapped;

  // Existing seeded logo_url values are third-party placeholders, so ignore them.
  return logoUrl?.startsWith("/team-crests/") ? logoUrl : null;
}

function getOfficialFplCrest(fplTeamCode?: number | null) {
  const numericCode = Number(fplTeamCode);
  if (!Number.isInteger(numericCode) || numericCode <= 0) return null;

  return `https://resources.premierleague.com/premierleague/badges/50/t${numericCode}.png`;
}

export function TeamBadge({ code, logoUrl, fplTeamCode, name, size = "md" }: TeamBadgeProps) {
  const normalizedCode = String(code ?? name.slice(0, 3)).trim().toUpperCase().slice(0, 3) || "FC";
  const crestSources = [
    getOfficialFplCrest(fplTeamCode),
    getTrustedLocalCrest(normalizedCode, logoUrl),
  ].filter((source): source is string => !!source);
  const [crestIndex, setCrestIndex] = useState(0);
  const crest = crestSources[crestIndex] ?? null;
  const dimensions = size === "sm" ? "h-10 w-10 text-[10px]" : "h-12 w-12 text-xs";

  useEffect(() => {
    setCrestIndex(0);
  }, [code, fplTeamCode, logoUrl]);

  if (crest) {
    return (
      <img
        src={crest}
        alt=""
        className={`${dimensions} shrink-0 rounded-xl object-contain`}
        onError={() => setCrestIndex((index) => index + 1)}
      />
    );
  }

  return (
    <span
      className={`${dimensions} inline-flex shrink-0 items-center justify-center rounded-xl border border-emerald-200/20 bg-emerald-300/10 font-extrabold tracking-[0.08em] text-emerald-200 shadow-[0_1px_0_rgba(225,255,239,0.08)_inset]`}
      aria-hidden="true"
    >
      {normalizedCode}
    </span>
  );
}
