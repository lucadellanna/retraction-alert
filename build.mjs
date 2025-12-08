import { rmSync, mkdirSync, cpSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";

const root = process.cwd();
const distDir = resolve(root, "dist");
const publicDir = resolve(root, "public");

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

cpSync(publicDir, distDir, { recursive: true });

console.log("Build complete. Load dist/ as the unpacked extension.");
