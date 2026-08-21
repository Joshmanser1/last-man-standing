import { createClient } from "@supabase/supabase-js";

type Req = {
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
};

type Res = {
  statusCode: number;
  setHeader: (name: string, value: string) => void;
  end: (body: string) => void;
};

function sendJson(res: Res, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function getBearerToken(req: Req): string | null {
  const authHeader =
    req.headers?.authorization ??
    (req.headers as Record<string, string | string[] | undefined> | undefined)?.Authorization;
  if (!authHeader || Array.isArray(authHeader)) return null;
  const [scheme, token] = authHeader.split(" ");
  if (!scheme || !token) return null;
  if (scheme.toLowerCase() !== "bearer") return null;
  return token;
}

export default async function handler(req: Req, res: Res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return sendJson(res, 405, { error: "Method Not Allowed" });
  }

  const supabaseUrl = (process.env.SUPABASE_URL ?? "").trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  const anonKey =
    (process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? "").trim();
  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    return sendJson(res, 500, {
      error: "Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY",
    });
  }

  try {
    const bearerToken = getBearerToken(req);
    if (!bearerToken) {
      return sendJson(res, 401, { error: "Unauthorized" });
    }

    const authClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const {
      data: { user },
      error: authError,
    } = await authClient.auth.getUser(bearerToken);
    if (authError || !user?.id) {
      return sendJson(res, 401, { error: "Unauthorized" });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: siteAdmin, error: siteAdminError } = await supabase
      .from("site_admins")
      .select("user_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();
    if (siteAdminError) {
      return sendJson(res, 502, {
        error: siteAdminError.message,
        code: siteAdminError.code,
        details: siteAdminError.details,
        hint: siteAdminError.hint,
      });
    }

    return sendJson(res, 200, {
      is_site_admin: !!siteAdmin?.user_id,
    });
  } catch (err: any) {
    return sendJson(res, 502, {
      error: err?.message ?? "Failed to determine site admin status",
    });
  }
}
