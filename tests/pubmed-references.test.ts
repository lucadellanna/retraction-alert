import { strict as assert } from "node:assert";
import { checkStatus, checkReferences } from "../src/crossref";

async function main(): Promise<void> {
  const articleDoi = "10.1007/s10668-019-00320-9";
  const citedRetractedDoi = "10.1038/s41586-024-07219-0";

  const articleStatus = await checkStatus(articleDoi);
  assert.notEqual(
    articleStatus.status,
    "retracted",
    `unexpected retraction for article ${articleDoi}`
  );

  const refs = await checkReferences(
    articleDoi,
    () => {},
    [citedRetractedDoi]
  );
  const found = refs.alerts.find(
    (a) => a.id.includes(citedRetractedDoi) && a.status === "retracted"
  );
  assert.ok(found, `expected cited retraction for ${citedRetractedDoi}`);
  console.log(
    "✓ pubmed-like reference check caught retracted citation",
    citedRetractedDoi
  );
}

void main();
