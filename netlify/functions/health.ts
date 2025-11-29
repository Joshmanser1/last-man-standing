import type { Handler } from "@netlify/functions";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY;

export const handler: Handler = async () => {
  const started = Date.now();
  let supabase = { ok: false as boolean, ms: 0, status: 0 };

  try {
    const t0 = Date.now();
    const res = await fetch(`${SUPABASE_URL}/rest/v1/?select=%2A`, {
      method: "GET",
      headers: {
        apikey: SUPABASE_KEY!,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    });
    supabase = { ok: res.ok, ms: Date.now() - t0, status: res.status };
  } catch {
    supabase = { ok: false, ms: Date.now() - started, status: 0 };
  }

  return {
    statusCode: 200,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
    body: JSON.stringify({
      status: "ok",
      service: "fantasy-command-centre",
      time: new Date().toISOString(),
      version: process.env.VITE_APP_VERSION || "1.0.0",
      gitCommit: process.env.COMMIT_REF || null,
      netlify: {
        context: process.env.CONTEXT || null,
        branch: process.env.BRANCH || null,
        url: process.env.URL || null,
      },
      supabase,
      uptime_ms: Date.now() - started,
    }),
  };
};
