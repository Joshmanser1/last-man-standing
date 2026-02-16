const key = process.env.CRON_SECRET || "";
const base =
  process.env.TICK_URL ||
  "http://localhost:5173/api/tick?key=" + encodeURIComponent(key);

console.log("Running tick against:", base);

const res = await fetch(base, { cache: "no-store" });
const text = await res.text();

console.log("\n=== RESPONSE ===\n");
console.log(text);

process.exit(res.ok ? 0 : 1);
