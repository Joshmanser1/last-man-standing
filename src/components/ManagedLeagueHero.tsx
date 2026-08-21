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
      className="mb-5 overflow-hidden rounded-3xl border border-slate-200/70 shadow-sm"
      style={{
        background: `linear-gradient(145deg, ${primary} 0%, rgba(15, 23, 42, 0.94) 100%)`,
      }}
    >
      <div className="bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.22),_transparent_38%)]">
        <div className="space-y-4 px-4 py-5 text-white sm:px-6 sm:py-6">
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              {theme.hostLogoUrl ? (
                <img
                  src={theme.hostLogoUrl}
                  alt={`${hostName} logo`}
                  className="h-12 w-12 flex-none rounded-2xl border border-white/20 bg-white/10 object-cover"
                />
              ) : (
                <div className="flex h-12 w-12 flex-none items-center justify-center rounded-2xl border border-white/20 bg-white/12 text-sm font-bold tracking-wide text-white">
                  {getInitials(hostName)}
                </div>
              )}

              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/70">
                  {eyebrow}
                </div>
                <div className="truncate text-lg font-semibold text-white">{hostName}</div>
              </div>
            </div>

            <div className="inline-flex flex-none items-center rounded-full border border-white/20 bg-white/12 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/85">
              {badgeLabel}
            </div>
          </div>

          <div className="space-y-2">
            <h1 className="max-w-3xl text-2xl font-bold leading-tight text-white sm:text-3xl">
              {title}
            </h1>
            <p className="max-w-2xl text-sm leading-6 text-white/82 sm:text-[15px]">
              {tagline}
            </p>
          </div>

          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/65">
            Powered by Fantasy Command Centre
          </div>
        </div>
      </div>
    </section>
  );
}

export default ManagedLeagueHero;
