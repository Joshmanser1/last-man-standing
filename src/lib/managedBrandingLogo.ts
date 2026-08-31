import { supa } from "./supabaseClient";

const MANAGED_BRANDING_BUCKET = "managed-branding";
const MANAGED_BRANDING_PREFIX = "managed-league-branding";
const MAX_MANAGED_BRANDING_LOGO_BYTES = 5 * 1024 * 1024;

const MIME_TYPE_TO_EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const EXTENSION_TO_MIME_TYPE: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

function getExtensionFromFile(file: File) {
  const mimeExtension = MIME_TYPE_TO_EXTENSION[file.type];
  if (mimeExtension) {
    return {
      extension: mimeExtension,
      mimeType: file.type,
    };
  }

  const nameParts = file.name.toLowerCase().split(".");
  const rawExtension = nameParts.length > 1 ? nameParts[nameParts.length - 1] : "";
  const mimeType = EXTENSION_TO_MIME_TYPE[rawExtension];
  if (!mimeType) return null;

  return {
    extension: rawExtension === "jpeg" ? "jpg" : rawExtension,
    mimeType,
  };
}

export function validateManagedBrandingLogoFile(file: File) {
  const normalizedType = getExtensionFromFile(file);
  if (!normalizedType) {
    return {
      ok: false as const,
      error: "Logo must be a PNG, JPG, or WebP image.",
    };
  }

  if (file.size > MAX_MANAGED_BRANDING_LOGO_BYTES) {
    return {
      ok: false as const,
      error: "Logo must be 5 MB or smaller.",
    };
  }

  return {
    ok: true as const,
    extension: normalizedType.extension,
    mimeType: normalizedType.mimeType,
  };
}

export async function uploadManagedBrandingLogo(file: File, leagueId: string) {
  const validation = validateManagedBrandingLogoFile(file);
  if (!validation.ok) {
    throw new Error(validation.error);
  }

  const objectPath = [
    MANAGED_BRANDING_PREFIX,
    leagueId,
    `logo-${crypto.randomUUID()}.${validation.extension}`,
  ].join("/");

  const { error } = await supa.storage.from(MANAGED_BRANDING_BUCKET).upload(objectPath, file, {
    cacheControl: "31536000",
    contentType: validation.mimeType,
    upsert: false,
  });

  if (error) {
    throw new Error(error.message || "Failed to upload logo.");
  }

  const { data } = supa.storage.from(MANAGED_BRANDING_BUCKET).getPublicUrl(objectPath);
  return {
    objectPath,
    publicUrl: data.publicUrl,
  };
}

export function extractManagedBrandingLogoPath(url: string) {
  const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL ?? "").trim();
  if (!supabaseUrl) return null;

  try {
    const assetUrl = new URL(url);
    const baseUrl = new URL(supabaseUrl);
    const expectedPrefix = `/storage/v1/object/public/${MANAGED_BRANDING_BUCKET}/`;

    if (assetUrl.origin !== baseUrl.origin) return null;
    if (!assetUrl.pathname.startsWith(expectedPrefix)) return null;

    return decodeURIComponent(assetUrl.pathname.slice(expectedPrefix.length));
  } catch {
    return null;
  }
}

export function isManagedBrandingLogoUrl(url: string) {
  return !!extractManagedBrandingLogoPath(url);
}

export async function deleteManagedBrandingLogo(url: string) {
  const objectPath = extractManagedBrandingLogoPath(url);
  if (!objectPath) return false;

  const { error } = await supa.storage.from(MANAGED_BRANDING_BUCKET).remove([objectPath]);
  if (error) {
    throw new Error(error.message || "Failed to delete logo.");
  }

  return true;
}

export function getManagedBrandingLogoFilename(url: string) {
  const objectPath = extractManagedBrandingLogoPath(url);
  if (!objectPath) return "";

  const parts = objectPath.split("/");
  return parts[parts.length - 1] ?? "";
}

export { MANAGED_BRANDING_BUCKET, MANAGED_BRANDING_PREFIX, MAX_MANAGED_BRANDING_LOGO_BYTES };
