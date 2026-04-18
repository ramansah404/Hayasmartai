// ─────────────────────────────────────────────────────────────────────────────
// commandService.ts
// ─────────────────────────────────────────────────────────────────────────────

export interface CommandResult {
  action: string;
  url?: string;
  playYoutube?: string;   // query to pass to playYoutubeVideo()
  isBrowserAction: boolean;
  type: "PLAY_YOUTUBE" | "OPEN_URL" | "SCROLL_DOWN" | "SCROLL_UP" | "GO_BACK" | "REFRESH" | "NONE";
}

// ─── YouTube Video Player ─────────────────────────────────────────────────────

export async function playYoutubeVideo(query: string): Promise<void> {
  try {
    const apiKey = import.meta.env.VITE_YOUTUBE_API_KEY;

    const searchUrl =
      `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=1&q=${encodeURIComponent(query)}&key=${apiKey}`;

    const res = await fetch(searchUrl);
    const data = await res.json();

    const videoId = data?.items?.[0]?.id?.videoId;

    if (videoId) {
      window.open(`https://www.youtube.com/watch?v=${videoId}&autoplay=1`, "_blank");
    } else {
      console.warn("No YouTube video found for query:", query);
    }
  } catch (err) {
    console.error("YouTube Play Error:", err);
  }
}

// ─── Command Parser ────────────────────────────────────────────────────────────

export function processCommand(command: string): CommandResult {

  const cmd = command.toLowerCase().trim();

  // ── Helper: clean a website string into a usable domain ──────────────────
  const cleanSite = (site: string): string => {
    site = site
      .replace(/https?:\/\//g, "")
      .replace(/www\./g, "")
      .replace(/website|site|official/g, "")
      .trim()
      .replace(/\s+/g, "");

    if (!site.includes(".")) site += ".com";
    return site;
  };

  // ── Quick-access site map ─────────────────────────────────────────────────
  const quickSites: Record<string, string> = {
    youtube:   "https://youtube.com",
    google:    "https://google.com",
    instagram: "https://instagram.com",
    netflix:   "https://netflix.com",
    spotify:   "https://spotify.com",
    twitter:   "https://twitter.com",
    github:    "https://github.com",
  };

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 1️⃣  PLAY YOUTUBE  (highest priority — must run before any SEARCH check)
  // Matches: "play believer", "play alan walker faded", "play xyz on youtube"
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const playMatch = cmd.match(/^play\s+(.+)/);

  if (playMatch) {
    const query = playMatch[1]
      .replace(/\s+on\s+youtube\s*$/i, "")
      .trim();

    return {
      type:          "PLAY_YOUTUBE",
      playYoutube:   query,
      action:        `Playing "${query}" on YouTube`,
      isBrowserAction: false,
    };
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 2️⃣  OPEN WEBSITE (quick sites)
  // Matches: "open youtube", "netflix kholo", etc.
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  for (const site in quickSites) {
    if (
      cmd.includes(`open ${site}`) ||
      cmd.includes(`${site} kholo`)  ||
      cmd.includes(`${site} khol`)
    ) {
      return {
        type:            "OPEN_URL",
        url:             quickSites[site],
        action:          `Opening ${site}`,
        isBrowserAction: true,
      };
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 3️⃣  OPEN WEBSITE (generic)
  // Matches: "open amazon", "go to reddit", "visit bbc.co.uk"
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const openMatch = cmd.match(/^(open|visit|go to|khol|kholo)\s+(.+)/);

  if (openMatch) {
    const site = cleanSite(openMatch[2]);
    return {
      type:            "OPEN_URL",
      url:             `https://${site}`,
      action:          `Opening ${site}`,
      isBrowserAction: true,
    };
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 4️⃣  YOUTUBE SEARCH
  // Matches: "search mr beast on youtube"
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const ytSearchMatch = cmd.match(/^search\s+(.+?)\s+on\s+youtube\s*$/);

  if (ytSearchMatch) {
    const query = ytSearchMatch[1];
    return {
      type:            "OPEN_URL",
      url:             `https://youtube.com/results?search_query=${encodeURIComponent(query)}`,
      action:          `Searching "${query}" on YouTube`,
      isBrowserAction: true,
    };
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 5️⃣  GOOGLE SEARCH
  // Matches: "search ai news"
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const googleSearchMatch = cmd.match(/^search\s+(.+)/);

  if (googleSearchMatch) {
    const query = googleSearchMatch[1];
    return {
      type:            "OPEN_URL",
      url:             `https://google.com/search?q=${encodeURIComponent(query)}`,
      action:          `Searching "${query}" on Google`,
      isBrowserAction: true,
    };
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 6️⃣  BROWSER CONTROLS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (cmd.includes("scroll down")) {
    return { type: "SCROLL_DOWN", action: "Scrolling down", isBrowserAction: false };
  }

  if (cmd.includes("scroll up")) {
    return { type: "SCROLL_UP", action: "Scrolling up", isBrowserAction: false };
  }

  if (cmd.includes("go back")) {
    return { type: "GO_BACK", action: "Going back", isBrowserAction: false };
  }

  if (cmd.includes("refresh")) {
    return { type: "REFRESH", action: "Refreshing page", isBrowserAction: false };
  }

  // ── No command matched ────────────────────────────────────────────────────
  return { type: "NONE", action: "", isBrowserAction: false };
}