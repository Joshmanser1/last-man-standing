import { useState } from "react";

export function PickConfirmationActions({ joinCode }: { joinCode?: string | null }) {
  const [message, setMessage] = useState("");
  const [showLink, setShowLink] = useState(false);
  const [sharing, setSharing] = useState(false);
  const code = joinCode?.trim();
  const inviteUrl = code ? new URL("/private/join", window.location.origin) : null;
  if (inviteUrl && code) inviteUrl.searchParams.set("code", code);
  const url = inviteUrl?.toString();

  async function copyLink() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setMessage("League invitation link copied.");
      setShowLink(false);
    } catch {
      setShowLink(true);
      setMessage("Copy the league invitation link below.");
    }
  }

  async function shareLeague() {
    if (!url || sharing) return;
    setSharing(true);
    setMessage("");
    try {
      if (navigator.share) {
        try {
          await navigator.share({
            title: "Join my Last Man Standing league",
            text: "Think your mates can beat you? Get them involved.",
            url,
          });
          return;
        } catch (error) {
          // Cancelling the share sheet should not copy anything unexpectedly.
          if (error instanceof Error && error.name === "AbortError") return;
        }
      }
      await copyLink();
    } finally {
      setSharing(false);
    }
  }

  return (
    <div className="mt-6 space-y-5 border-t border-emerald-200/20 pt-5">
      <div>
        <button
          type="button"
          className="btn btn-primary w-full py-3"
          disabled={!url || sharing}
          onClick={() => void shareLeague()}
        >
          SHARE THIS LEAGUE
        </button>
        <p className="mt-2 text-sm text-emerald-50/75">Think your mates can beat you? Get them involved.</p>
        {url ? (
          <button type="button" className="btn btn-ghost mt-1 text-xs" onClick={() => void copyLink()}>
            Copy league link
          </button>
        ) : (
          <p className="mt-2 text-sm text-emerald-50/75">This league has no invitation link available.</p>
        )}
        <p role="status" className="mt-1 text-sm text-emerald-100">{message}</p>
        {showLink && url && (
          <input
            aria-label="League invitation link"
            className="mt-2 w-full min-w-0 rounded-lg border border-emerald-200/30 bg-black/20 p-3 text-sm text-white"
            readOnly
            value={url}
            onFocus={(event) => event.currentTarget.select()}
          />
        )}
      </div>
      <div>
        <a
          className="btn btn-ghost w-full py-3"
          href="https://lms.fantasycommandcentre.co.uk/t/telegram-fcc"
          target="_blank"
          rel="noopener noreferrer"
        >
          JOIN FCC TELEGRAM
        </a>
        <p className="mt-2 text-sm text-emerald-50/75">Get results, league updates and new competitions.</p>
      </div>
    </div>
  );
}
