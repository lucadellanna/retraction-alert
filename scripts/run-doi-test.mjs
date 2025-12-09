import { build } from "esbuild";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(tmpdir(), "retraction-alert-test-"));
const outfile = resolve(outDir, "crossref-status.test.js");

await build({
  entryPoints: [resolve(root, "tests/crossref-status.test.ts")],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "esm",
  outfile,
});

execFileSync("node", [outfile], { stdio: "inherit" });
