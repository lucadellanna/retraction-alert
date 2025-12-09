import { setWrapperVisibility, updateBanner } from "../ui/banners";
import { COLORS } from "../ui/colors";
import { logDebug } from "../log";

function isScholarProfile(loc: Location): boolean {
  const isScholarHost = loc.hostname.includes("scholar.google.");
  const isProfilePath = loc.pathname.includes("/citations");
  if (!isScholarHost || !isProfilePath) return false;

  const params = new URLSearchParams(loc.search);
  return params.has("user");
}

function getScholarName(): string | null {
  const nameEl = document.querySelector("#gsc_prf_in");
  const text = nameEl?.textContent?.trim();
  return text || null;
}

function findOrcidUrl(loc: Location): string | null {
  const anchors = Array.from(
    document.querySelectorAll('a[href*="orcid.org"]')
  ) as HTMLAnchorElement[];

  for (const anchor of anchors) {
    const href = anchor.getAttribute("href") || anchor.href;
    if (!href) continue;
    try {
      const url = new URL(href, loc.href);
      const match = url.pathname.match(
        /(\d{4}-\d{4}-\d{4}-[\dX]{3}[\dX]?)/
      );
      if (match?.[1]) {
        return `https://orcid.org/${match[1]}`;
      }
    } catch {
      // ignore invalid URLs
    }
  }

  return null;
}

export async function handleScholarProfile(
  articleBanner: HTMLDivElement,
  citationsBanner: HTMLDivElement,
  loc: Location
): Promise<boolean> {
  if (!isScholarProfile(loc)) return false;

  const orcidUrl = findOrcidUrl(loc);
  if (orcidUrl) {
    setWrapperVisibility(true);
    citationsBanner.style.display = "flex";
    updateBanner(articleBanner, {
      bg: COLORS.ok,
      lines: ["View this author on ORCID to run retraction checks."],
      actions: [
        {
          href: orcidUrl,
          label: "View on ORCID",
          title: "Open ORCID profile to run retraction checks",
        },
      ],
    });
    updateBanner(citationsBanner, {
      bg: COLORS.ok,
      lines: ["Checks run on the ORCID profile."],
    });
  } else {
    const name = getScholarName();
    if (!name) {
      setWrapperVisibility(false);
      return true;
    }

    const searchUrl = `https://orcid.org/orcid-search/search?searchQuery=${encodeURIComponent(
      name
    )}`;
    setWrapperVisibility(true);
    citationsBanner.style.display = "none";
    updateBanner(articleBanner, {
      bg: COLORS.warning,
      lines: ["Find this author on ORCID to run retraction checks."],
      actions: [
        {
          href: searchUrl,
          label: "Search on ORCID",
          title: "Open ORCID search for this author",
        },
      ],
    });
  }

  logDebug("Google Scholar profile handled", { hasOrcid: Boolean(orcidUrl) });
  return true;
}
