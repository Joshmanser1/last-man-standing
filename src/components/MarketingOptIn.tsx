import { useEffect, useId, useState } from "react";
import { Link } from "react-router-dom";
import { MARKETING_CONSENT_WORDING, type MarketingPreference } from "../lib/marketingConsent";
import { getMarketingPreference, marketingConsentDisabled, setMarketingPreference } from "../lib/marketingPreferencesClient";

export function MarketingOptIn({ preferences = false }: { preferences?: boolean }) {
  if (marketingConsentDisabled()) return preferences
    ? <p className="text-sm text-slate-600">Email preferences are disabled in demo and test mode.</p> : null;
  return <ConsentForm preferences={preferences} />;
}

function ConsentForm({ preferences }: { preferences: boolean }) {
  const id = useId();
  const [state, setState] = useState<MarketingPreference | null>(null);
  const [checked, setChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void getMarketingPreference().then(value => {
      if (!active) return;
      setState(value);
      setChecked(preferences && value.eligible);
    }).catch(err => { if (active) setError(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [attempt, preferences]);

  const manage = <Link to="/email-preferences" className="font-semibold text-emerald-700 underline">Manage</Link>;
  const showForm = state && (preferences || !state.has_preference);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!state || saving || (!preferences && !checked)) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const value = await setMarketingPreference(checked, preferences ? "email_preferences" : "pick_confirmation");
      setState(value);
      setChecked(value.eligible);
      setMessage(value.eligible ? "Competition emails are on." : "Competition emails are off.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save email preferences. Please try again.");
    } finally { setSaving(false); }
  }
  return (
    <section aria-label="Competition email preferences" className="text-left text-sm text-slate-700">
      {loading && <p role="status">Loading email preferences…</p>}
      {!loading && state && !showForm && (
        <p>Competition emails: {state.eligible ? "On" : "Off"} · {manage}
          {state.marketing_opt_in && state.email_changed && <span className="mt-1 block text-xs">Your account email changed. Review your preference before receiving marketing at the new address.</span>}
        </p>
      )}
      {!loading && showForm && (
        <form onSubmit={save} className="space-y-3">
          {preferences && <p>Competition emails: <strong>{state.eligible ? "On" : "Off"}</strong></p>}
          {preferences && state.marketing_opt_in && state.email_changed && <p className="text-xs">Your account email changed. Tick below and save to subscribe your current verified address.</p>}
          <div className="flex items-start gap-2">
            <input id={id} type="checkbox" checked={checked} disabled={saving}
              onChange={event => { setChecked(event.target.checked); setMessage(""); }}
              className="mt-1 h-4 w-4 shrink-0 accent-emerald-600" />
            <label htmlFor={id} className="leading-5">{MARKETING_CONSENT_WORDING}</label>
          </div>
          <button type="submit" disabled={saving || (!preferences && !checked)} className="btn btn-ghost border-emerald-700/25 text-emerald-800">
            {saving ? "Saving…" : preferences ? "Save email preference" : "Subscribe"}
          </button>
          {!preferences && <p className="text-xs text-slate-500">Optional. Sent by FCC. Unsubscribe in Email Preferences at any time.</p>}
        </form>
      )}
      {message && <p role="status" className="mt-2 text-xs text-emerald-800">{message}</p>}
      {error && <div className="mt-2 text-xs" role="alert">
        <p>{error}</p>
        {!state && <button type="button" className="mt-1 underline" onClick={() => setAttempt(value => value + 1)}>Retry email preferences</button>}
      </div>}
    </section>
  );
}
