import { strict as assert } from "node:assert";
import { JSDOM } from "jsdom";
import { handleNewsPage } from "../../src/news";
import { clearUiState } from "../../src/ui/banners";

async function loadAndTest(url: string): Promise<HTMLDivElement> {
  const html = await fetch(url).then((r) => r.text());
  const dom = new JSDOM(html, { url });
  // Set globals expected by handler/ui helpers.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).window = dom.window;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).document = dom.window.document;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).location = dom.window.location;

  clearUiState();
  const article = dom.window.document.createElement("div");
  const citations = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(article);
  dom.window.document.body.appendChild(citations);

  const handled = await handleNewsPage(
    dom.window.location.hostname,
    article as HTMLDivElement,
    citations
  );
  assert.equal(handled, true, "news handler should handle this page");
  return citations as HTMLDivElement;
}

export async function run(): Promise<void> {
  // 1) Page with valid study links (should find linked articles, no retractions)
  const noRetractionsUrl =
    "https://www.theguardian.com/environment/2025/nov/28/africa-forests-transformed-carbon-sink-carbon-source-study";
  const citationsA = await loadAndTest(noRetractionsUrl);
  assert.ok(
    citationsA.textContent?.includes("Linked articles"),
    "expected linked articles summary"
  );

  // 2) Page with a retracted study cited
  const hasRetractionUrl =
    "https://www.theguardian.com/environment/2024/apr/17/climate-crisis-average-world-incomes-to-drop-by-nearly-a-fifth-by-2050";
  const citationsB = await loadAndTest(hasRetractionUrl);
  assert.ok(
    citationsB.textContent?.toLowerCase().includes("retract"),
    "expected retraction mention in linked articles"
  );

  console.log("✓ news handler checks passed");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void run();
}
