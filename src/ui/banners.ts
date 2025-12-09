import { AlertEntry, ArticleStatus } from "../types";
import { SUPPORT_URL } from "../constants";
import { logDebug } from "../log";
import { clearCaches } from "../cache";

export type AlertItem = AlertEntry;
export type BannerAction = { label: string; href: string; title?: string };
type BannerLineColor = string | undefined;
import { COLORS } from "./colors";

const STATE = {
  basePadding: 0,
  wrapper: null as HTMLDivElement | null,
  articleBanner: null as HTMLDivElement | null,
  citationsBanner: null as HTMLDivElement | null,
  visible: true,
};

export function clearUiState(): void {
  STATE.wrapper = null;
  STATE.articleBanner = null;
  STATE.citationsBanner = null;
}

function recalcPadding(): void {
  if (!STATE.wrapper) return;
  if (!STATE.visible) {
    document.body.style.paddingTop = `${STATE.basePadding}px`;
    return;
  }
  const height = STATE.wrapper.getBoundingClientRect().height;
  document.body.style.paddingTop = `${STATE.basePadding + height}px`;
}

export function injectCacheClearButton(container: HTMLElement): void {
  const spacer = document.createElement("div");
  spacer.style.flex = "1";
  spacer.style.minWidth = "12px";

  const btn = document.createElement("button");
  btn.textContent = "Clear cache";
  btn.style.border = "none";
  btn.style.cursor = "pointer";
  btn.style.background = COLORS.link;
  btn.style.color = "#4e342e";
  btn.style.fontWeight = "bold";
  btn.style.padding = "6px 10px";
  btn.style.borderRadius = "6px";
  btn.style.boxShadow = "0 1px 3px rgba(0,0,0,0.2)";
  btn.addEventListener("click", async (e) => {
    e.preventDefault();
    try {
      clearCaches();
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

export function removeProgressBanner(): void {
  const banner = document.getElementById("retraction-alert-ref-progress");
  if (banner) {
    banner.remove();
    recalcPadding();
  }
}

export function setWrapperVisibility(visible: boolean): void {
  if (!STATE.wrapper) return;
  STATE.visible = visible;
  STATE.wrapper.style.display = visible ? "flex" : "none";
  recalcPadding();
}

export function ensureBanners(): {
  wrapper: HTMLDivElement;
  article: HTMLDivElement;
  citations: HTMLDivElement;
} {
  if (STATE.wrapper && STATE.articleBanner && STATE.citationsBanner) {
    return {
      wrapper: STATE.wrapper,
      article: STATE.articleBanner,
      citations: STATE.citationsBanner,
    };
  }

  if (!STATE.basePadding) {
    STATE.basePadding =
      Number.parseFloat(window.getComputedStyle(document.body).paddingTop) || 0;
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

  const makeBanner = (): HTMLDivElement => {
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

export function ensureReferenceProgressBanner(): HTMLDivElement {
  const existing = document.getElementById(
    "retraction-alert-ref-progress"
  ) as HTMLDivElement | null;
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

export function updateReferenceProgress(done: number, total: number): void {
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
      removeProgressBanner();
    }, 400);
  }
}

export function updateBanner(
  banner: HTMLDivElement,
  options: {
    bg: string;
    lines: string[];
    alerts?: AlertItem[];
    actions?: BannerAction[];
    textColor?: string;
    lineColors?: BannerLineColor[];
  }
): void {
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

export function statusLabel(status: ArticleStatus): string {
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

export function countsSummary(
  label: string,
  counts: Record<ArticleStatus, number>,
  total: number,
  failed: number
): string {
  return `${label}: ${total} total • retracted ${
    counts.retracted
  } • withdrawn ${counts.withdrawn} • expression of concern ${
    counts.expression_of_concern
  } • unknown/failed ${Math.max(counts.unknown, failed)}`;
}

export function createEmailLink(
  id: string,
  target: string | undefined,
  alerts: AlertItem[]
): string {
  const subject = encodeURIComponent(`Retracted/flagged research noticed`);
  const lines: string[] = [];
  lines.push(`Article: ${id}`);
  lines.push("");
  if (alerts.length) {
    lines.push("Flagged citations:");
    for (const alert of alerts) {
      lines.push(
        `- ${alert.title ? `${alert.title} (${alert.id})` : alert.id} [${statusLabel(
          alert.status
        )}]`
      );
    }
  }
  lines.push("");
  lines.push("Via Retraction Alert.");
  lines.push(SUPPORT_URL);
  const body = encodeURIComponent(lines.join("\n"));
  return `mailto:${target ?? ""}?subject=${subject}&body=${body}`;
}

function buildAlertList(alerts: AlertItem[]): HTMLElement {
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
    badge.style.background =
      a.status === "ok"
        ? "#2e7d32"
        : a.status === "expression_of_concern"
        ? "#ef6c00"
        : COLORS.danger;
    badge.style.color = "#fff";
    badge.style.fontWeight = "bold";
    row.appendChild(badge);

    const link = document.createElement("a");
    link.href = `https://doi.org/${a.id}`;
    link.textContent = a.title ? `${a.title} (${a.id})` : a.id;
    link.target = "_blank";
    link.rel = "noreferrer noopener";
    link.style.color = COLORS.textLight;
    link.style.textDecoration = "underline";
    row.appendChild(link);

    if (a.noticeUrl) {
      const notice = document.createElement("a");
      notice.href = a.noticeUrl.startsWith("http")
        ? a.noticeUrl
        : `https://doi.org/${a.noticeUrl}`;
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
