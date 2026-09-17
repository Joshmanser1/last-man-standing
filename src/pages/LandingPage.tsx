// src/pages/LandingPage.tsx
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supa } from "../lib/supabaseClient";

export default function LandingPage() {
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    supa.auth.getSession().then(({ data }) => setAuthed(!!data.session?.user?.id));
    const { data: sub } = supa.auth.onAuthStateChange((_event, session) =>
      setAuthed(!!session?.user?.id)
    );
    return () => sub.subscription.unsubscribe();
  }, []);

  // Hosting requires authentication; joining continues through the established code-entry hub.
  const hostHref = authed ? "/private" : "/login";
  const joinHref = "/private";

  return (
    <main className="fcc-landing-shell min-h-screen text-white">
      <section className="fcc-landing-hero relative overflow-hidden pt-8 md:pt-12">
        <div className="mx-auto max-w-6xl px-4 py-20 md:py-28">
          <div className="max-w-3xl">
            <p className="text-xs font-extrabold uppercase tracking-[0.24em] text-emerald-300/85">
              Last-Man-Standing
            </p>
            <h1 className="mt-3 text-4xl font-extrabold leading-tight tracking-tight md:text-6xl">
              Host. Join. <span className="text-emerald-400">Survive.</span>
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-emerald-50/80">
              One team. Every round. Win and survive. Draw or lose and you&apos;re out.
              Use a team once, and they&apos;re gone for good.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to={hostHref} className="btn btn-primary px-6 py-3">
                Host a league
              </Link>
              <Link
                to={joinHref}
                className="btn btn-ghost border-emerald-300/35 px-6 py-3 text-emerald-100 hover:border-emerald-200 hover:bg-emerald-400/10"
              >
                Join a league
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="border-t border-white/10">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 py-12 md:grid-cols-3">
          {[
            { t: "Run your competition", b: "Create a Last-Man-Standing league for your mates, community or audience." },
            { t: "Make one pick", b: "Choose one team each round. Win and you move on; draw or lose and you're out." },
            { t: "Let FCC run matchday", b: "Fixtures, eliminations and round progression stay clear for every player." },
          ].map((feature) => (
            <div key={feature.t} className="fcc-landing-panel rounded-2xl border border-white/10 p-6">
              <h2 className="font-semibold">{feature.t}</h2>
              <p className="mt-2 opacity-80">{feature.b}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-white/10">
        <div className="mx-auto grid max-w-5xl gap-6 px-4 py-14 md:grid-cols-2">
          <div className="fcc-landing-panel rounded-2xl border border-white/10 p-6">
            <h2 className="font-semibold">How does Last-Man-Standing work?</h2>
            <p className="mt-2 opacity-80">Pick a team to win each round. They win, you survive. They draw or lose, you&apos;re eliminated.</p>
          </div>
          <div className="fcc-landing-panel rounded-2xl border border-white/10 p-6">
            <h2 className="font-semibold">What makes it tricky?</h2>
            <p className="mt-2 opacity-80">Every team can only be used once. Keep surviving without running out of good options.</p>
          </div>
        </div>
      </section>

      <footer className="border-t border-white/10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-10 text-sm md:flex-row">
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
