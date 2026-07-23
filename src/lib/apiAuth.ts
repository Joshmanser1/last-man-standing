import { supa } from "./supabaseClient";

export async function getApiHeaders(extra?: Record<string, string>) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(extra ?? {}),
  };
  const { data } = await supa.auth.getSession();
  const token = data.session?.access_token;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export async function postJsonWithAuth(url: string, body: unknown) {
  return fetch(url, {
    method: "POST",
    headers: await getApiHeaders(),
    body: JSON.stringify(body),
  });
}
