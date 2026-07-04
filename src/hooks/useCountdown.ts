import { useEffect, useState } from "react";

export const useCountdown = (iso?: string) => {
  const [val, setVal] = useState("...");
  useEffect(() => {
    if (!iso) {
      setVal("—");
      return;
    }
    const end = new Date(iso).getTime();
    const update = () => {
      const d = end - Date.now();
      if (d <= 0) {
        setVal("Locked");
        return false;
      }
      const totalMinutes = Math.floor(d / 60_000);
      const totalHours = Math.floor(totalMinutes / 60);
      const days = Math.floor(totalHours / 24);
      const hours = totalHours % 24;
      const minutes = totalMinutes % 60;
      if (days >= 1) {
        setVal(`${days}d ${hours}h remaining`);
      } else {
        setVal(`${totalHours}h ${minutes}m remaining`);
      }
      return true;
    };
    if (!update()) return;
    const id = setInterval(() => {
      if (!update()) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [iso]);
  return val;
};
