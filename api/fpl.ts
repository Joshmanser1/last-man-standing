// /api/fpl.ts

const FPL_BASE = "https://fantasy.premierleague.com/api";

function isAllowedPath(path: string) {
  return (
    path === "/bootstrap-static/" ||
    path.startsWith("/fixtures/")
  );
}

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ error: "Method not allowed" });
    }

    const path = String(req.query.path || "");

    if (!path.startsWith("/")) {
      return res.status(400).json({ error: "Invalid path" });
    }

    if (!isAllowedPath(path)) {
      return res.status(403).json({ error: "Path not allowed" });
    }

    const url = `${FPL_BASE}${path}`;

    const upstream = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome Safari",
        Accept: "application/json,text/plain,*/*",
        Referer: "https://fantasy.premierleague.com/",
        Origin: "https://fantasy.premierleague.com",
      },
    });

    const text = await upstream.text();

    res.status(upstream.status);
    res.setHeader(
      "Content-Type",
      upstream.headers.get("content-type") || "application/json"
    );
    res.setHeader("Cache-Control", "no-store");

    return res.send(text);
  } catch (err: any) {
    return res
      .status(500)
      .json({ error: "Proxy failed", detail: String(err?.message || err) });
  }
}
