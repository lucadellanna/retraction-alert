type ArticleStatus =
  | "ok"
  | "retracted"
  | "expression_of_concern"
  | "withdrawn"
  | "unknown";

interface StatusResult {
  status: ArticleStatus;
  label?: string;
  noticeUrl?: string;
}

const ALERT_STATUSES: Set<ArticleStatus> = new Set([
  "retracted",
  "withdrawn",
  "expression_of_concern",
]);

const MAX_REFERENCE_CONCURRENCY = 4;
const MAX_REFERENCED_DOIS = 10000;
const SUPPORT_URL = "https://Luca-Dellanna.com/contact";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function logDebug(...args: unknown[]): void {
  // Prefix to make filtering easy in DevTools.
  console.debug("[RetractionAlert]", ...args);
}

function mapStatusFromLabel(label: string): ArticleStatus {
  const normalized = label.toLowerCase();
  if (normalized.includes("retract")) return "retracted";
  if (normalized.includes("withdraw")) return "withdrawn";
  if (normalized.includes("expression of concern"))
    return "expression_of_concern";
  return "ok";
}

function findAlertInTexts(
  texts: string[]
): { status: ArticleStatus; match: string } | null {
  for (const text of texts) {
    if (!text) continue;
    const status = mapStatusFromLabel(text);
    if (status !== "ok") return { status, match: text };
  }
  return null;
}

type CacheEntry<T> = { value: T; ts: number };
const memoryCache = new Map<string, CacheEntry<unknown>>();

function isFresh(entry: CacheEntry<unknown> | undefined): boolean {
  if (!entry) return false;
  return Date.now() - entry.ts < CACHE_TTL_MS;
}

async function getCache<T>(key: string): Promise<T | null> {
  try {
    if (chrome?.storage?.local) {
      const result = await chrome.storage.local.get([key]);
      const entry = result[key] as CacheEntry<T> | undefined;
      if (entry && isFresh(entry)) return entry.value;
    } else if (memoryCache.has(key)) {
      const entry = memoryCache.get(key) as CacheEntry<T> | undefined;
      if (isFresh(entry)) return entry?.value ?? null;
    }
  } catch (error) {
    logDebug("cache get error", error);
  }
  return null;
}

async function setCache<T>(key: string, value: T): Promise<void> {
  const entry: CacheEntry<T> = { value, ts: Date.now() };
  try {
    if (chrome?.storage?.local) {
      await chrome.storage.local.set({ [key]: entry });
    } else {
      memoryCache.set(key, entry);
    }
  } catch (error) {
    logDebug("cache set error", error);
  }
}

async function getCachedStatus(doi: string): Promise<StatusResult | null> {
  return getCache<StatusResult>(`doi:${doi}`);
}

async function setCachedStatus(
  doi: string,
  status: StatusResult
): Promise<void> {
  await setCache<StatusResult>(`doi:${doi}`, status);
}

function detectAlertFromMessage(message: any): StatusResult {
  const assertions: unknown = message?.assertion ?? [];
  const updates: unknown = message?.["update-to"] ?? [];
  const relations: unknown = message?.relation ?? [];

  const assertionList = Array.isArray(assertions) ? assertions : [];
  const updateList = Array.isArray(updates) ? updates : [];
  const relationList = Array.isArray(relations) ? relations : [];

  logDebug("parsed Crossref payload", {
    assertionCount: assertionList.length,
    updateCount: updateList.length,
    relationCount: relationList.length,
  });

  // 1) Assertions
  for (const item of assertionList) {
    if (!item || typeof item !== "object") continue;
    const label = (item as { label?: string }).label ?? "";
    const value = (item as { value?: string }).value ?? "";
    const name = (item as { name?: string }).name ?? "";
    const candidate = findAlertInTexts([label, value, name]);
    if (candidate) {
      const noticeUrl =
        (item as { URL?: string }).URL ??
        (item as { url?: string }).url ??
        (value.startsWith("http") ? value : undefined);
      return {
        status: candidate.status,
        label: candidate.match,
        noticeUrl,
      };
    }
  }

  // 2) Update-to
  for (const item of updateList) {
    if (!item || typeof item !== "object") continue;
    const type = (item as { type?: string }).type ?? "";
    const label = (item as { label?: string }).label ?? "";
    const candidate = findAlertInTexts([type, label]);
    if (candidate) {
      const updateDoi = (item as { DOI?: string }).DOI;
      const noticeUrl =
        (item as { URL?: string }).URL ??
        (item as { url?: string }).url ??
        (typeof updateDoi === "string"
          ? `https://doi.org/${updateDoi}`
          : undefined);
      return {
        status: candidate.status,
        label: candidate.match,
        noticeUrl,
      };
    }
  }

  // 3) Relations
  for (const item of relationList) {
    if (!item || typeof item !== "object") continue;
    const type = (item as { type?: string }).type ?? "";
    const label = (item as { label?: string }).label ?? "";
    const candidate = findAlertInTexts([type, label]);
    if (candidate) {
      const relId = (item as { id?: string }).id;
      const relUrl =
        (item as { url?: string }).url ??
        (typeof relId === "string" ? relId : undefined);
      return {
        status: candidate.status,
        label: candidate.match,
        noticeUrl: relUrl,
      };
    }
  }

  return { status: "ok" };
}

async function fetchCrossrefMessage(doi: string): Promise<any | null> {
  if (!doi.startsWith("10.")) return null;

  const encodedIdPath = encodeURIComponent(doi).replace(/%2F/g, "/");
  const worksUrl = `https://api.crossref.org/v1/works/${encodedIdPath}`;
  const filterUrl = `https://api.crossref.org/v1/works?filter=doi:${encodeURIComponent(
    doi
  )}&rows=1`;

  const sleep = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  async function fetchWork(
    targetUrl: string
  ): Promise<{ ok: boolean; status: number; data: any | null }> {
    try {
      const res = await fetch(targetUrl, {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!res.ok) return { ok: false, status: res.status, data: null };
      const data = await res.json();
      return { ok: true, status: res.status, data };
    } catch (error) {
      logDebug("fetchWork error", targetUrl, error);
      return { ok: false, status: 0, data: null };
    }
  }

  let data: any | null = null;

  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const primary = await fetchWork(worksUrl);
      logDebug(
        "fetch worksUrl",
        worksUrl,
        "ok:",
        primary.ok,
        "status:",
        primary.status,
        "attempt:",
        attempt + 1
      );
      data = primary.data;
      if (data || primary.ok) break;
      await sleep(200 * (attempt + 1));
    }

    if (!data) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const fallback = await fetchWork(filterUrl);
        logDebug(
          "fetch filterUrl",
          filterUrl,
          "ok:",
          fallback.ok,
          "status:",
          fallback.status,
          "attempt:",
          attempt + 1
        );
        data = fallback.data;
        if (data?.message?.items?.length) {
          data = { message: data.message.items[0] };
          break;
        }
        if (data) break;
        await sleep(200 * (attempt + 1));
      }
    }
  } catch (error) {
    logDebug("fetchCrossrefMessage error", error);
  }

  if (!data) return null;
  return data.message ?? null;
}

async function checkStatus(id: string): Promise<StatusResult> {
  // Only DOIs are handled via Crossref for now.
  if (!id.startsWith("10.")) return { status: "unknown" };

  const cached = await getCachedStatus(id);
  if (cached) {
    logDebug("using cached status", id);
    return cached;
  }

  const message = await fetchCrossrefMessage(id);
  if (!message) return { status: "unknown" };

  try {
    const detected = detectAlertFromMessage(message);
    logDebug("checkStatus result", { id, detected });
    if (detected.status !== "unknown") {
      void setCachedStatus(id, detected);
    }
    return detected;
  } catch (error) {
    logDebug("checkStatus error", error);
    return { status: "unknown" };
  }
}

interface ReferenceCheckResult {
  alerts: Array<{
    id: string;
    status: ArticleStatus;
    noticeUrl?: string;
    label?: string;
  }>;
  checked: number;
  totalFound: number;
  failedChecks: number;
  counts: Record<ArticleStatus, number>;
}

async function checkReferences(doi: string): Promise<ReferenceCheckResult> {
  const message = await fetchCrossrefMessage(doi);
  if (!message)
    return {
      alerts: [],
      checked: 0,
      totalFound: 0,
      failedChecks: 1,
      counts: { ok: 0, retracted: 0, withdrawn: 0, expression_of_concern: 0, unknown: 1 },
    };

  const references: unknown = message.reference ?? [];
  const refList = Array.isArray(references) ? references : [];
  const dois = refList
    .map((ref) => {
      if (!ref || typeof ref !== "object") return null;
      const doiValue = (ref as { DOI?: string }).DOI;
      if (typeof doiValue === "string" && doiValue.startsWith("10."))
        return doiValue;
      return null;
    })
    .filter((val): val is string => Boolean(val));

  const uniqueDois = Array.from(new Set(dois));
  logDebug("checking references", {
    totalFound: dois.length,
    checking: uniqueDois.length,
  });

  const results: Array<{
    id: string;
    status: ArticleStatus;
    noticeUrl?: string;
    label?: string;
  }> = [];
  let checked = 0;
  let failedChecks = 0;
  let index = 0;
  const counts: Record<ArticleStatus, number> = {
    ok: 0,
    retracted: 0,
    withdrawn: 0,
    expression_of_concern: 0,
    unknown: 0,
  };

  const worker = async () => {
    while (index < uniqueDois.length) {
      const current = index++;
      const refDoi = uniqueDois[current];
      const status = await checkStatus(refDoi);
      checked += 1;
      if (status.status === "unknown") {
        failedChecks += 1;
        counts.unknown += 1;
      } else if (ALERT_STATUSES.has(status.status)) {
        counts[status.status] += 1;
        results.push({
          id: refDoi,
          status: status.status,
          noticeUrl: status.noticeUrl,
          label: status.label,
        });
      } else {
        counts.ok += 1;
      }
      updateReferenceProgress(checked, uniqueDois.length);
    }
  };

  const concurrency = Math.min(
    MAX_REFERENCE_CONCURRENCY,
    uniqueDois.length || 1
  );
  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  return {
    alerts: results,
    checked,
    totalFound: dois.length,
    failedChecks,
    counts,
  };
}

async function fetchOrcidDois(orcidId: string): Promise<string[]> {
  const cached = await getCache<string[]>(`orcid:${orcidId}`);
  if (cached && cached.length) {
    logDebug("using cached orcid works", orcidId);
    return cached;
  }

  try {
    const res = await fetch(
      `https://pub.orcid.org/v3.0/${encodeURIComponent(orcidId)}/works`,
      {
        headers: { Accept: "application/json" },
        cache: "no-store",
      }
    );
    if (!res.ok) {
      logDebug("orcid fetch failed", res.status);
      return [];
    }
    const data = await res.json();
    const groups = data?.group ?? [];
    const dois: string[] = [];
    for (const g of groups) {
      const extIds = g?.["external-ids"]?.["external-id"] ?? [];
      for (const ext of extIds) {
        const type = ext?.["external-id-type"];
        const value = ext?.["external-id-value"];
        if (
          typeof value === "string" &&
          typeof type === "string" &&
          type.toLowerCase() === "doi"
        ) {
          const norm = value.trim();
          if (norm.startsWith("10.")) dois.push(norm);
        }
      }
    }
    const unique = Array.from(new Set(dois));
    if (unique.length) {
      void setCache(`orcid:${orcidId}`, unique);
    }
    return unique;
  } catch (error) {
    logDebug("fetchOrcidDois error", error);
    return [];
  }
}

async function checkOrcidWorks(orcidId: string): Promise<ReferenceCheckResult> {
  const dois = await fetchOrcidDois(orcidId);
  if (!dois.length) {
    return {
      alerts: [],
      checked: 0,
      totalFound: 0,
      failedChecks: 1,
      counts: { ok: 0, retracted: 0, withdrawn: 0, expression_of_concern: 0, unknown: 1 },
    };
  }

  logDebug("checking orcid works", { totalFound: dois.length });

  const results: Array<{
    id: string;
    status: ArticleStatus;
    noticeUrl?: string;
    label?: string;
  }> = [];
  let checked = 0;
  let failedChecks = 0;
  let index = 0;
  const counts: Record<ArticleStatus, number> = {
    ok: 0,
    retracted: 0,
    withdrawn: 0,
    expression_of_concern: 0,
    unknown: 0,
  };

  const worker = async () => {
    while (index < dois.length) {
      const current = index++;
      const refDoi = dois[current];
      const status = await checkStatus(refDoi);
      checked += 1;
      if (status.status === "unknown") {
        failedChecks += 1;
        counts.unknown += 1;
      } else if (ALERT_STATUSES.has(status.status)) {
        counts[status.status] += 1;
        results.push({
          id: refDoi,
          status: status.status,
          noticeUrl: status.noticeUrl,
          label: status.label,
        });
      } else {
        counts.ok += 1;
      }
      updateReferenceProgress(checked, dois.length);
    }
  };

  const concurrency = Math.min(MAX_REFERENCE_CONCURRENCY, dois.length || 1);
  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  return { alerts: results, checked, totalFound: dois.length, failedChecks, counts };
}

async function collectReferencedDois(dois: string[]): Promise<string[]> {
  const refs = new Set<string>();
  for (const doi of dois) {
    const message = await fetchCrossrefMessage(doi);
    const references: unknown = message?.reference ?? [];
    const refList = Array.isArray(references) ? references : [];
    for (const ref of refList) {
      if (!ref || typeof ref !== "object") continue;
      const doiValue = (ref as { DOI?: string }).DOI;
      if (typeof doiValue === "string" && doiValue.startsWith("10.")) {
        refs.add(doiValue);
        if (refs.size >= MAX_REFERENCED_DOIS) return Array.from(refs);
      }
    }
    if (refs.size >= MAX_REFERENCED_DOIS) break;
  }
  return Array.from(refs);
}

async function checkCitedRetractedFromWorks(
  dois: string[]
): Promise<ReferenceCheckResult> {
  const refDois = await collectReferencedDois(dois);
  if (!refDois.length) {
    return {
      alerts: [],
      checked: 0,
      totalFound: 0,
      failedChecks: 1,
      counts: { ok: 0, retracted: 0, withdrawn: 0, expression_of_concern: 0, unknown: 1 },
    };
  }

  logDebug("checking referenced works", { totalFound: refDois.length });

  const results: Array<{
    id: string;
    status: ArticleStatus;
    noticeUrl?: string;
    label?: string;
  }> = [];
  let checked = 0;
  let failedChecks = 0;
  let index = 0;
  const counts: Record<ArticleStatus, number> = {
    ok: 0,
    retracted: 0,
    withdrawn: 0,
    expression_of_concern: 0,
    unknown: 0,
  };

  const worker = async () => {
    while (index < refDois.length) {
      const current = index++;
      const refDoi = refDois[current];
      const status = await checkStatus(refDoi);
      checked += 1;
      if (status.status === "unknown") {
        failedChecks += 1;
        counts.unknown += 1;
      } else if (ALERT_STATUSES.has(status.status)) {
        counts[status.status] += 1;
        results.push({
          id: refDoi,
          status: status.status,
          noticeUrl: status.noticeUrl,
          label: status.label,
        });
      } else {
        counts.ok += 1;
      }
      updateReferenceProgress(checked, refDois.length);
    }
  };

  const concurrency = Math.min(MAX_REFERENCE_CONCURRENCY, refDois.length || 1);
  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  return { alerts: results, checked, totalFound: refDois.length, failedChecks, counts };
}

function extractDoiFromDoiOrg(): string | null {
  if (!location.hostname.endsWith("doi.org")) return null;
  const doi = decodeURIComponent(location.pathname.replace(/^\//, "")).trim();
  return doi ? doi : null;
}

function extractMetaDoi(): string | null {
  const meta = document.querySelector('meta[name="citation_doi"]');
  const doi = meta?.getAttribute("content")?.trim() ?? "";
  return doi || null;
}

function extractNatureDoiFromPath(): string | null {
  if (!location.hostname.endsWith("nature.com")) return null;
  const match = location.pathname.match(/\/articles\/([^/?#]+)/);
  if (!match) return null;
  const suffix = match[1];
  if (!suffix) return null;
  return `10.1038/${suffix}`;
}

function extractLancetDoiFromPath(): string | null {
  if (!location.hostname.endsWith("thelancet.com")) return null;
  // Example path: /journals/lancet/article/PIIS0140-6736(24)01822-1/abstract
  const piiMatch = location.pathname.match(/\/PII([A-Za-z0-9().-]+)/i);
  if (!piiMatch) return null;
  const pii = piiMatch[1];
  // Lancet PII often maps to DOI 10.1016/S...
  const doiStem = pii.startsWith("S") ? pii : pii.replace(/^P?II/, ""); // normalize
  return `10.1016/${doiStem}`;
}

function extractDoiFromUrlPath(): string | null {
  // Generic DOI finder in URL for many publishers (science.org, sciencedirect, springer, wiley, tandfonline, etc.)
  const decoded = decodeURIComponent(location.href);
  const match = decoded.match(/10\.\d{4,9}\/[^\s"'>?#)]+/);
  if (!match) return null;
  const candidate = match[0].replace(/[\].]+$/, ""); // trim trailing punctuation
  return candidate;
}

function extractOrcidId(): string | null {
  if (!location.hostname.endsWith("orcid.org")) return null;
  const match = location.pathname.match(
    /\/(\d{4}-\d{4}-\d{4}-[\dX]{3}[\dX]?)/i
  );
  return match ? match[1] : null;
}

function extractPmid(): string | null {
  if (!location.hostname.endsWith("pubmed.ncbi.nlm.nih.gov")) return null;
  const meta = document.querySelector('meta[name="citation_pmid"]');
  const pmid = meta?.getAttribute("content")?.trim() ?? "";
  return pmid || null;
}

function injectBanner(result: StatusResult): void {
  if (document.getElementById("retraction-alert-banner")) return;

  const banner = document.createElement("div");
  banner.id = "retraction-alert-banner";
  const statusText =
    result.status === "withdrawn"
      ? "⚠️ This article has been withdrawn."
      : result.status === "expression_of_concern"
        ? "⚠️ This article has an expression of concern."
        : "⚠️ This article has been retracted.";
  banner.textContent = statusText;
  banner.style.position = "fixed";
  banner.style.top = "0";
  banner.style.left = "0";
  banner.style.right = "0";
  banner.style.zIndex = "999999";
  banner.style.display = "flex";
  banner.style.justifyContent = "center";
  banner.style.alignItems = "center";
  banner.style.gap = "0.5rem";
  banner.style.padding = "12px 16px";
  banner.style.backgroundColor = "#b00020";
  banner.style.color = "#ffffff";
  banner.style.fontFamily = "Arial, sans-serif";
  banner.style.fontSize = "16px";
  banner.style.fontWeight = "bold";
  banner.style.boxShadow = "0 2px 6px rgba(0, 0, 0, 0.25)";

  if (result.noticeUrl) {
    const link = document.createElement("a");
    link.href = result.noticeUrl;
    link.textContent = result.label ?? "View notice";
    link.style.color = "#ffe082";
    link.style.textDecoration = "underline";
    link.target = "_blank";
    link.rel = "noreferrer noopener";
    banner.appendChild(link);
  }

  document.body.appendChild(banner);

  const bannerHeight = banner.getBoundingClientRect().height;
  const currentPaddingTop = window.getComputedStyle(document.body).paddingTop;
  const parsedPadding = Number.parseFloat(currentPaddingTop) || 0;
  document.body.style.paddingTop = `${parsedPadding + bannerHeight}px`;
}

function injectCacheClearButton(container: HTMLElement): void {
  const spacer = document.createElement("div");
  spacer.style.flex = "1";
  spacer.style.minWidth = "12px";

  const btn = document.createElement("button");
  btn.textContent = "Clear cache";
  btn.style.border = "none";
  btn.style.cursor = "pointer";
  btn.style.background = "#ffe082";
  btn.style.color = "#4e342e";
  btn.style.fontWeight = "bold";
  btn.style.padding = "6px 10px";
  btn.style.borderRadius = "6px";
  btn.style.boxShadow = "0 1px 3px rgba(0,0,0,0.2)";
  btn.addEventListener("click", async (e) => {
    e.preventDefault();
    try {
      if (chrome?.storage?.local) {
        await chrome.storage.local.clear();
      }
      memoryCache.clear();
      logDebug("cache cleared");
      btn.textContent = "Cache cleared";
      setTimeout(() => {
        btn.textContent = "Clear cache";
      }, 1500);
    } catch (error) {
      logDebug("cache clear error", error);
    }
  });
  container.appendChild(spacer);
  container.appendChild(btn);
}

function removeProgressBanner(): void {
  const banner = document.getElementById("retraction-alert-ref-progress");
  if (banner) {
    const height = banner.getBoundingClientRect().height;
    banner.remove();
    const currentPaddingTop = window.getComputedStyle(document.body).paddingTop;
    const parsedPadding = Number.parseFloat(currentPaddingTop) || 0;
    document.body.style.paddingTop = `${Math.max(0, parsedPadding - height)}px`;
  }
}

function injectReferencesBanner(
  alerts: Array<{ id: string; noticeUrl?: string }>,
  checked: number,
  totalFound: number,
  failedChecks: number
): void {
  if (document.getElementById("retraction-alert-ref-banner")) return;

  const primary = document.getElementById("retraction-alert-banner");
  const offset = primary ? primary.getBoundingClientRect().height : 0;

  const banner = document.createElement("div");
  banner.id = "retraction-alert-ref-banner";
  banner.style.position = "fixed";
  banner.style.top = `${offset}px`;
  banner.style.left = "0";
  banner.style.right = "0";
  banner.style.zIndex = "999998";
  banner.style.display = "flex";
  banner.style.flexWrap = "wrap";
  banner.style.justifyContent = "center";
  banner.style.alignItems = "center";
  banner.style.gap = "0.4rem";
  banner.style.padding = "10px 14px";
  banner.style.backgroundColor = alerts.length
    ? "#8b0000"
    : failedChecks > 0
    ? "#fbc02d"
    : "#1b5e20";
  banner.style.color = "#ffffff";
  banner.style.fontFamily = "Arial, sans-serif";
  banner.style.fontSize = "14px";
  banner.style.fontWeight = "bold";
  banner.style.boxShadow = "0 2px 6px rgba(0, 0, 0, 0.25)";

  const text = document.createElement("span");
  if (alerts.length) {
    text.textContent = `⚠️ Cited retracted/flagged papers found (${alerts.length}).`;
  } else if (failedChecks > 0) {
    text.textContent = `⚠️ Citation check incomplete (failed ${failedChecks} of ${
      totalFound || checked || failedChecks
    }).`;
  } else {
    text.textContent = `✅ Checked ${checked} of ${
      totalFound || checked
    } citations: no retractions found.`;
  }
  banner.appendChild(text);

  const emailTarget = alerts.length ? extractCorrespondingEmail() : null;

  if (alerts.length) {
    const list = document.createElement("span");
    const links = alerts.slice(0, 5).map((alert) => {
      const a = document.createElement("a");
      a.href = alert.noticeUrl ?? `https://doi.org/${alert.id}`;
      a.textContent = alert.id;
      a.target = "_blank";
      a.rel = "noreferrer noopener";
      a.style.color = "#ffe082";
      a.style.textDecoration = "underline";
      return a;
    });

    links.forEach((link, idx) => {
      list.appendChild(link);
      if (idx < links.length - 1) {
        const sep = document.createTextNode(", ");
        list.appendChild(sep);
      }
    });

    banner.appendChild(list);

    if (emailTarget) {
      const spacer = document.createElement("span");
      spacer.textContent = " · ";
      spacer.style.opacity = "0.6";
      banner.appendChild(spacer);

      const button = document.createElement("button");
      button.textContent = "Email corresponding author";
      button.style.border = "none";
      button.style.cursor = "pointer";
      button.style.background = "#ffe082";
      button.style.color = "#4e342e";
      button.style.fontWeight = "bold";
      button.style.padding = "6px 10px";
      button.style.borderRadius = "6px";
      button.style.boxShadow = "0 1px 3px rgba(0,0,0,0.2)";

      button.addEventListener("click", (e) => {
        e.preventDefault();
        const mailto = createEmailLink(
          extractDoiFromDoiOrg() ??
            extractMetaDoi() ??
            extractNatureDoiFromPath() ??
            extractLancetDoiFromPath() ??
            "this article",
          emailTarget,
          alerts
        );
        window.location.href = mailto;
      });

      banner.appendChild(button);
    }
  } else if (failedChecks > 0) {
  } else if (failedChecks > 0) {
    const notifyButton = document.createElement("button");
    notifyButton.textContent = "Notify maintainer";
    notifyButton.style.border = "none";
    notifyButton.style.cursor = "pointer";
    notifyButton.style.background = "#ffe082";
    notifyButton.style.color = "#4e342e";
    notifyButton.style.fontWeight = "bold";
    notifyButton.style.padding = "6px 10px";
    notifyButton.style.borderRadius = "6px";
    notifyButton.style.boxShadow = "0 1px 3px rgba(0,0,0,0.2)";
    notifyButton.addEventListener("click", () => {
      window.open(SUPPORT_URL, "_blank", "noreferrer");
    });
    banner.appendChild(notifyButton);
  }

  document.body.appendChild(banner);

  const bannerHeight = banner.getBoundingClientRect().height;
  const currentPaddingTop = window.getComputedStyle(document.body).paddingTop;
  const parsedPadding = Number.parseFloat(currentPaddingTop) || 0;
  document.body.style.paddingTop = `${parsedPadding + bannerHeight}px`;
}

function injectOrcidBanner(
  works: ReferenceCheckResult,
  citations: ReferenceCheckResult,
  orcidId: string
): void {
  if (document.getElementById("retraction-alert-ref-banner")) return;

  const banner = document.createElement("div");
  banner.id = "retraction-alert-ref-banner";
  banner.style.position = "fixed";
  banner.style.top = "0";
  banner.style.left = "0";
  banner.style.right = "0";
  banner.style.zIndex = "999998";
  banner.style.display = "flex";
  banner.style.flexWrap = "wrap";
  banner.style.justifyContent = "center";
  banner.style.alignItems = "center";
  banner.style.gap = "0.5rem";
  banner.style.padding = "12px 16px";
  const hasAlerts = works.alerts.length || citations.alerts.length;
  banner.style.backgroundColor = hasAlerts ? "#8b0000" : "#1b5e20";
  banner.style.color = "#ffffff";
  banner.style.fontFamily = "Arial, sans-serif";
  banner.style.fontSize = "14px";
  banner.style.fontWeight = "bold";
  banner.style.boxShadow = "0 2px 6px rgba(0, 0, 0, 0.25)";

  const lines: string[] = [];
  lines.push(`ORCID ${orcidId}`);
  lines.push(
    `Works retracted: ${works.alerts.length} (checked ${works.checked}/${
      works.totalFound || works.checked
    }${works.failedChecks ? `, failed ${works.failedChecks}` : ""})`
  );
  lines.push(
    `Cited retractions: ${citations.alerts.length} (checked ${
      citations.checked
    }/${citations.totalFound || citations.checked}${
      citations.failedChecks ? `, failed ${citations.failedChecks}` : ""
    })`
  );

  const text = document.createElement("div");
  text.textContent = lines.join(" • ");
  banner.appendChild(text);

  const listSection = document.createElement("div");
  listSection.style.display = "flex";
  listSection.style.flexWrap = "wrap";
  listSection.style.gap = "0.3rem";

  const addLinks = (
    label: string,
    items: Array<{ id: string; noticeUrl?: string }>
  ) => {
    if (!items.length) return;
    const prefix = document.createElement("span");
    prefix.textContent = label;
    listSection.appendChild(prefix);
    items.slice(0, 5).forEach((alert, idx) => {
      const a = document.createElement("a");
      a.href = alert.noticeUrl ?? `https://doi.org/${alert.id}`;
      a.textContent = alert.id;
      a.target = "_blank";
      a.rel = "noreferrer noopener";
      a.style.color = "#ffe082";
      a.style.textDecoration = "underline";
      listSection.appendChild(a);
      if (idx < Math.min(5, items.length) - 1) {
        const sep = document.createTextNode(", ");
        listSection.appendChild(sep);
      }
    });
  };

  addLinks("Works:", works.alerts);
  addLinks("Citations:", citations.alerts);

  if (listSection.childNodes.length) banner.appendChild(listSection);

  document.body.appendChild(banner);

  const bannerHeight = banner.getBoundingClientRect().height;
  const currentPaddingTop = window.getComputedStyle(document.body).paddingTop;
  const parsedPadding = Number.parseFloat(currentPaddingTop) || 0;
  document.body.style.paddingTop = `${parsedPadding + bannerHeight}px`;
}

function extractCorrespondingEmail(): string | null {
  const metaEmail = document
    .querySelector('meta[name="citation_author_email"]')
    ?.getAttribute("content");
  if (metaEmail) return metaEmail.trim();
  const mailLink = document.querySelector(
    'a[href^="mailto:"]'
  ) as HTMLAnchorElement | null;
  const href = mailLink?.getAttribute("href");
  if (href && href.startsWith("mailto:")) {
    const email = href.replace(/^mailto:/i, "").split("?")[0];
    if (email) return email.trim();
  }
  return null;
}

function createEmailLink(
  articleId: string,
  recipient: string,
  alerts: Array<{ id: string }>
): string {
  const subject = `Retracted citations noted for ${articleId}`;
  const bodyLines = [
    `Hello,`,
    ``,
    `While reviewing your paper, ${articleId}, I noticed the following cited papers are marked as retracted/flagged:`,
    ...alerts.map((a) => `- ${a.id}`),
    ``,
    `Thought you might want to know.`,
    ``,
    `Sent via Retraction Alert`,
  ];
  const body = bodyLines.join("\n");
  return `mailto:${encodeURIComponent(recipient)}?subject=${encodeURIComponent(
    subject
  )}&body=${encodeURIComponent(body)}`;
}

function ensureReferenceProgressBanner(): HTMLDivElement {
  const existing = document.getElementById(
    "retraction-alert-ref-progress"
  ) as HTMLDivElement | null;
  if (existing) return existing;

  const primary = document.getElementById("retraction-alert-banner");
  const offset = primary ? primary.getBoundingClientRect().height : 0;

  const wrapper = document.createElement("div");
  wrapper.id = "retraction-alert-ref-progress";
  wrapper.style.position = "fixed";
  wrapper.style.top = `${offset}px`;
  wrapper.style.left = "0";
  wrapper.style.right = "0";
  wrapper.style.zIndex = "999997";
  wrapper.style.display = "flex";
  wrapper.style.flexDirection = "column";
  wrapper.style.alignItems = "center";
  wrapper.style.gap = "6px";
  wrapper.style.padding = "10px 14px";
  wrapper.style.backgroundColor = "#fbc02d";
  wrapper.style.color = "#000";
  wrapper.style.fontFamily = "Arial, sans-serif";
  wrapper.style.fontSize = "13px";
  wrapper.style.fontWeight = "bold";
  wrapper.style.boxShadow = "0 2px 6px rgba(0, 0, 0, 0.2)";

  const label = document.createElement("div");
  label.id = "retraction-alert-ref-progress-label";
  label.textContent = "Checking citations...";
  wrapper.appendChild(label);

  const barOuter = document.createElement("div");
  barOuter.style.width = "320px";
  barOuter.style.maxWidth = "90vw";
  barOuter.style.height = "8px";
  barOuter.style.backgroundColor = "#ffe082";
  barOuter.style.borderRadius = "999px";
  barOuter.style.overflow = "hidden";

  const barInner = document.createElement("div");
  barInner.id = "retraction-alert-ref-progress-bar";
  barInner.style.height = "100%";
  barInner.style.width = "0%";
  barInner.style.backgroundColor = "#f57f17";
  barInner.style.transition = "width 0.2s ease-out";

  barOuter.appendChild(barInner);
  wrapper.appendChild(barOuter);

  document.body.appendChild(wrapper);

  const bannerHeight = wrapper.getBoundingClientRect().height;
  const currentPaddingTop = window.getComputedStyle(document.body).paddingTop;
  const parsedPadding = Number.parseFloat(currentPaddingTop) || 0;
  document.body.style.paddingTop = `${parsedPadding + bannerHeight}px`;

  return wrapper;
}

function updateReferenceProgress(done: number, total: number): void {
  if (total <= 0) return;
  const banner = ensureReferenceProgressBanner();
  const label = document.getElementById("retraction-alert-ref-progress-label");
  const bar = document.getElementById(
    "retraction-alert-ref-progress-bar"
  ) as HTMLDivElement | null;
  if (label) {
    label.textContent = `Checking citations... (${done}/${total})`;
  }
  if (bar) {
    const pct = Math.min(100, Math.max(0, Math.round((done / total) * 100)));
    bar.style.width = `${pct}%`;
  }

  if (done >= total) {
    setTimeout(() => {
      banner.remove();
      const currentPaddingTop = window.getComputedStyle(
        document.body
      ).paddingTop;
      const parsedPadding = Number.parseFloat(currentPaddingTop) || 0;
      const height = banner.getBoundingClientRect().height;
      document.body.style.paddingTop = `${Math.max(
        0,
        parsedPadding - height
      )}px`;
    }, 400);
  }
}

async function run(): Promise<void> {
  const orcidId = extractOrcidId();
  if (orcidId) {
    logDebug("Detected ORCID", orcidId);
    const worksResult = await checkOrcidWorks(orcidId);
    const allDois = await fetchOrcidDois(orcidId);
    const citationsResult = await checkCitedRetractedFromWorks(allDois);
    removeProgressBanner();
    injectOrcidBanner(worksResult, citationsResult, orcidId);
    logDebug("ORCID banner injected", {
      works: worksResult,
      citations: citationsResult,
    });
    return;
  }

  const id =
    extractDoiFromDoiOrg() ??
    extractMetaDoi() ??
    extractNatureDoiFromPath() ??
    extractLancetDoiFromPath() ??
    extractDoiFromUrlPath() ??
    extractPmid();
  if (!id) {
    logDebug("No DOI/PMID found on this page");
    return;
  }

  logDebug("Detected identifier", id, "hostname:", location.hostname);

  const result = await checkStatus(id);
  if (ALERT_STATUSES.has(result.status)) {
    injectBanner(result);
    logDebug("Banner injected");
  } else {
    logDebug("Status not alerting", result);
  }

  if (id.startsWith("10.")) {
    const referenceResult = await checkReferences(id);
    removeProgressBanner();
    injectReferencesBanner(
      referenceResult.alerts,
      referenceResult.checked,
      referenceResult.totalFound,
      referenceResult.failedChecks
    );
    if (referenceResult.alerts.length) {
      logDebug("Reference banner injected", referenceResult.alerts);
    } else {
      logDebug("No reference alerts", referenceResult);
    }
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    void run();
  });
} else {
  void run();
}
