// src/pages/LandingPage.tsx
import { Link } from "react-router-dom";

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-white">
      {/* Hero */}
      <section className="relative overflow-hidden pt-8 md:pt-12">
        <div className="absolute inset-0 bg-[radial-gradient(60%_60%_at_50%_-10%,rgba(16,185,129,0.25),transparent)]" />
        <div className="mx-auto max-w-7xl px-4 py-20 md:py-28">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-emerald-300 text-xs">
              <span>Beta</span>
              <span className="opacity-60">Go-live checklist: final polish</span>
            </div>
            <h1 className="mt-6 text-4xl md:text-6xl font-extrabold tracking-tight leading-tight">
              Last-Man-Standing
              <span className="block text-emerald-400">Host. Join. Win.</span>
            </h1>
            <p className="mt-6 text-lg opacity-80">
              Spin up a private LMS with mates, or enter public pots. Live scoring, smart eliminations,
              and clean admin tools. Free tier to start — upgrade when you’re ready.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/login" className="px-6 py-3 rounded-xl bg-emerald-500 text-slate-900 font-semibold hover:bg-emerald-400 transition">
                Host a private league
              </Link>
              <Link to="/lms" className="px-6 py-3 rounded-xl border border-white/15 hover:border-white/30 transition">
                Explore public games
              </Link>
            </div>
            <p className="mt-4 text-sm opacity-70">No card required on Free. Upgrade anytime.</p>
          </div>
        </div>
      </section>

      {/* Feature cards */}
      <section id="features" className="border-t border-white/10">
        <div className="mx-auto max-w-7xl px-4 py-12 grid gap-6 md:grid-cols-3">
          {[
            { t: "Private & Public", b: "Free tier: 1 hosted + 1 joined private league. Pro/Elite unlock public pots." },
            { t: "Live Scoring", b: "Auto eliminations, fixtures awareness, and live status." },
            { t: "Admin Tools", b: "One-click round setup, tie-breaks, badges, exports." },
          ].map((f) => (
            <div key={f.t} className="rounded-2xl border border-white/10 p-6 bg-white/5">
              <h3 className="font-semibold">{f.t}</h3>
              <p className="mt-2 opacity-80">{f.b}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="border-t border-white/10">
        <div className="mx-auto max-w-7xl px-4 py-16">
          <h2 className="text-3xl md:text-4xl font-bold text-center">Simple, tiered access</h2>
          <p className="mt-3 text-center opacity-75">Start free. Upgrade for public games, bigger pots, and pro features.</p>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            <div className="rounded-3xl border border-white/10 p-6 bg-white/5 flex flex-col">
              <h3 className="text-xl font-semibold">Free</h3>
              <p className="mt-1 opacity-75">Best for casual groups</p>
              <div className="mt-6 text-4xl font-bold">£0</div>
              <ul className="mt-6 space-y-2 text-sm opacity-90">
                <li>• Host 1 private league</li><li>• Join 1 private league</li><li>• No public league access</li>
              </ul>
              <Link to="/login" className="mt-8 px-4 py-3 rounded-xl bg-white text-slate-900 text-center font-medium hover:opacity-90 transition">
                Get started
              </Link>
            </div>

            <div className="rounded-3xl border border-emerald-400/30 p-6 bg-emerald-400/10 flex flex-col relative">
              <div className="absolute -top-3 right-4 text-xs rounded-full px-2 py-1 bg-emerald-500 text-slate-900 font-semibold">Popular</div>
              <h3 className="text-xl font-semibold">Pro</h3>
              <p className="mt-1 opacity-75">Unlock selected public games</p>
              <div className="mt-6 text-4xl font-bold">£x/mo</div>
              <ul className="mt-6 space-y-2 text-sm opacity-90">
                <li>• All Free features</li><li>• Access selected public games</li><li>• Advanced admin & exports</li>
              </ul>
              <Link to="/login?plan=pro" className="mt-8 px-4 py-3 rounded-xl bg-emerald-500 text-slate-900 text-center font-semibold hover:bg-emerald-400 transition">
                Upgrade to Pro
              </Link>
            </div>

            <div className="rounded-3xl border border-white/10 p-6 bg-white/5 flex flex-col">
              <h3 className="text-xl font-semibold">Elite</h3>
              <p className="mt-1 opacity-75">All public pots & exclusives</p>
              <div className="mt-6 text-4xl font-bold">£y/mo</div>
              <ul className="mt-6 space-y-2 text-sm opacity-90">
                <li>• All Pro features</li><li>• All public games (incl. higher pots)</li><li>• Priority support</li>
              </ul>
              <Link to="/login?plan=elite" className="mt-8 px-4 py-3 rounded-xl border border-white/20 text-center hover:border-white/40 transition">
                Go Elite
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="border-t border-white/10">
        <div className="mx-auto max-w-5xl px-4 py-14 grid gap-6 md:grid-cols-2">
          <div className="rounded-2xl border border-white/10 p-6 bg-white/5">
            <h3 className="font-semibold">Is it free to start?</h3>
            <p className="mt-2 opacity-80">Yes. Host one private league and join one private league on the Free tier.</p>
          </div>
          <div className="rounded-2xl border border-white/10 p-6 bg-white/5">
            <h3 className="font-semibold">Do you send marketing emails?</h3>
            <p className="mt-2 opacity-80">Only if you opt in during signup. You can opt out anytime.</p>
          </div>
        </div>
      </section>

      <footer className="border-t border-white/10">
        <div className="mx-auto max-w-7xl px-4 py-10 text-sm flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="opacity-70">© {new Date().getFullYear()} Fantasy Command Centre</p>
          <div className="flex items-center gap-6">
            <Link to="/terms" className="opacity-80 hover:opacity-100">Terms</Link>
            <Link to="/privacy" className="opacity-80 hover:opacity-100">Privacy</Link>
            <Link to="/contact" className="opacity-80 hover:opacity-100">Contact</Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
