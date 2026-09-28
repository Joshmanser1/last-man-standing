import type { ServiceEmailCandidate } from "./types.js";

const escapeHtml = (value: string) => value.replace(/[&<>'"]/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
}[character] as string));

const cleanOrigin = (origin: string) => origin.replace(/\/+$/, "");
const competitionUrl = (origin: string, leagueId: string) => `${cleanOrigin(origin)}/leaderboard?view=leaderboard&league_id=${encodeURIComponent(leagueId)}`;
const pickUrl = (origin: string, leagueId: string) => `${cleanOrigin(origin)}/make-pick?league_id=${encodeURIComponent(leagueId)}`;
const resultsUrl = (origin: string, leagueId: string) => `${cleanOrigin(origin)}/leaderboard?view=eliminations&league_id=${encodeURIComponent(leagueId)}`;

function formatDeadline(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "full", timeStyle: "short", timeZone: "Europe/London",
  }).format(new Date(value));
}

function shell(input: {
  origin: string; leagueName: string; roundNumber: number; status: string;
  bodyHtml: string; bodyText: string; cta: string; url: string;
}) {
  const { origin, leagueName, roundNumber, status, bodyHtml, bodyText, cta, url } = input;
  const logo = `${cleanOrigin(origin)}/fcc-logo.png`;
  const html = `<!doctype html><html><body style="margin:0;background:#10201c;color:#10201c;font-family:Arial,sans-serif">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#10201c;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#fff;border-radius:18px;overflow:hidden">
<tr><td style="background:#162d27;padding:26px 28px;text-align:center"><img src="${escapeHtml(logo)}" width="64" height="64" alt="Fantasy Command Centre" style="display:block;margin:0 auto 14px"><div style="color:#a7f3d0;font-size:12px;font-weight:700;letter-spacing:1.8px">${escapeHtml(leagueName.toUpperCase())} · ROUND ${roundNumber}</div><h1 style="color:#fff;font-size:32px;line-height:1.1;margin:12px 0 0">${escapeHtml(status)}</h1></td></tr>
<tr><td style="padding:30px 28px;text-align:center;font-size:17px;line-height:1.55">${bodyHtml}<p style="margin:28px 0"><a href="${escapeHtml(url)}" style="display:inline-block;background:#16a36a;color:#fff;text-decoration:none;font-weight:800;letter-spacing:.4px;padding:14px 24px;border-radius:9px">${escapeHtml(cta)}</a></p></td></tr>
<tr><td style="background:#eef5f2;padding:18px 28px;text-align:center;color:#53645e;font-size:12px;line-height:1.5">You're receiving this email because you're taking part in this competition on Fantasy Command Centre.<br><a href="${escapeHtml(cleanOrigin(origin))}" style="color:#167a58">fantasycommandcentre.co.uk</a></td></tr>
</table></td></tr></table></body></html>`;
  const text = `${leagueName} · Round ${roundNumber}\n\n${status}\n\n${bodyText}\n\n${cta}: ${url}\n\nYou're receiving this email because you're taking part in this competition on Fantasy Command Centre.\n${cleanOrigin(origin)}`;
  return { html, text };
}

export function renderServiceEmail(candidate: ServiceEmailCandidate, origin: string) {
  const league = candidate.leagueName;
  const team = candidate.teamName ?? "Your team";
  const remaining = candidate.survivorsRemaining ?? 0;
  if (candidate.eventType === "pick_reminder") {
    const url = pickUrl(origin, candidate.leagueId);
    const deadline = formatDeadline(candidate.deadlineUtc);
    const bodyText = `Your Round ${candidate.roundNumber} pick is still waiting.\n\nMake your selection before ${deadline}.\n\nOne team. One win. Survive.`;
    return {
      subject: `Your ${league} pick is due tomorrow ⚽`,
      ...shell({ origin, leagueName: league, roundNumber: candidate.roundNumber, status: "PICK REQUIRED",
        bodyHtml: `<p>Your Round ${candidate.roundNumber} pick is still waiting.</p><p>Make your selection before <strong>${escapeHtml(deadline)}</strong>.</p><p><strong>One team. One win. Survive.</strong></p>`,
        bodyText, cta: "MAKE MY PICK", url }),
    };
  }
  if (candidate.outcome === "through") {
    const url = competitionUrl(origin, candidate.leagueId);
    const bodyText = `${team.toUpperCase()} WON. YOU SURVIVED.\n\nYou're through Round ${candidate.roundNumber} of ${league}.\n\n${remaining} players remain.\n\nWe'll let you know when it's time to make your next pick.`;
    return { subject: "You're through! 🟢", ...shell({ origin, leagueName: league, roundNumber: candidate.roundNumber,
      status: "THROUGH", bodyHtml: `<p><strong>${escapeHtml(team.toUpperCase())} WON. YOU SURVIVED.</strong></p><p>You're through Round ${candidate.roundNumber} of ${escapeHtml(league)}.</p><p>${remaining} players remain.</p><p>We'll let you know when it's time to make your next pick.</p>`,
      bodyText, cta: "VIEW COMPETITION", url }) };
  }
  const missed = candidate.outcome === "eliminated_no_pick";
  const url = resultsUrl(origin, candidate.leagueId);
  const verb = candidate.outcome === "eliminated_draw" ? "DREW" : "LOST";
  const lead = missed ? "YOU MISSED THE DEADLINE." : `${team.toUpperCase()} ${verb}. YOU'RE OUT.`;
  const explanation = missed
    ? `No pick was submitted for Round ${candidate.roundNumber}, so you've been eliminated from ${league}.`
    : `Your run in ${league} ends in Round ${candidate.roundNumber}.`;
  return { subject: `You're out of ${league}`, ...shell({ origin, leagueName: league, roundNumber: candidate.roundNumber,
    status: "ELIMINATED", bodyHtml: `<p><strong>${escapeHtml(lead)}</strong></p><p>${escapeHtml(explanation)}</p><p>${remaining} players remain.</p>`,
    bodyText: `${lead}\n\n${explanation}\n\n${remaining} players remain.`, cta: "VIEW RESULTS", url }) };
}
