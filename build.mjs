import { rmSync, mkdirSync, cpSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const distDir = resolve(root, "dist");
const publicDir = resolve(root, "public");
const zipPath = resolve(root, "retraction-alert.zip");

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

await build({
  entryPoints: [resolve(root, "src/content-script.ts")],
  outfile: resolve(distDir, "content-script.js"),
  bundle: true,
  format: "iife",
  target: "es2020",
  minify: false
});

await build({
  entryPoints: [resolve(root, "src/background.ts")],
  outfile: resolve(distDir, "background.js"),
  bundle: true,
  format: "iife",
  target: "es2020",
  minify: false
});

cpSync(publicDir, distDir, { recursive: true });

// Package the dist contents for store upload
if (existsSync(zipPath)) rmSync(zipPath);
const zipResult = spawnSync("zip", ["-r", zipPath, "."], {
  cwd: distDir,
  stdio: "inherit"
});
if (zipResult.status !== 0) {
  console.warn("Zip step failed; ensure `zip` is available in PATH.");
} else {
  console.log(`Packaged ${zipPath}`);
}

console.log("Build complete. Load dist/ as the unpacked extension.");
