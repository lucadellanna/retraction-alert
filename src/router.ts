import { handleScholarProfile } from "./handlers/scholar";
import { handleOrcidProfile } from "./handlers/orcid";
import { handleArticlePage } from "./handlers/article";
import { handleNewsPage } from "./news";
import { setWrapperVisibility } from "./ui/banners";
import { logDebug } from "./log";

export type HandlerContext = {
  article: HTMLDivElement;
  citations: HTMLDivElement;
  location: Location;
};

function extractOrcidId(loc: Location): string | null {
  if (!loc.hostname.endsWith("orcid.org")) return null;
  const match = loc.pathname.match(
    /\/(\d{4}-\d{4}-\d{4}-[\dX]{3}[\dX]?)/i
  );
  return match ? match[1] : null;
}

export async function routePage(ctx: HandlerContext): Promise<boolean> {
  logDebug("Routing page", { host: ctx.location.hostname, href: ctx.location.href });
  // Scholar profile (passive banner only)
  const scholarHandled = await handleScholarProfile(
    ctx.article,
    ctx.citations,
    ctx.location
  );
  if (scholarHandled) return true;

  // News pages (link scanning)
  const newsHandled = await handleNewsPage(
    ctx.location.hostname,
    ctx.article,
    ctx.citations
  );
  if (newsHandled) return true;

  // ORCID profiles
  const orcidId = extractOrcidId(ctx.location);
  if (ctx.location.hostname.endsWith("orcid.org") && !orcidId) {
    setWrapperVisibility(false);
    logDebug("Non-profile ORCID page; skipping banners.");
    return true;
  }
  if (orcidId) {
    const orcidHandled = await handleOrcidProfile(
      ctx.article,
      ctx.citations,
      orcidId
    );
    if (orcidHandled) return true;
  }

  // Article/PMID pages
  const articleHandled = await handleArticlePage(
    ctx.article,
    ctx.citations,
    ctx.location
  );
  if (articleHandled) return true;

  return false;
}
