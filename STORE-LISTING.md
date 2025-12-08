# Retraction Alert — Chrome Web Store Listing Draft

**Short description**  
Warns when the article being viewed—or any of its citations—has been retracted or flagged.

**Long description**  
Retraction Alert automatically checks scholarly articles for retraction status using Crossref (Retraction Watch/assertions/update-to).  
• Shows a clear red banner if the current article is retracted/withdrawn/flagged.  
• Scans cited references (DOIs) via Crossref: shows a yellow progress bar while checking, then a red banner if any cited papers are flagged, or a green banner if all checked are clear.  
• If flagged citations exist and a corresponding-author email is found, offers a one-click “Email corresponding author” mailto draft listing the retracted citations.  
• Runs automatically: no pop-up or background UI needed.

**Supported sites**  
doi.org, PubMed, Nature, Lancet, Science, ScienceDirect, Springer, Wiley, Taylor & Francis, JAMA, NEJM, BMJ, PLOS, ACS, IEEE, ACM, arXiv, bioRxiv, medRxiv, OSF.

**Privacy**  
Retraction Alert reads the current page to extract DOIs/PMIDs and fetches status data from https://api.crossref.org. It does not collect, store, or share user data.

**Support**  
https://Luca-Dellanna.com/contact

**Disclaimer**  
Best-effort indicator based on Crossref data; verify status with the publisher/journal. Not legal/medical advice.

---

## Chrome Web Store “Privacy” tab helpers

**Single purpose**  
Alerts when the current article—or any of its cited papers—is retracted/withdrawn/flagged, using Crossref metadata.

**Permission justification**

- Content scripts on scholarly domains: needed to extract the DOI/PMID from the page (meta tags/URL) to determine retraction status.
- Host permission `https://api.crossref.org/*`: needed to query Crossref for retraction/withdrawal/expression-of-concern signals for the article and its cited references.

**Data usage**

- Reads the current page only to extract DOI/PMID.
- Sends those identifiers to api.crossref.org to fetch status and references.
- Does not collect, store, or share user data; no analytics, no tracking.

**Privacy policy URL**  
Point to `privacy.md` in this repo (e.g., raw GitHub URL after publishing):  
`https://raw.githubusercontent.com/lucadellanna/retraction-alert/main/privacy.md`
