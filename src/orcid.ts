import {
  MAX_REFERENCE_CONCURRENCY,
  MAX_REFERENCED_DOIS,
  ALERT_STATUSES,
} from "./constants";
import { getCache, setCache } from "./cache";
import { logDebug } from "./log";
import { ArticleStatus, ReferenceCheckResult, AlertEntry } from "./types";
import { checkStatus, fetchCrossrefMessage } from "./crossref";

export async function fetchOrcidDois(orcidId: string): Promise<string[]> {
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
          typeof type === "string" &&
          type.toLowerCase() === "doi" &&
          typeof value === "string" &&
          value.startsWith("10.")
        ) {
          dois.push(value);
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

export async function checkOrcidWorks(
  orcidId: string
): Promise<ReferenceCheckResult> {
  const dois = await fetchOrcidDois(orcidId);
  if (!dois.length) {
    return {
      alerts: [],
      checked: 0,
      totalFound: 0,
      failedChecks: 1,
      counts: {
        ok: 0,
        retracted: 0,
        withdrawn: 0,
        expression_of_concern: 0,
        unknown: 1,
      },
    };
  }

  logDebug("checking orcid works", { totalFound: dois.length });

  const results: AlertEntry[] = [];
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
          title: status.title,
        });
      } else {
        counts.ok += 1;
      }
    }
  };

  const concurrency = Math.min(MAX_REFERENCE_CONCURRENCY, dois.length || 1);
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

export async function checkCitedRetractedFromWorks(
  dois: string[]
): Promise<ReferenceCheckResult> {
  const refDois = await collectReferencedDois(dois);
  if (!refDois.length) {
    return {
      alerts: [],
      checked: 0,
      totalFound: 0,
      failedChecks: 1,
      counts: {
        ok: 0,
        retracted: 0,
        withdrawn: 0,
        expression_of_concern: 0,
        unknown: 1,
      },
    };
  }

  logDebug("checking referenced works", { totalFound: refDois.length });

  const results: AlertEntry[] = [];
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
    }
  };

  const concurrency = Math.min(MAX_REFERENCE_CONCURRENCY, refDois.length || 1);
  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  return {
    alerts: results,
    checked,
    totalFound: refDois.length,
    failedChecks,
    counts,
  };
}
