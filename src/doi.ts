export function extractDoiFromHref(href: string): string | null {
  try {
    const decoded = decodeURIComponent(href);
    const match = decoded.match(/10\.\d{4,9}\/[^\s"'>?#)]+/);
    if (!match) return null;
    return match[0].replace(/[\].]+$/, "");
  } catch {
    return null;
  }
}

export function mapPublisherUrlToDoi(href: string): string | null {
  try {
    const url = new URL(href);
    if (url.hostname.includes("nature.com")) {
      const m = url.pathname.match(/\/articles\/([^/?#]+)/);
      if (m && m[1]) return `10.1038/${m[1]}`;
    }
  } catch {
    return null;
  }
  return null;
}

export function extractLancetDoiFromPath(location: Location): string | null {
  if (!location.hostname.endsWith("thelancet.com")) return null;
  // Example path: /journals/lancet/article/PIIS0140-6736(24)01822-1/abstract
  const piiMatch = location.pathname.match(/\/PII([A-Za-z0-9().-]+)/i);
  if (!piiMatch) return null;
  const pii = piiMatch[1];
  // Lancet PII often maps to DOI 10.1016/S...
  const doiStem = pii.startsWith("S") ? pii : pii.replace(/^P?II/, "");
  return `10.1016/${doiStem}`;
}

export function extractDoiFromUrlPath(url: string): string | null {
  const decoded = decodeURIComponent(url);
  const match = decoded.match(/10\.\d{4,9}\/[^\s"'>?#)]+/);
  if (!match) return null;
  const candidate = match[0].replace(/[\].]+$/, "");
  return candidate;
}

export function extractDoiFromDoiOrg(location: Location): string | null {
  if (!location.hostname.endsWith("doi.org")) return null;
  const doi = decodeURIComponent(location.pathname.replace(/^\//, "")).trim();
  return doi || null;
}

export function extractMetaDoi(doc: Document): string | null {
  const meta = doc.querySelector('meta[name="citation_doi"]');
  const doi = meta?.getAttribute("content")?.trim() ?? "";
  return doi || null;
}
