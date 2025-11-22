import { useEffect, useState } from "react";
import { dataService } from "../data/service";

const LEAGUE_NAME = "English Premier League LMS";

export function Standings() {
  const [round,setRound] = useState<any>(null);
  const [league,setLeague] = useState<any>(null);
  const [rows,setRows] = useState<any[]>([]);
  const [players, setPlayers] = useState<Record<string,string>>({});

  useEffect(()=>{(async()=>{
    const l = await dataService.getLeagueByName(LEAGUE_NAME); setLeague(l);
    const r = await dataService.getCurrentRound(l.id); setRound(r);
    const picks = await dataService.listPicks(r.id);
    setRows(picks);

    // build player name map from picks (local mock stores players in localStorage)
    const store = JSON.parse(localStorage.getItem("lms_store_v1") || "{}");
    const map:Record<string,string> = {};
    (store?.players ?? []).forEach((p:any)=> map[p.id]=p.display_name);
    setPlayers(map);
  })()},[]);

  const stillIn = rows.filter(p=>['pending','through'].includes(p.status));
  const out = rows.filter(p=>['eliminated','no-pick'].includes(p.status));

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h2 className="text-2xl font-bold mb-2">Standings — Round {round?.round_number}</h2>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="border rounded p-4">
          <h3 className="font-semibold mb-2">✅ Still In ({stillIn.length})</h3>
          {stillIn.map((r,i)=><div key={i} className="py-1">{players[r.player_id] ?? r.player_id}</div>)}
        </div>
        <div className="border rounded p-4">
          <h3 className="font-semibold mb-2">❌ Eliminated ({out.length})</h3>
          {out.map((r,i)=><div key={i} className="py-1">
            {players[r.player_id] ?? r.player_id} <span className="text-xs text-gray-500">({r.reason})</span>
          </div>)}
        </div>
      </div>
    </div>
  );
}
