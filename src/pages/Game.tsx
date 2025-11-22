import { useEffect, useState } from "react";
import { dataService } from "../data/service";
import { useCountdown } from "../hooks/useCountdown";
import { useNavigate } from "react-router-dom";

const LEAGUE_NAME = "English Premier League LMS";

export function Game() {
  const [league,setLeague] = useState<any>(null);
  const [round,setRound] = useState<any>(null);
  const navigate = useNavigate();

  useEffect(()=>{(async()=>{
    const l = await dataService.getLeagueByName(LEAGUE_NAME);
    setLeague(l);
    setRound(await dataService.getCurrentRound(l.id));
  })()},[]);

  const timeLeft = useCountdown(round?.pick_deadline_utc);

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h2 className="text-2xl font-bold mb-2">{league?.name}</h2>
      <p className="mb-4">Round {round?.round_number} • Deadline ⏱ {timeLeft}</p>

      <div className="flex gap-3">
        <button onClick={()=>navigate('/make-pick')}
                className="bg-teal-700 text-white px-4 py-2 rounded"
                disabled={timeLeft === "00:00:00"}>
          {timeLeft === "00:00:00" ? "Round Locked" : "Make / Edit Pick"}
        </button>
        <button onClick={()=>navigate('/standings')}
                className="border px-4 py-2 rounded">
          View Standings
        </button>
      </div>
    </div>
  );
}
