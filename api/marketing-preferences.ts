import { createClient } from "@supabase/supabase-js";
import { MARKETING_CAPTURE_SOURCES, MARKETING_CONSENT_VERSION, marketingPreferenceState, type MarketingPreferenceRow } from "../src/lib/marketingConsent";

type Req = { method?: string; headers?: Record<string, string | string[] | undefined>; body?: unknown };
type Res = { statusCode: number; setHeader: (name: string, value: string) => void; end: (body: string) => void };

export default async function handler(req: Req, res: Res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  const send = (status: number, body: unknown) => { res.statusCode = status; res.end(JSON.stringify(body)); };
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return send(405, { error: "Method Not Allowed" });
  }
  // Recording deployments must not capture consent, even if a real session exists.
  if (process.env.VITE_ENABLE_MARKETING_DEMO === "true") return send(403, { error: "Consent is disabled in recording mode." });
  const authorization = req.headers?.authorization ?? req.headers?.Authorization;
  const token = typeof authorization === "string" ? /^Bearer\s+(\S+)$/i.exec(authorization)?.[1] : null;
  if (!token) return send(401, { error: "Sign in to manage email preferences." });
  const url = process.env.SUPABASE_URL?.trim();
  const anon = (process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY)?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !anon || !serviceKey) return send(503, { error: "Email preferences are temporarily unavailable." });

  try {
    const auth = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: { user }, error: authError } = await auth.auth.getUser(token);
    if (authError || !user?.id) return send(401, { error: "Sign in to manage email preferences." });
    const email = user.email_confirmed_at && user.email ? user.email : null;
    const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    let row: MarketingPreferenceRow | null;
    if (req.method === "GET") {
      const { data, error } = await db.from("marketing_preferences").select("user_id, marketing_opt_in, consented_email, updated_at, latest_event_id").eq("user_id", user.id).maybeSingle();
      if (error) throw error;
      row = data;
    } else {
      let body: any;
      try { body = typeof req.body === "string" ? JSON.parse(req.body) : req.body; }
      catch { return send(400, { error: "Invalid request." }); }
      if (!body || typeof body.marketing_opt_in !== "boolean"
        || !MARKETING_CAPTURE_SOURCES.includes(body.capture_source)) return send(400, { error: "Invalid preference or capture source." });
      if (body.consent_version !== MARKETING_CONSENT_VERSION) return send(409, { error: "The consent wording has changed. Reload this page before saving." });
      if (body.marketing_opt_in && !email) return send(422, { error: "Verify your account email before subscribing." });
      const { data, error } = await db.rpc("set_marketing_preference", {
        p_user_id: user.id, p_opt_in: body.marketing_opt_in,
        p_capture_source: body.capture_source, p_consent_version: MARKETING_CONSENT_VERSION,
      });
      if (error) throw error;
      row = data as MarketingPreferenceRow;
    }
    return send(200, marketingPreferenceState(row, email));
  } catch {
    return send(503, { error: "Email preferences could not be saved or loaded. Please try again." });
  }
}
