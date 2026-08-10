const ATTRIBUTE = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;

function decodeHtmlAttribute(value: string) {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

/** Finds declared page icons without assuming a provider-specific path. */
export function pageIconUrls(html: string, pageUrl: string) {
  const page = new URL(pageUrl);
  const urls: string[] = [];
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const attributes = new Map<string, string>();
    for (const attribute of match[0].matchAll(ATTRIBUTE)) {
      attributes.set(
        attribute[1]!.toLowerCase(),
        decodeHtmlAttribute(attribute[2] ?? attribute[3] ?? attribute[4] ?? ""),
      );
    }
    const rel = (attributes.get("rel") ?? "").toLowerCase().split(/\s+/);
    const href = attributes.get("href");
    if (!href || !rel.some((value) => value === "icon" || value === "apple-touch-icon")) continue;
    try {
      const url = new URL(href, page);
      if (url.protocol !== "https:" || !(url.hostname === page.hostname || url.hostname.endsWith(`.${page.hostname}`))) continue;
      if (!urls.includes(url.toString())) urls.push(url.toString());
    } catch {}
  }
  return urls;
}

/** Page-declared assets may require the document URL as their hotlink referer. */
export function pageIconRequests(html: string, pageUrl: string) {
  return pageIconUrls(html, pageUrl).map(url => ({ url, referer: pageUrl }));
}

export function faviconCacheIsFresh(row: { fetchedAt: string | Date; error?: string | null }, now = Date.now()) {
  const age = now - new Date(row.fetchedAt).getTime();
  const lifetime = row.error ? 15 * 60 * 1000 : 24 * 60 * 60 * 1000;
  return Number.isFinite(age) && age >= 0 && age < lifetime;
}
