import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { dataService } from "../data/service";

type LeagueLite = { id: string; name: string; current_round: number; status: string };

type Ctx = {
  leagues: LeagueLite[];
  activeLeagueId: string | null;
  setActiveLeagueId: (id: string) => void;
  activeLeague: LeagueLite | null;
  refresh: () => Promise<void>;
};

const ActiveLeagueContext = createContext<Ctx>({
  leagues: [],
  activeLeagueId: null,
  setActiveLeagueId: () => {},
  activeLeague: null,
  refresh: async () => {},
});

export function ActiveLeagueProvider({ children }: { children: React.ReactNode }) {
  const [leagues, setLeagues] = useState<LeagueLite[]>([]);
  const [activeLeagueId, setActiveLeagueIdState] = useState<string | null>(
    () => localStorage.getItem("active_league_id")
  );

  async function refresh() {
    const ls = await (dataService as any).listLeagues?.();
    if (Array.isArray(ls) && ls.length) {
      setLeagues(ls);
      if (!activeLeagueId) {
        setActiveLeagueIdState(ls[0].id);
        localStorage.setItem("active_league_id", ls[0].id);
      }
    }
  }

  useEffect(() => { refresh(); }, []);

  const setActiveLeagueId = (id: string) => {
    setActiveLeagueIdState(id);
    localStorage.setItem("active_league_id", id);
  };

  const activeLeague = useMemo(
    () => leagues.find(l => l.id === activeLeagueId) ?? null,
    [leagues, activeLeagueId]
  );

  return (
    <ActiveLeagueContext.Provider value={{ leagues, activeLeagueId, setActiveLeagueId, activeLeague, refresh }}>
      {children}
    </ActiveLeagueContext.Provider>
  );
}

export const useActiveLeague = () => useContext(ActiveLeagueContext);
