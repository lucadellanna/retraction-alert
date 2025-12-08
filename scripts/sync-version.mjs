import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const pkgPath = resolve(root, "package.json");
const manifestPath = resolve(root, "public/manifest.json");

const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

manifest.version = pkg.version;

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Synced manifest version to ${pkg.version}`);
