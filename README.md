# Retraction Alert (Chrome Extension)

Warns you when the current article—or any of its cited papers—has been retracted, withdrawn, or flagged with an expression of concern.

## What it does
- Automatically runs on top scholarly venues and major news sites worldwide (e.g., doi.org, PubMed, CDC, Nature/Science/Lancet/NEJM/JAMA/PNAS, CVPR/ICCV/NeurIPS/ICLR/ICML, Springer/Wiley/Elsevier, arXiv/bioRxiv/medRxiv, and leading global news outlets such as NYT/Guardian/BBC/CNN/Reuters/Fox/Bloomberg).
- Extracts the DOI/PMID from the page (meta tags, URL patterns, or doi.org itself).
- Queries Crossref (Retraction Watch/assertions/update-to) to determine status.
- Shows a unified banner with inline progress; red if the article or citations are flagged, green if clear, neutral if unknown.
- Fetches references and checks each cited DOI; highlights sentences containing flagged citations (articles/news/LinkedIn).
- On flagged citations, shows an “Email corresponding author” button when an email is discoverable; link is prefilled with flagged references.
- ORCID/Scholar support: detects Scholar profiles, links to ORCID, and runs checks on ORCID works and their cited works.

## Project structure
- `public/manifest.json` – MV3 config, host matches, permissions.
- `src/content-script.ts` – all logic (detection, Crossref checks, banners, email link).
- `build.mjs` – esbuild bundler; copies `public` to `dist`.
- `tsconfig.json` – strict TS, ES2020 target, noEmit (esbuild handles output).
- `package.json` – dev deps: `esbuild`, `typescript`, `@types/chrome`.
- `public/icon-128.png` – placeholder icon.
- `dist/` – build output (unpacked extension).

## Install & build
1) `npm install`
2) `npm run build`
3) Load unpacked: Chrome → `chrome://extensions` → Developer Mode → “Load unpacked” → select `dist/`.

## Usage
- Visit an article page; banners appear automatically:
  - Red (top): current article retracted/withdrawn/concerned (link if available).
  - Yellow (below) while citations are being checked.
  - Red (references): cited retractions found (links shown).
  - Green (references): “Checked X of Y citations: no retractions found.”
- If cited retractions are found and a corresponding-author email is detected, click “Email corresponding author” to open a prefilled mailto.

## Notes & limits
- Relies on Crossref metadata; some publishers may omit references/DOIs in Crossref.
- Reference checks de-duplicate DOIs; runs on all found references (may take time on very long bibliographies).
- For PMIDs, only the current page is checked (references still rely on DOIs).
- Permissions are minimal: content script matches + `https://api.crossref.org/*` for lookup.
- Best-effort indicator only: Based on Crossref data; verify status with the publisher/journal. Not legal/medical advice.

## Extending
- Add more domains by updating `public/manifest.json` and, if needed, a small URL parser in `src/content-script.ts` (prefer meta `citation_doi` when available).
- Swap out `checkStatus`/Crossref with your backend/API when ready.
- Improve email extraction with more robust selectors if target sites differ.

## Privacy & support
- Privacy: The extension reads the current page to extract DOIs/PMIDs and fetches status data from Crossref. No data is stored or sent elsewhere.
- Support/contact: https://Luca-Dellanna.com/contact
