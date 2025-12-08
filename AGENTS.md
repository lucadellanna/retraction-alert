# Repository Guidelines

## Project Structure & Module Organization
- `src/`: TypeScript sources. `content-script.ts` injects banners and handles link/DOI logic; `background.ts` expands go.nature.com links to avoid CORS blocks.
- `public/`: Manifest and static assets (`manifest.json`, `icon-128.png`).
- `dist/`: Build output (unpacked extension). Auto-created by `npm run build`.
- `scripts/`, `build.mjs`: Build tooling. `build.mjs` bundles both content script and background.
- `retraction-alert.zip`: Packaged extension for store upload (auto-updated on build).

## Build, Test, and Development Commands
- `npm run build`: Bundles with esbuild, copies `public/` to `dist/`, and zips `dist/` to `retraction-alert.zip`. Use before loading as an unpacked extension.
- There are no automated tests yet; manual verification is done by loading `dist/` in Chrome (developer mode).

## Coding Style & Naming Conventions
- Language: TypeScript targeting ES2020.
- Formatting: 2-space indentation, prefer concise functions and explicit types on exports. Keep comments minimal and purposeful.
- Naming: camelCase for variables/functions, PascalCase for types/interfaces. Use clear, descriptive names (e.g., `fetchWork`, `checkCitedRetractedFromWorks`).

## Testing Guidelines
- No test suite currently. For manual checks:
  - Load `dist/` as an unpacked extension.
  - Visit known URLs: `doi.org/<doi>`, `pubmed.ncbi.nlm.nih.gov/<pmid>`, `orcid.org/<id>`, and news pages with scientific links (e.g., X/Twitter posts with go.nature.com shortlinks).
  - Verify banners (red for retracted/flagged, green for clean, yellow during checks) and console logs `[RetractionAlert]`.

## Commit & Pull Request Guidelines
- Commits: Prefer clear, imperative subjects (e.g., “Add go.nature.com expansion via background worker”). Keep changes focused.
- PRs: Include a short description of scope, key changes, manual test notes (URLs visited), and any screenshots of banners if UI-affecting. Link issues where applicable.

## Security & Configuration Tips
- Host permissions are minimal: Crossref, ORCID, go.nature.com. Avoid adding broad permissions without discussion.
- Background fetch is restricted to go.nature.com shortlink expansion. Keep any new network calls narrow and justified.

## Agent-Specific Instructions
- Reuse existing helpers before adding new ones (e.g., `extractDoiFromHref`, `mapPublisherUrlToDoi`, cache utilities).
- Update `build.mjs`/manifest when adding new entry points or permissions.
- Keep console logging under the `[RetractionAlert]` prefix and avoid noisy repeated logs.***
