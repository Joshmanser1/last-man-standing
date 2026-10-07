import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { trackFunnelEvent } from "../lib/analytics";

const TELEGRAM_DESTINATION = "https://t.me/FCCCompetitions";

const TELEGRAM_TRACKING_LINKS = {
  "telegram-fcc": {
    utm_source: "fcc",
    utm_medium: "twitter",
    utm_campaign: "telegram_growth",
    utm_content: "own_post",
  },
  "telegram-oocfm": {
    utm_source: "oocfm",
    utm_medium: "twitter",
    utm_campaign: "telegram_growth",
    utm_content: "results_post",
  },
} as const;

export function OutboundRedirect() {
  const { slug = "" } = useParams();

  useEffect(() => {
    const tracking = TELEGRAM_TRACKING_LINKS[slug as keyof typeof TELEGRAM_TRACKING_LINKS];
    if (!tracking) {
      window.location.replace("/");
      return;
    }

    let timer: number | undefined;
    let attempts = 0;
    let cancelled = false;

    const redirect = () => {
      if (!cancelled) window.location.replace(TELEGRAM_DESTINATION);
    };

    const trackThenRedirect = () => {
      if (cancelled) return;

      const tracked = trackFunnelEvent("outbound_telegram_click", {
        link_slug: slug,
        destination: "telegram",
        ...tracking,
      });

      if (tracked) {
        timer = window.setTimeout(redirect, 150);
        return;
      }

      attempts += 1;
      if (attempts >= 20) {
        redirect();
        return;
      }

      timer = window.setTimeout(trackThenRedirect, 25);
    };

    trackThenRedirect();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [slug]);

  return null;
}
