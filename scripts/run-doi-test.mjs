import { build } from "esbuild";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(tmpdir(), "retraction-alert-test-"));

const tests = [
  "tests/crossref-status.test.ts",
  "tests/pubmed-references.test.ts",
];

for (const test of tests) {
  const name = test.split("/").pop()?.replace(".ts", ".js") ?? "test.js";
  const outfile = resolve(outDir, name);
  await build({
    entryPoints: [resolve(root, test)],
    bundle: true,
    platform: "node",
    target: "node18",
    format: "esm",
    outfile,
  });
  execFileSync("node", [outfile], { stdio: "inherit" });
}
