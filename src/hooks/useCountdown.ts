import { useEffect, useState } from "react";

export const useCountdown = (iso?: string) => {
  const [val,setVal]=useState("...");
  useEffect(()=>{
    if(!iso) return;
    const end=new Date(iso).getTime();
    const id=setInterval(()=>{
      const d=end-Date.now();
      if(d<=0){ setVal("00:00:00"); clearInterval(id); return; }
      const h=String(Math.floor(d/3_600_000)).padStart(2,'0');
      const m=String(Math.floor((d%3_600_000)/60_000)).padStart(2,'0');
      const s=String(Math.floor((d%60_000)/1000)).padStart(2,'0');
      setVal(`${h}:${m}:${s}`);
    },1000);
    return ()=>clearInterval(id);
  },[iso]);
  return val;
};
