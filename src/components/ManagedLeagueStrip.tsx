import type { League, ManagedLeagueTheme } from "../data/types";

type ManagedLeagueStripProps = {
  league: League;
  theme: ManagedLeagueTheme | null;
};

function getInitials(hostName: string) {
  const parts = hostName
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 2);

  if (!parts.length) return "FCC";
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("");
}

export function ManagedLeagueStrip({ league, theme }: ManagedLeagueStripProps) {
  if (!theme?.enabled) return null;

  const primary = theme.primaryColour?.trim() || "#0f766e";
  const hostName = theme.hostName.trim();
  const competitionName = theme.displayName?.trim() || league.name;
  const badgeLabel = theme.managed === false ? "Hosted on FCC" : "Managed by FCC";

  return (
    <section
      className="overflow-hidden rounded-2xl border border-slate-200/70 shadow-sm"
      style={{
        background: `linear-gradient(145deg, ${primary} 0%, rgba(15, 23, 42, 0.94) 100%)`,
      }}
    >
      <div className="bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.18),_transparent_36%)]">
        <div className="flex min-w-0 flex-col gap-3 px-4 py-3 text-white sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            {theme.hostLogoUrl ? (
              <img
                src={theme.hostLogoUrl}
                alt={`${hostName} logo`}
                className="h-10 w-10 flex-none rounded-2xl border border-white/20 bg-white/10 object-cover"
              />
            ) : (
              <div className="flex h-10 w-10 flex-none items-center justify-center rounded-2xl border border-white/20 bg-white/12 text-xs font-bold tracking-wide text-white">
                {getInitials(hostName)}
              </div>
            )}

            <div className="min-w-0">
              <div className="truncate text-sm font-bold uppercase tracking-[0.16em] text-white sm:text-[15px]">
                {hostName}
              </div>
              <div className="truncate text-sm text-white/82">{competitionName}</div>
            </div>
          </div>

          <div className="inline-flex w-fit flex-none items-center rounded-full border border-white/20 bg-white/12 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/85 sm:text-[11px]">
            {badgeLabel}
          </div>
        </div>
      </div>
    </section>
  );
}

export default ManagedLeagueStrip;
