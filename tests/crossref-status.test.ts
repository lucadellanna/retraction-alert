import { strict as assert } from "node:assert";
import { checkStatus } from "../src/crossref";

async function main(): Promise<void> {
  const doi = "10.1038/s41586-024-07219-0";
  const result = await checkStatus(doi);
  assert.equal(
    result.status,
    "retracted",
    `expected retracted, got ${result.status} (${result.label ?? "no label"})`
  );
  console.log("✓ crossref status check passed for", doi);
}

void main();
