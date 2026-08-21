import type { League, ManagedLeagueTheme } from "../data/types";

type ManagedLeagueHeroProps = {
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

export function ManagedLeagueHero({ league, theme }: ManagedLeagueHeroProps) {
  if (!theme?.enabled) return null;

  const primary = theme.primaryColour?.trim() || "#0f766e";
  const title = theme.displayName?.trim() || league.name;
  const eyebrow = theme.eyebrow?.trim() || "Community league";
  const tagline = theme.tagline?.trim() || "One team. One win. Survive and go again.";
  const hostName = theme.hostName.trim();
  const badgeLabel = theme.managed === false ? "Hosted on FCC" : "Managed by FCC";

  return (
    <section
      className="mb-4 overflow-hidden rounded-3xl border border-slate-200/70 shadow-sm sm:mb-5"
      style={{
        background: `linear-gradient(145deg, ${primary} 0%, rgba(15, 23, 42, 0.94) 100%)`,
      }}
    >
      <div className="bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.22),_transparent_38%)]">
        <div className="space-y-3 px-4 py-4 text-white sm:space-y-4 sm:px-6 sm:py-6">
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-2.5 sm:gap-3">
            <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
              {theme.hostLogoUrl ? (
                <img
                  src={theme.hostLogoUrl}
                  alt={`${hostName} logo`}
                  className="h-11 w-11 flex-none rounded-2xl border border-white/20 bg-white/10 object-cover sm:h-12 sm:w-12"
                />
              ) : (
                <div className="flex h-11 w-11 flex-none items-center justify-center rounded-2xl border border-white/20 bg-white/12 text-sm font-bold tracking-wide text-white sm:h-12 sm:w-12">
                  {getInitials(hostName)}
                </div>
              )}

              <div className="min-w-0 space-y-0.5">
                <div className="truncate text-base font-bold uppercase tracking-[0.16em] text-white sm:text-lg sm:tracking-[0.18em]">
                  {hostName}
                </div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/72 sm:text-[11px] sm:tracking-[0.22em]">
                  {eyebrow}
                </div>
              </div>
            </div>

            <div className="inline-flex flex-none items-center rounded-full border border-white/20 bg-white/12 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/85 sm:px-3 sm:text-[11px] sm:tracking-[0.18em]">
              {badgeLabel}
            </div>
          </div>

          <div className="space-y-1.5 sm:space-y-2">
            <h1 className="max-w-3xl text-[1.85rem] font-bold uppercase leading-none tracking-[0.06em] text-white sm:text-3xl sm:leading-tight sm:tracking-[0.04em]">
              {title}
            </h1>
            <p className="max-w-2xl text-[13px] leading-5 text-white/82 sm:text-[15px] sm:leading-6">
              {tagline}
            </p>
          </div>

          <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-white/65 sm:text-[11px] sm:tracking-[0.18em]">
            Powered by Fantasy Command Centre
          </div>
        </div>
      </div>
    </section>
  );
}

export default ManagedLeagueHero;
