import { COLORS } from "./colors";

type HighlightOptions = {
  dangerColor?: string;
  textColor?: string;
  className?: string;
};

/**
 * Highlights the sentence containing the given element. Falls back to
 * highlighting the element itself if wrapping the sentence fails.
 */
export function highlightSentence(
  el: Element | null,
  options: HighlightOptions = {}
): void {
  if (!el) return;

  const danger = options.dangerColor ?? COLORS.danger;
  const text = options.textColor ?? COLORS.textLight;
  const SENTENCE_CLASS = options.className ?? "ra-highlight-sentence";
  const highlighted = new Set<HTMLElement>();

  const highlightAnchorOnly = (node: Element | null) => {
    const target =
      (node as HTMLElement | null) ||
      (node?.parentElement as HTMLElement | null);
    if (!target || highlighted.has(target)) return;
    target.style.backgroundColor = danger;
    target.style.color = text;
    target.style.padding = "1px 4px";
    target.style.borderRadius = "4px";
    target.style.display = "inline-block";
    target.style.textDecoration = "none";
    if (target instanceof HTMLAnchorElement) {
      target.style.color = text;
    }
    highlighted.add(target);
  };

  const findTextPosition = (
    nodes: Text[],
    targetOffset: number
  ): { node: Text; offset: number } | null => {
    let acc = 0;
    for (const n of nodes) {
      const len = n.textContent?.length || 0;
      if (acc + len >= targetOffset) {
        return { node: n, offset: Math.max(0, targetOffset - acc) };
      }
      acc += len;
    }
    const last = nodes[nodes.length - 1];
    if (!last) return null;
    return { node: last, offset: last.textContent?.length || 0 };
  };

  const highlight = (node: Element | null) => {
    if (!node) return;
    const container =
      node.closest<HTMLElement>("p, li, div") || node.parentElement;
    if (!container || container.closest(`.${SENTENCE_CLASS}`)) return;

    const textContent = container.textContent || "";
    if (!textContent.trim()) return;

    const beforeCount =
      container.querySelectorAll(`.${SENTENCE_CLASS}`).length;

    const rangeToAnchor = document.createRange();
    try {
      rangeToAnchor.setStart(container, 0);
      rangeToAnchor.setEnd(node, 0);
    } catch {
      highlightAnchorOnly(node);
      return;
    }
    const anchorStart = rangeToAnchor.toString().length;
    const anchorLen = (node.textContent || "").length;
    const anchorEnd = anchorStart + anchorLen;

    const prevBreak = Math.max(
      textContent.lastIndexOf(".", anchorStart - 1),
      textContent.lastIndexOf("?", anchorStart - 1),
      textContent.lastIndexOf("!", anchorStart - 1),
      textContent.lastIndexOf(";", anchorStart - 1),
      textContent.lastIndexOf("\n", anchorStart - 1)
    );
    let sentenceStart = prevBreak >= 0 ? prevBreak + 1 : 0;
    while (
      sentenceStart < textContent.length &&
      /\s/.test(textContent[sentenceStart])
    ) {
      sentenceStart += 1;
    }

    const nextBreakCandidates = [
      textContent.indexOf(".", anchorEnd),
      textContent.indexOf("?", anchorEnd),
      textContent.indexOf("!", anchorEnd),
      textContent.indexOf(";", anchorEnd),
      textContent.indexOf("\n", anchorEnd),
    ].filter((v) => v >= 0);
    const nextBreak = nextBreakCandidates.length
      ? Math.min(...nextBreakCandidates)
      : -1;
    let sentenceEnd = nextBreak >= 0 ? nextBreak + 1 : textContent.length;
    while (sentenceEnd > sentenceStart && /\s/.test(textContent[sentenceEnd - 1])) {
      sentenceEnd -= 1;
    }

    const walker = document.createTreeWalker(
      container,
      NodeFilter.SHOW_TEXT
    );
    const textNodes: Text[] = [];
    let n: Node | null = walker.nextNode();
    while (n) {
      if (n.nodeType === Node.TEXT_NODE) textNodes.push(n as Text);
      n = walker.nextNode();
    }
    if (!textNodes.length) return;

    const startPos = findTextPosition(textNodes, sentenceStart);
    const endPos = findTextPosition(textNodes, sentenceEnd);
    if (!startPos || !endPos) {
      highlightAnchorOnly(node);
      return;
    }

    const sentenceRange = document.createRange();
    try {
      sentenceRange.setStart(startPos.node, startPos.offset);
      sentenceRange.setEnd(endPos.node, endPos.offset);
      const wrapper = document.createElement("span");
      wrapper.className = SENTENCE_CLASS;
      wrapper.style.backgroundColor = danger;
      wrapper.style.color = text;
      wrapper.style.borderRadius = "3px";
      wrapper.style.padding = "2px 4px";
      wrapper.style.lineHeight = "1.5";
      wrapper.style.display = "inline";
      wrapper.style.textDecoration = "none";
      sentenceRange.surroundContents(wrapper);
      wrapper.querySelectorAll("a").forEach((link) => {
        (link as HTMLAnchorElement).style.color = text;
      });
      if (
        container.querySelectorAll(`.${SENTENCE_CLASS}`).length === beforeCount
      ) {
        highlightAnchorOnly(node);
      }
    } catch {
      highlightAnchorOnly(node);
    }
  };

  highlight(el);
}
