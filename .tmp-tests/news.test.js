// tests/handlers/news.test.ts
import { strict as assert } from "node:assert";
import { JSDOM } from "jsdom";

// src/constants.ts
var ALERT_STATUSES = /* @__PURE__ */ new Set([
  "retracted",
  "withdrawn",
  "expression_of_concern"
]);
var MAX_REFERENCE_CONCURRENCY = 4;
var SUPPORT_URL = "https://Luca-Dellanna.com/contact";
var CACHE_TTL_MS = 24 * 60 * 60 * 1e3;
var CROSSREF_USER_AGENT = "RetractionAlert/0.3.0 (mailto:info@Luca-Dellanna.com)";
var CROSSREF_RATE_LIMIT_MS = 100;
var CROSSREF_MAX_RETRIES = 2;
var NEWS_CONTACTS = {
  "wsj.com": "wsjcontact@wsj.com",
  "theguardian.com": "reader@theguardian.com",
  "nytimes.com": "letters@nytimes.com",
  "washingtonpost.com": "letters@washpost.com",
  "economist.com": "letters@economist.com",
  "ft.com": "customer.support@ft.com",
  "bbc.com": "haveyoursay@bbc.co.uk",
  "reuters.com": "editor@reuters.com",
  "latimes.com": "readers.rep@latimes.com",
  "nbcnews.com": "tips@nbcuni.com",
  "cnn.com": "cnntips@cnn.com",
  "abc.net.au": "",
  "elpais.com": "",
  "elmundo.es": "",
  "lavanguardia.com": "",
  "faz.net": "",
  "globo.com": "",
  "lemonde.fr": "",
  "lefigaro.fr": "",
  "lastampa.it": "",
  "repubblica.it": "",
  "bild.de": "",
  "zeit.de": "",
  "spiegel.de": "",
  "theage.com.au": "",
  "telegraph.co.uk": "",
  "independent.co.uk": "",
  "thetimes.co.uk": ""
};

// src/log.ts
function logDebug(...args) {
  console.debug("[RetractionAlert]", ...args);
}

// src/cache.ts
var memoryCache = /* @__PURE__ */ new Map();
function isFresh(entry) {
  if (!entry) return false;
  return Date.now() - entry.ts < CACHE_TTL_MS;
}
async function getCache(key) {
  try {
    if (chrome?.storage?.local) {
      const result = await chrome.storage.local.get([key]);
      const entry = result[key];
      if (entry && isFresh(entry)) return entry.value;
    } else if (memoryCache.has(key)) {
      const entry = memoryCache.get(key);
      if (isFresh(entry)) return entry?.value ?? null;
    }
  } catch (error) {
  }
  return null;
}
async function setCache(key, value) {
  const entry = { value, ts: Date.now() };
  try {
    if (chrome?.storage?.local) {
      await chrome.storage.local.set({ [key]: entry });
    } else {
      memoryCache.set(key, entry);
    }
  } catch {
  }
}

// src/ui/colors.ts
var COLORS = {
  ok: "#1b5e20",
  // deep green
  warning: "#fbc02d",
  // amber
  danger: "#8b0000",
  // dark red
  link: "#ffe082",
  // pale yellow
  badge: "#b71c1c",
  // badge red
  textDark: "#000000",
  textLight: "#ffffff",
  neutral: "#ffffff"
};

// src/ui/banners.ts
var STATE = {
  basePadding: 0,
  wrapper: null,
  articleBanner: null,
  citationsBanner: null,
  visible: true
};
function clearUiState() {
  STATE.wrapper = null;
  STATE.articleBanner = null;
  STATE.citationsBanner = null;
}
function recalcPadding() {
  if (!STATE.wrapper) return;
  if (!STATE.visible) {
    document.body.style.paddingTop = `${STATE.basePadding}px`;
    return;
  }
  const height = STATE.wrapper.getBoundingClientRect().height;
  document.body.style.paddingTop = `${STATE.basePadding + height}px`;
}
function removeProgressBanner() {
  const banner = document.getElementById("retraction-alert-ref-progress");
  if (banner) {
    banner.remove();
    recalcPadding();
  }
}
function setWrapperVisibility(visible) {
  if (!STATE.wrapper) return;
  STATE.visible = visible;
  STATE.wrapper.style.display = visible ? "flex" : "none";
  recalcPadding();
}
function ensureBanners() {
  if (STATE.wrapper && STATE.articleBanner && STATE.citationsBanner) {
    return {
      wrapper: STATE.wrapper,
      article: STATE.articleBanner,
      citations: STATE.citationsBanner
    };
  }
  if (!STATE.basePadding) {
    STATE.basePadding = Number.parseFloat(window.getComputedStyle(document.body).paddingTop) || 0;
  }
  const wrapper = document.createElement("div");
  wrapper.id = "retraction-alert-wrapper";
  wrapper.style.position = "fixed";
  wrapper.style.top = "0";
  wrapper.style.left = "0";
  wrapper.style.right = "0";
  wrapper.style.zIndex = "999998";
  wrapper.style.display = "flex";
  wrapper.style.flexDirection = "column";
  wrapper.style.gap = "4px";
  const makeBanner = () => {
    const div = document.createElement("div");
    div.style.minHeight = "44px";
    div.style.display = "flex";
    div.style.flexDirection = "column";
    div.style.gap = "4px";
    div.style.alignItems = "center";
    div.style.padding = "10px 14px";
    div.style.fontFamily = "Arial, sans-serif";
    div.style.fontSize = "14px";
    div.style.fontWeight = "bold";
    div.style.color = COLORS.textLight;
    div.style.boxShadow = "0 2px 6px rgba(0, 0, 0, 0.25)";
    div.style.borderRadius = "0";
    return div;
  };
  const article = makeBanner();
  const citations = makeBanner();
  wrapper.appendChild(article);
  wrapper.appendChild(citations);
  document.body.appendChild(wrapper);
  STATE.wrapper = wrapper;
  STATE.articleBanner = article;
  STATE.citationsBanner = citations;
  recalcPadding();
  return { wrapper, article, citations };
}
function ensureReferenceProgressBanner() {
  const existing = document.getElementById(
    "retraction-alert-ref-progress"
  );
  if (existing) return existing;
  const { wrapper } = ensureBanners();
  const container = document.createElement("div");
  container.id = "retraction-alert-ref-progress";
  container.style.display = "flex";
  container.style.flexDirection = "column";
  container.style.alignItems = "center";
  container.style.gap = "6px";
  container.style.padding = "10px 14px";
  container.style.backgroundColor = COLORS.warning;
  container.style.color = "#000";
  container.style.fontFamily = "Arial, sans-serif";
  container.style.fontSize = "13px";
  container.style.fontWeight = "bold";
  container.style.boxShadow = "0 2px 6px rgba(0, 0, 0, 0.2)";
  const label = document.createElement("div");
  label.id = "retraction-alert-ref-progress-label";
  label.textContent = "Checking citations...";
  container.appendChild(label);
  const barOuter = document.createElement("div");
  barOuter.style.width = "320px";
  barOuter.style.maxWidth = "90vw";
  barOuter.style.height = "8px";
  barOuter.style.backgroundColor = COLORS.link;
  barOuter.style.borderRadius = "999px";
  barOuter.style.overflow = "hidden";
  const barInner = document.createElement("div");
  barInner.id = "retraction-alert-ref-progress-bar";
  barInner.style.height = "100%";
  barInner.style.width = "0%";
  barInner.style.backgroundColor = "#f57f17";
  barInner.style.transition = "width 0.2s ease-out";
  barOuter.appendChild(barInner);
  container.appendChild(barOuter);
  wrapper.appendChild(container);
  recalcPadding();
  return container;
}
function updateReferenceProgress(done, total) {
  if (total <= 0) return;
  const banner = ensureReferenceProgressBanner();
  const label = document.getElementById("retraction-alert-ref-progress-label");
  const bar = document.getElementById(
    "retraction-alert-ref-progress-bar"
  );
  if (label) {
    label.textContent = `Checking citations... (${done}/${total})`;
  }
  if (bar) {
    const pct = Math.min(100, Math.max(0, Math.round(done / total * 100)));
    bar.style.width = `${pct}%`;
  }
  if (done >= total) {
    setTimeout(() => {
      removeProgressBanner();
    }, 400);
  }
}
function updateBanner(banner, options) {
  banner.style.backgroundColor = options.bg;
  banner.style.color = options.textColor ?? COLORS.textLight;
  banner.style.display = "flex";
  banner.innerHTML = "";
  options.lines.forEach((line, idx) => {
    const div = document.createElement("div");
    div.textContent = line;
    div.style.textAlign = "center";
    const lineColor = options.lineColors?.[idx];
    if (lineColor) div.style.color = lineColor;
    banner.appendChild(div);
  });
  if (options.alerts && options.alerts.length) {
    banner.appendChild(buildAlertList(options.alerts));
  }
  if (options.actions && options.actions.length) {
    const actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.flexWrap = "wrap";
    actions.style.gap = "8px";
    actions.style.justifyContent = "center";
    options.actions.forEach((action) => {
      const link = document.createElement("a");
      link.href = action.href;
      link.textContent = action.label;
      if (action.title) link.title = action.title;
      link.target = "_blank";
      link.rel = "noreferrer noopener";
      link.style.background = COLORS.link;
      link.style.color = "#4e342e";
      link.style.padding = "6px 10px";
      link.style.borderRadius = "6px";
      link.style.fontWeight = "bold";
      link.style.textDecoration = "none";
      link.style.boxShadow = "0 1px 3px rgba(0,0,0,0.2)";
      actions.appendChild(link);
    });
    banner.appendChild(actions);
  }
  recalcPadding();
}
function statusLabel(status) {
  switch (status) {
    case "retracted":
      return "Retracted";
    case "withdrawn":
      return "Withdrawn";
    case "expression_of_concern":
      return "Expression of concern";
    case "ok":
      return "OK";
    default:
      return "Unknown";
  }
}
function countsSummary(label, counts, total, failed) {
  return `${label}: ${total} total \u2022 retracted ${counts.retracted} \u2022 withdrawn ${counts.withdrawn} \u2022 expression of concern ${counts.expression_of_concern} \u2022 unknown/failed ${Math.max(counts.unknown, failed)}`;
}
function buildAlertList(alerts) {
  const list = document.createElement("div");
  list.style.display = "flex";
  list.style.flexDirection = "column";
  list.style.gap = "4px";
  alerts.forEach((a) => {
    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.flexWrap = "wrap";
    row.style.gap = "6px";
    row.style.alignItems = "center";
    const badge = document.createElement("span");
    badge.textContent = statusLabel(a.status);
    badge.style.padding = "2px 6px";
    badge.style.borderRadius = "4px";
    badge.style.background = a.status === "ok" ? "#2e7d32" : a.status === "expression_of_concern" ? "#ef6c00" : COLORS.danger;
    badge.style.color = "#fff";
    badge.style.fontWeight = "bold";
    row.appendChild(badge);
    const link = document.createElement("a");
    link.href = `https://doi.org/${a.id}`;
    link.textContent = a.title ? `${a.title} (${a.id})` : a.id;
    link.target = "_blank";
    link.rel = "noreferrer noopener";
    link.style.color = COLORS.link;
    link.style.textDecoration = "underline";
    row.appendChild(link);
    if (a.noticeUrl) {
      const notice = document.createElement("a");
      notice.href = a.noticeUrl.startsWith("http") ? a.noticeUrl : `https://doi.org/${a.noticeUrl}`;
      notice.textContent = a.label ?? "Notice";
      notice.target = "_blank";
      notice.rel = "noreferrer noopener";
      notice.style.color = "#c5e1a5";
      notice.style.textDecoration = "underline";
      row.appendChild(notice);
    }
    list.appendChild(row);
  });
  return list;
}

// src/crossref.ts
var lastRequestTime = 0;
async function rateLimit() {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < CROSSREF_RATE_LIMIT_MS) {
    await new Promise(
      (resolve) => setTimeout(resolve, CROSSREF_RATE_LIMIT_MS - elapsed)
    );
  }
  lastRequestTime = Date.now();
}
async function fetchWithBackoff(url) {
  let attempt = 0;
  while (attempt <= CROSSREF_MAX_RETRIES) {
    await rateLimit();
    try {
      const res = await fetch(url, {
        cache: "no-store",
        headers: { "User-Agent": CROSSREF_USER_AGENT }
      });
      if (res.status !== 429) return res;
      const retryAfter = res.headers.get("retry-after");
      const delayMs = retryAfter ? Number(retryAfter) * 1e3 : 500;
      logDebug("crossref 429, backing off", { url, delayMs });
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    } catch (error) {
      logDebug("crossref fetch error", { url, error });
      return null;
    }
    attempt += 1;
  }
  return null;
}
async function fetchJsonViaBackground(url) {
  const canMessage = typeof chrome !== "undefined" && !!chrome.runtime?.id && typeof chrome.runtime.sendMessage === "function";
  if (canMessage) {
    try {
      logDebug("crossref fetch via background", { url });
      const response = await chrome.runtime.sendMessage({
        type: "fetchJson",
        url
      });
      if (response?.ok && response.data) {
        logDebug("crossref fetch via background success", {
          url,
          status: response.status
        });
        return response.data;
      }
      logDebug("crossref fetch via background failed", {
        url,
        status: response?.status,
        error: response?.error
      });
    } catch (error) {
      logDebug("crossref fetch via background error", { url, error });
    }
  }
  try {
    logDebug("crossref fetch direct", { url });
    const res = await fetchWithBackoff(url);
    if (!res) return null;
    if (!res.ok) {
      logDebug("crossref fetch direct failed", { url, status: res.status });
      return null;
    }
    logDebug("crossref fetch direct success", { url, status: res.status });
    const data = await res.json();
    return data;
  } catch (error) {
    logDebug("crossref fetch direct error", { url, error });
    return null;
  }
}
function mapStatusFromLabel(label) {
  const normalized = label.toLowerCase();
  if (normalized.includes("retract")) return "retracted";
  if (normalized.includes("withdraw")) return "withdrawn";
  if (normalized.includes("expression of concern"))
    return "expression_of_concern";
  return "ok";
}
function findAlertInTexts(texts) {
  for (const text of texts) {
    if (!text) continue;
    const status = mapStatusFromLabel(text);
    if (status !== "ok") return { status, match: text };
  }
  return null;
}
async function fetchCrossrefMessage(id) {
  try {
    const cached = await getCache(`crossref:${id}`);
    if (cached) return cached;
    const safeId = encodeURI(id);
    const url = `https://api.crossref.org/v1/works/${safeId}`;
    const data = await fetchJsonViaBackground(url);
    if (!data) return null;
    const message = data.message ?? null;
    if (!message) return null;
    void setCache(`crossref:${id}`, message);
    logDebug("parsed Crossref payload", {
      updateTo: message["update-to"],
      assertion: message["assertion"]
    });
    return message;
  } catch (error) {
    logDebug("fetchCrossrefMessage error", error);
    return null;
  }
}
function detectAlertFromMessage(message) {
  const relation = message.relation;
  if (relation && typeof relation === "object") {
    for (const [key, value] of Object.entries(relation)) {
      const normalizedKey = key.toLowerCase();
      let status = null;
      if (normalizedKey.includes("retract")) status = "retracted";
      else if (normalizedKey.includes("withdraw")) status = "withdrawn";
      else if (normalizedKey.includes("expression")) status = "expression_of_concern";
      if (status) {
        const entries = Array.isArray(value) ? value : [];
        const doiEntry = entries.find(
          (entry) => entry && typeof entry === "object" && typeof entry["id-type"] === "string" && entry["id-type"].toLowerCase() === "doi"
        );
        const idVal = doiEntry?.id;
        return {
          status,
          label: key,
          noticeUrl: typeof idVal === "string" ? idVal : void 0
        };
      }
    }
  }
  const assertions = message.assertion ?? [];
  const updateTo = message["update-to"] ?? [];
  const texts = [];
  if (Array.isArray(assertions)) {
    for (const a of assertions) {
      if (a && typeof a === "object") {
        const label = a.label;
        const value = a.value;
        if (typeof label === "string") texts.push(label);
        if (typeof value === "string") texts.push(value);
      }
    }
  }
  if (Array.isArray(updateTo)) {
    for (const u of updateTo) {
      if (u && typeof u === "object") {
        const label = u.label;
        const type = u.type;
        const doi = u.DOI;
        const status = mapStatusFromLabel(label || type || "");
        if (status !== "ok") {
          return { status, label: label || type || "", noticeUrl: doi };
        }
      }
    }
  }
  const alert = findAlertInTexts(texts);
  if (alert) return { status: alert.status, label: alert.match };
  const policies = message["update-policy"] ?? [];
  const policiesArr = Array.isArray(policies) ? policies : [];
  const policyAlert = findAlertInTexts(policiesArr);
  if (policyAlert) return { status: policyAlert.status, label: policyAlert.match };
  return { status: "ok" };
}
async function checkStatus(id) {
  if (!id.startsWith("10.")) return { status: "unknown" };
  const normalizedId = id.toLowerCase();
  if (normalizedId.includes("osf.io/")) {
    return { status: "unknown" };
  }
  const cached = await getCache(`status:${id}`);
  if (cached) {
    logDebug("using cached status", id);
    return cached;
  }
  logDebug("checkStatus fetch start", { id });
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
async function checkReferences(doi, onProgress, additionalDois = []) {
  const message = await fetchCrossrefMessage(doi);
  const references = message?.reference ?? [];
  const refList = Array.isArray(references) ? references : [];
  const crossrefDois = refList.map((ref) => {
    if (!ref || typeof ref !== "object") return null;
    const doiValue = ref.DOI;
    if (typeof doiValue === "string" && doiValue.startsWith("10."))
      return doiValue;
    return null;
  }).filter((val) => Boolean(val));
  const extraDois = (additionalDois || []).filter((d) => d.startsWith("10."));
  const combinedDois = Array.from(/* @__PURE__ */ new Set([...crossrefDois, ...extraDois]));
  if (!message && combinedDois.length === 0) {
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
        unknown: 1
      }
    };
  }
  logDebug("checking references", {
    totalFound: crossrefDois.length + extraDois.length,
    checking: combinedDois.length
  });
  const results = [];
  let checked = 0;
  let failedChecks = 0;
  let index = 0;
  const counts = {
    ok: 0,
    retracted: 0,
    withdrawn: 0,
    expression_of_concern: 0,
    unknown: 0
  };
  const worker = async () => {
    while (index < combinedDois.length) {
      const current = index++;
      const refDoi = combinedDois[current];
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
          title: status.title
        });
      } else {
        counts.ok += 1;
      }
      onProgress(checked, combinedDois.length);
    }
  };
  const concurrency = Math.min(
    MAX_REFERENCE_CONCURRENCY,
    combinedDois.length || 1
  );
  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);
  return {
    alerts: results,
    checked,
    totalFound: crossrefDois.length + extraDois.length,
    failedChecks,
    counts
  };
}

// src/doi.ts
function extractDoiFromHref(href) {
  try {
    const decoded = decodeURIComponent(href);
    const match = decoded.match(/10\.\d{4,9}\/[^\s"'>?#)]+/);
    if (!match) return null;
    return match[0].replace(/[\].]+$/, "");
  } catch {
    return null;
  }
}
function mapPublisherUrlToDoi(href) {
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

// src/news.ts
var NEWS_HOSTS = [
  "abc.net.au",
  "elpais.com",
  "elmundo.es",
  "lavanguardia.com",
  "faz.net",
  "globo.com",
  "corriere.it",
  "lemonde.fr",
  "lefigaro.fr",
  "lastampa.it",
  "repubblica.it",
  "bild.de",
  "zeit.de",
  "spiegel.de",
  "theage.com.au",
  "telegraph.co.uk",
  "independent.co.uk",
  "thetimes.co.uk",
  "wsj.com",
  "theguardian.com",
  "nytimes.com",
  "washingtonpost.com",
  "economist.com",
  "ft.com",
  "bbc.com",
  "reuters.com",
  "latimes.com",
  "nbcnews.com",
  "cnn.com"
];
var SCIENCE_HOSTS = [
  "doi.org",
  "nature.com",
  "thelancet.com",
  "science.org",
  "sciencedirect.com",
  "link.springer.com",
  "onlinelibrary.wiley.com",
  "tandfonline.com",
  "jamanetwork.com",
  "nejm.org",
  "bmj.com",
  "journals.plos.org",
  "pubs.acs.org",
  "ieeexplore.ieee.org",
  "dl.acm.org",
  "arxiv.org",
  "biorxiv.org",
  "medrxiv.org",
  "academic.oup.com",
  "psycnet.apa.org",
  "cambridge.org"
];
async function handleNewsPage(hostname, citations) {
  const isNews = NEWS_HOSTS.some((h) => hostname.includes(h));
  if (!isNews) return false;
  const anchors = Array.from(
    document.querySelectorAll("a[href]")
  );
  const candidateDois = /* @__PURE__ */ new Set();
  anchors.forEach((a) => {
    try {
      const url = new URL(a.href, location.href);
      if (SCIENCE_HOSTS.some((h) => url.hostname.includes(h))) {
        let doi = extractDoiFromHref(url.href) || mapPublisherUrlToDoi(url.href);
        if (!doi) {
          const redirect = url.searchParams.get("redirect_uri");
          if (redirect) {
            const decoded = decodeURIComponent(redirect);
            doi = extractDoiFromHref(decoded) || mapPublisherUrlToDoi(decoded);
          }
        }
        if (doi) candidateDois.add(doi);
      }
    } catch {
    }
  });
  if (candidateDois.size === 0) {
    setWrapperVisibility(false);
    return true;
  }
  setWrapperVisibility(true);
  updateBanner(citations, {
    bg: COLORS.warning,
    lines: ["Checking linked articles..."]
  });
  const results = [];
  const referenceAlerts = [];
  let referenceFailedChecks = 0;
  let unknown = 0;
  for (const doi of candidateDois) {
    const status = await checkStatus(doi);
    if (status.status === "unknown") {
      unknown += 1;
    } else if (ALERT_STATUSES.has(status.status)) {
      results.push({
        id: doi,
        status: status.status,
        noticeUrl: status.noticeUrl,
        title: status.title
      });
    }
    const referenceResult = await checkReferences(doi, updateReferenceProgress);
    referenceFailedChecks += referenceResult.failedChecks;
    if (referenceResult.alerts.length) {
      referenceAlerts.push(
        ...referenceResult.alerts.map((alert) => ({
          id: alert.id,
          status: alert.status,
          noticeUrl: alert.noticeUrl,
          title: alert.title ? `${alert.title} (cited by ${doi})` : `${alert.id} (cited by ${doi})`
        }))
      );
    }
  }
  const counts = {
    ok: candidateDois.size - results.length - unknown,
    retracted: results.filter((r) => r.status === "retracted").length,
    withdrawn: results.filter((r) => r.status === "withdrawn").length,
    expression_of_concern: results.filter(
      (r) => r.status === "expression_of_concern"
    ).length,
    unknown
  };
  const allAlerts = [...results, ...referenceAlerts];
  let mailto = null;
  if (allAlerts.length) {
    const newsDomain = NEWS_HOSTS.find((h) => hostname.includes(h)) || hostname;
    const recipient = Object.entries(NEWS_CONTACTS).find(
      ([host]) => newsDomain.includes(host)
    )?.[1] ?? "";
    const subject = `Retracted/flagged study linked on ${newsDomain}`;
    const bodyLines = [
      `Hi,`,
      "",
      `On ${newsDomain} page: ${location.href}`,
      `These linked studies appear retracted/flagged:`,
      ...allAlerts.map(
        (r) => `- ${r.title || r.id} (${r.status}): https://doi.org/${r.id}`
      ),
      "",
      "Sent via Retraction Alert",
      SUPPORT_URL
    ];
    const body = bodyLines.join("\n");
    mailto = `mailto:${encodeURIComponent(recipient)}?subject=${encodeURIComponent(
      subject
    )}&body=${encodeURIComponent(body)}`;
  }
  updateBanner(citations, {
    bg: allAlerts.length ? COLORS.danger : unknown || referenceFailedChecks ? COLORS.warning : COLORS.ok,
    lines: [
      countsSummary(
        "Linked articles",
        counts,
        candidateDois.size,
        unknown + referenceFailedChecks
      ),
      ...referenceAlerts.length ? [`Flagged references found in linked papers: ${referenceAlerts.length}`] : []
    ],
    alerts: allAlerts
  });
  if (mailto) {
    const actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.justifyContent = "center";
    actions.style.width = "100%";
    actions.style.marginTop = "6px";
    const button = document.createElement("button");
    button.textContent = "Email editor";
    button.style.border = "none";
    button.style.cursor = "pointer";
    button.style.background = COLORS.link;
    button.style.color = "#4e342e";
    button.style.fontWeight = "bold";
    button.style.padding = "6px 10px";
    button.style.borderRadius = "6px";
    button.style.boxShadow = "0 1px 3px rgba(0,0,0,0.2)";
    button.addEventListener("click", (e) => {
      e.preventDefault();
      window.location.href = mailto;
    });
    actions.appendChild(button);
    citations.appendChild(actions);
  }
  logDebug("News page processed", { candidateDois: candidateDois.size, alerts: allAlerts.length });
  return true;
}

// tests/handlers/news.test.ts
async function loadAndTest(url) {
  const html = await fetch(url).then((r) => r.text());
  const dom = new JSDOM(html, { url });
  global.window = dom.window;
  global.document = dom.window.document;
  global.location = dom.window.location;
  clearUiState();
  const citations = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(citations);
  const handled = await handleNewsPage(dom.window.location.hostname, citations);
  assert.equal(handled, true, "news handler should handle this page");
  return citations;
}
async function run() {
  const noRetractionsUrl = "https://www.theguardian.com/environment/2025/nov/28/africa-forests-transformed-carbon-sink-carbon-source-study";
  const citationsA = await loadAndTest(noRetractionsUrl);
  assert.ok(
    citationsA.textContent?.includes("Linked articles"),
    "expected linked articles summary"
  );
  const hasRetractionUrl = "https://www.theguardian.com/environment/2024/apr/17/climate-crisis-average-world-incomes-to-drop-by-nearly-a-fifth-by-2050";
  const citationsB = await loadAndTest(hasRetractionUrl);
  assert.ok(
    citationsB.textContent?.toLowerCase().includes("retract"),
    "expected retraction mention in linked articles"
  );
  console.log("\u2713 news handler checks passed");
}
if (import.meta.url === `file://${process.argv[1]}`) {
  void run();
}
export {
  run
};
