import { MarketingOptIn } from "../components/MarketingOptIn";

export function EmailPreferences() {
  return (
    <div className="mx-auto max-w-xl rounded-3xl border border-slate-200 bg-white p-5 text-slate-900 shadow-sm sm:p-8">
      <h1 className="text-2xl font-bold">Email Preferences</h1>
      <h2 className="mt-5 text-base font-semibold">Competition &amp; marketing emails</h2>
      <p className="mb-5 mt-2 text-sm leading-6 text-slate-600">
        Optional emails sent by FCC about new FCC competitions, creator leagues and prize competitions.
        This does not give creators your email address or permission to contact you directly.
      </p>
      <MarketingOptIn preferences />
      <p className="mt-6 border-t border-slate-200 pt-4 text-xs leading-5 text-slate-500">
        This preference does not change essential account or competition service messages, including your login codes.
        Turning marketing off takes effect as soon as you save.
      </p>
    </div>
  );
}
