# Privacy Policy — Retraction Alert (Chrome Extension)

Effective date: 2024-12-08

## What the extension does
Retraction Alert reads the current page to extract article identifiers (DOI/PMID), checks their status via Crossref, and shows banners if the current article or its citations are retracted/withdrawn/flagged.

## Data the extension accesses
- Page content: Only to extract DOIs/PMIDs and, if available, the corresponding-author email (for the optional mailto draft when cited retractions are found).
- Network: Sends DOIs to `https://api.crossref.org` to retrieve retraction-related metadata for the current article and its cited references.

## What is NOT collected or stored
- No personal data is collected, stored, sold, or shared.
- No analytics or tracking.
- No external servers beyond `api.crossref.org` are contacted.

## Permissions
- Content scripts on supported scholarly domains: Needed to read page content for DOIs/PMIDs.
- Host permission `https://api.crossref.org/*`: Needed to fetch retraction status and reference metadata.

## Email helper
If retracted citations are found and a corresponding-author email is present on the page, the extension offers a mailto draft. The email is only used locally to prefill the mailto link; it is not sent anywhere else.

## Security and storage
- The extension does not persist data locally beyond what Chrome stores for normal extension operation.
- All processing happens locally except for the API calls to Crossref with the DOIs.

## Contact
For questions or concerns: https://Luca-Dellanna.com/contact
