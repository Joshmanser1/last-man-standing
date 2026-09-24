export const MARKETING_CONSENT_VERSION = "fcc_marketing_v1";
export const MARKETING_CONSENT_WORDING = "Email me about new FCC competitions, creator leagues and prize competitions.";
export const MARKETING_CAPTURE_SOURCES = ["pick_confirmation", "email_preferences"] as const;
export type MarketingCaptureSource = typeof MARKETING_CAPTURE_SOURCES[number];

export interface MarketingPreferenceRow {
  user_id: string;
  marketing_opt_in: boolean;
  consented_email: string | null;
  updated_at: string;
  latest_event_id: string;
}

export interface MarketingPreference {
  has_preference: boolean;
  marketing_opt_in: boolean;
  eligible: boolean;
  email_changed: boolean;
  updated_at: string | null;
}

export function marketingPreferenceState(
  row: MarketingPreferenceRow | null,
  verifiedEmail: string | null,
): MarketingPreference {
  const emailChanged = !!row?.consented_email && row.consented_email !== verifiedEmail;
  return {
    has_preference: !!row,
    marketing_opt_in: row?.marketing_opt_in === true,
    eligible: !!verifiedEmail && row?.marketing_opt_in === true && row.consented_email === verifiedEmail,
    email_changed: emailChanged,
    updated_at: row?.updated_at ?? null,
  };
}
