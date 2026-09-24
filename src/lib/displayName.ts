// Historical placeholders are not player identities. Preserve all other names.
const RESERVED = new Set(["you", "manager", "player", "user", "name", "no name", "unknown"]);

export function validDisplayName(value: unknown): string | null {
  const name = typeof value === "string" ? value.trim() : "";
  return name && !RESERVED.has(name.toLowerCase()) ? name : null;
}

export function displayNameOrFallback(value: unknown): string {
  return validDisplayName(value) ?? "Unknown";
}
