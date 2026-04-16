export function processCommand(command: string): {
  action: string;
  url?: string;
  isBrowserAction: boolean;
} {

  const lowerCmd = command.toLowerCase().trim();

  // -------- Helper function to clean website name --------
  function cleanSite(site: string) {

    site = site
      .replace(/https?:\/\//g, "")
      .replace(/www\./g, "")
      .replace(/website|site|official|page/g, "")
      .trim();

    site = site.replace(/\s+/g, "");

    if (!site.includes(".")) {
      site = site + ".com";
    }

    return site;
  }

  // -------- OPEN WEBSITE --------
  const openMatch = lowerCmd.match(/(open|go to|visit|khol|kholna|kholo|khol do)\s+(.+)/);

  if (openMatch) {

    let site = cleanSite(openMatch[2]);

    return {
      action: `Opening ${site}`,
      url: `https://${site}`,
      isBrowserAction: true,
    };
  }

  // -------- YOUTUBE SEARCH --------
  const ytSearchMatch = lowerCmd.match(/search (.+) on youtube/);

  if (ytSearchMatch) {

    const query = encodeURIComponent(ytSearchMatch[1]);

    return {
      action: `Searching ${ytSearchMatch[1]} on YouTube`,
      url: `https://www.youtube.com/results?search_query=${query}`,
      isBrowserAction: true,
    };
  }

  // -------- PLAY ON YOUTUBE --------
  const ytPlayMatch = lowerCmd.match(/play (.+) on youtube/);

  if (ytPlayMatch) {

    const query = encodeURIComponent(ytPlayMatch[1]);

    return {
      action: `Playing ${ytPlayMatch[1]} on YouTube`,
      url: `https://www.youtube.com/results?search_query=${query}`,
      isBrowserAction: true,
    };
  }

  // -------- GOOGLE SEARCH --------
  const googleSearchMatch = lowerCmd.match(/search (.+)/);

  if (googleSearchMatch) {

    const query = encodeURIComponent(googleSearchMatch[1]);

    return {
      action: `Searching ${googleSearchMatch[1]} on Google`,
      url: `https://www.google.com/search?q=${query}`,
      isBrowserAction: true,
    };
  }

  // -------- OPEN YOUTUBE DIRECTLY --------
  if (
    lowerCmd.includes("open youtube") ||
    lowerCmd.includes("youtube khol") ||
    lowerCmd.includes("youtube kholna")
  ) {
    return {
      action: "Opening YouTube",
      url: "https://www.youtube.com",
      isBrowserAction: true,
    };
  }

  // -------- OPEN INSTAGRAM --------
  if (
    lowerCmd.includes("open instagram") ||
    lowerCmd.includes("instagram khol")
  ) {
    return {
      action: "Opening Instagram",
      url: "https://www.instagram.com",
      isBrowserAction: true,
    };
  }

  // -------- OPEN NETFLIX --------
  if (
    lowerCmd.includes("open netflix") ||
    lowerCmd.includes("netflix khol")
  ) {
    return {
      action: "Opening Netflix",
      url: "https://www.netflix.com",
      isBrowserAction: true,
    };
  }

  // -------- FALLBACK --------
  return {
    action: "",
    isBrowserAction: false,
  };
}
