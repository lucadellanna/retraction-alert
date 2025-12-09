import {
  ALERT_STATUSES,
  MAX_REFERENCE_CONCURRENCY,
  MAX_REFERENCED_DOIS,
} from "./constants";
import { getCache, setCache } from "./cache";
import { extractDoiFromHref } from "./doi";
import { logDebug } from "./log";
import { ArticleStatus, StatusResult, ReferenceCheckResult } from "./types";

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

export async function fetchCrossrefMessage(
  id: string
): Promise<Record<string, unknown> | null> {
  try {
    const cached = await getCache<Record<string, unknown>>(`crossref:${id}`);
    if (cached) return cached;

    // Crossref API expects the DOI path with slashes intact; encoding the entire
    // string turns "/" into %2F and triggers 400. Encode only exotic chars.
    const safeId = encodeURI(id);
    const url = `https://api.crossref.org/v1/works/${safeId}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    const message = data?.message;
    if (message) {
      void setCache(`crossref:${id}`, message);
    }
    logDebug("parsed Crossref payload", {
      updateTo: message?.["update-to"],
      assertion: message?.assertion,
    });
    return message ?? null;
  } catch (error) {
    logDebug("fetchCrossrefMessage error", error);
    return null;
  }
}

function detectAlertFromMessage(message: Record<string, unknown>): StatusResult {
  const assertions = (message.assertion as unknown[]) ?? [];
  const updateTo = (message["update-to"] as unknown[]) ?? [];
  const texts: string[] = [];
  if (Array.isArray(assertions)) {
    for (const a of assertions) {
      if (a && typeof a === "object") {
        const label = (a as { label?: string }).label;
        if (typeof label === "string") texts.push(label);
      }
    }
  }
  if (Array.isArray(updateTo)) {
    for (const u of updateTo) {
      if (u && typeof u === "object") {
        const label = (u as { label?: string }).label;
        const type = (u as { type?: string }).type;
        const doi = (u as { DOI?: string }).DOI;
        const status = mapStatusFromLabel(label || type || "");
        if (status !== "ok") {
          return { status, label: label || type || "", noticeUrl: doi };
        }
      }
    }
  }
  const alert = findAlertInTexts(texts);
  if (alert) return { status: alert.status, label: alert.match };

  const policies = (message["update-policy"] as unknown) ?? [];
  const policiesArr = Array.isArray(policies) ? policies : [];
  const policyAlert = findAlertInTexts(policiesArr as string[]);
  if (policyAlert) return { status: policyAlert.status, label: policyAlert.match };

  return { status: "ok" };
}

export async function fetchWork(
  doi: string
): Promise<StatusResult & { title?: string }> {
  const safeDoi = encodeURI(doi);
  const targetUrl = `https://api.crossref.org/v1/works/${safeDoi}`;
  try {
    const res = await fetch(targetUrl, { cache: "no-store" });
    if (!res.ok) {
      logDebug("fetchWork error", targetUrl, res.status);
      return { status: "unknown" };
    }
    const data = await res.json();
    const message = data?.message as Record<string, unknown> | undefined;
    if (!message) return { status: "unknown" };

    const detected = detectAlertFromMessage(message);
    const title = Array.isArray(message.title)
      ? (message.title[0] as string | undefined)
      : undefined;
    if (detected.status !== "ok") {
      return { ...detected, title };
    }
    const updateTo = (message["update-to"] as unknown[]) ?? [];
    for (const u of updateTo) {
      if (u && typeof u === "object") {
        const type = (u as { type?: string }).type;
        const status = mapStatusFromLabel(type || "");
        if (status !== "ok") {
          return {
            status,
            label: (u as { label?: string }).label,
            noticeUrl: (u as { DOI?: string }).DOI,
            title,
          };
        }
      }
    }
    const assertions = (message.assertion as unknown[]) ?? [];
    for (const a of assertions) {
      if (a && typeof a === "object") {
        const label = (a as { label?: string }).label || "";
        const status = mapStatusFromLabel(label);
        if (status !== "ok") {
          return { status, label, title };
        }
      }
    }
    return { status: "ok", title };
  } catch (error) {
    logDebug("fetchWork error", targetUrl, error);
    return { status: "unknown" };
  }
}

export async function checkStatus(id: string): Promise<StatusResult> {
  if (!id.startsWith("10.")) return { status: "unknown" };
  const normalizedId = id.toLowerCase();
  if (normalizedId.includes("osf.io/")) {
    return { status: "unknown" };
  }

  const cached = await getCache<StatusResult>(`status:${id}`);
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
      void setCache(`status:${id}`, detected);
    }
    return detected;
  } catch (error) {
    logDebug("checkStatus error", error);
    return { status: "unknown" };
  }
}

export async function checkReferences(
  doi: string,
  onProgress: (done: number, total: number) => void
): Promise<ReferenceCheckResult> {
  const message = await fetchCrossrefMessage(doi);
  if (!message)
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
          title: status.title,
        });
      } else {
        counts.ok += 1;
      }
      onProgress(checked, uniqueDois.length);
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
