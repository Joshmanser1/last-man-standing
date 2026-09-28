import { createClient } from "@supabase/supabase-js";
import { createResendTransport } from "../server/email/resendTransport.js";
import { processServiceEmails } from "../server/email/serviceEmailProcessor.js";
import { createSupabaseServiceEmailRepository } from "../server/email/supabaseServiceEmailRepository.js";

type Req = { method?: string; headers?: Record<string, string | string[] | undefined>; query?: Record<string, string | string[] | undefined> };
type Res = { statusCode: number; setHeader(name: string, value: string): void; end(body: string): void };

function respond(res: Res, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function bearer(req: Req) {
  const header = req.headers?.authorization ?? req.headers?.Authorization;
  if (!header || Array.isArray(header)) return null;
  return /^Bearer\s+(\S+)$/i.exec(header)?.[1] ?? null;
}

export default async function handler(req: Req, res: Res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return respond(res, 405, { error: "Method Not Allowed" });
  }
  const secret = process.env.CRON_SECRET;
  const queryKey = typeof req.query?.key === "string" ? req.query.key : null;
  if (!secret || (bearer(req) !== secret && queryKey !== secret)) return respond(res, 401, { error: "Unauthorized" });

  const enabled = process.env.SERVICE_EMAILS_ENABLED === "true";
  if (!enabled) return respond(res, 200, {
    disabled: true, remindersSent: 0, resultsSent: 0, skipped: 0, failed: 0,
    zeroSurvivorRoundsSkipped: 0, missingAuthEmail: 0, pilotBlocked: 0, ineligibleAfterClaim: 0,
    ambiguousMissedPickResultsSkipped: 0,
  });
  const url = process.env.SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.SERVICE_EMAIL_FROM?.trim();
  const replyTo = process.env.SERVICE_EMAIL_REPLY_TO?.trim();
  const appOrigin = process.env.APP_ORIGIN?.trim();
  if (!url || !serviceKey || !apiKey || !from || !replyTo || !appOrigin) {
    return respond(res, 503, { error: "Service email configuration is incomplete." });
  }
  try {
    const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const summary = await processServiceEmails({
      enabled, appOrigin, pilotAllowlist: process.env.SERVICE_EMAIL_PILOT_ALLOWLIST,
      now: new Date(), repository: createSupabaseServiceEmailRepository(supabase),
      transport: createResendTransport({ apiKey, from, replyTo }),
    });
    return respond(res, summary.failed > 0 ? 207 : 200, summary);
  } catch (error) {
    console.error("Service email processor failed", error);
    return respond(res, 502, { error: "Service email processing failed." });
  }
}
