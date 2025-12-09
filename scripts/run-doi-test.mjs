import { build } from "esbuild";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const baseTmp = join(root, ".tmp-tests");
rmSync(baseTmp, { recursive: true, force: true });
mkdirSync(baseTmp, { recursive: true });
const outDir = baseTmp;

function findTests(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findTests(full));
    } else if (entry.isFile() && entry.name.endsWith(".test.ts")) {
      files.push(full);
    }
  }
  return files;
}

const tests = findTests(resolve(root, "tests"));

for (const test of tests) {
  const name = test.split("/").pop()?.replace(".ts", ".js") ?? "test.js";
  const outfile = resolve(outDir, name);
  await build({
    entryPoints: [test],
    bundle: true,
    platform: "node",
    target: "node18",
    format: "esm",
    external: ["jsdom"],
    outfile,
  });
  execFileSync("node", [outfile], { stdio: "inherit" });
}
