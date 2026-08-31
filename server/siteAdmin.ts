import { createClient } from "@supabase/supabase-js";

type Req = {
  headers?: Record<string, string | string[] | undefined>;
};

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

function getSupabaseEnv() {
  const supabaseUrl = (process.env.SUPABASE_URL ?? "").trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  const anonKey =
    (process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? "").trim();

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  return { supabaseUrl, serviceRoleKey, anonKey };
}

export function createServiceRoleClient() {
  const { supabaseUrl, serviceRoleKey } = getSupabaseEnv();
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function getAuthenticatedUserId(req: Req) {
  const { supabaseUrl, anonKey } = getSupabaseEnv();
  if (!anonKey) return null;

  const bearerToken = getBearerToken(req);
  if (!bearerToken) return null;

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const {
    data: { user },
    error,
  } = await authClient.auth.getUser(bearerToken);

  if (error || !user?.id) return null;
  return user.id;
}

export async function isSiteAdminUser(
  supabase: ReturnType<typeof createServiceRoleClient>,
  userId: string
) {
  const { data, error } = await supabase
    .from("site_admins")
    .select("user_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return !!data?.user_id;
}
