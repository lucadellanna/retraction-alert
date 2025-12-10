# Retraction Alert — Chrome Web Store Listing Draft

**Short description**  
Warns when the article being viewed—or any of its citations—has been retracted or flagged.

**Long description**  
Avoid citing or sharing retracted research and help keep the literature clean. Retraction Alert warns you when the page you’re reading—or the papers it cites—has been retracted, withdrawn, or flagged, and helps you follow up quickly.  
• Clear inline banner with progress while checks run; red if the article or any citations are flagged, green if clear, neutral if unknown.  
• Highlights sentences that cite flagged papers (articles, news, LinkedIn).  
• One-click “Email corresponding author” draft when flagged citations are found (prefilled with the problematic references).  
• ORCID/Scholar aware: links Scholar profiles to ORCID; on ORCID profiles, checks both works and cited works.  
• Auto-runs on supported sites; no pop-up needed.  
• Made by Luca Dellanna (https://Luca-Dellanna.com) — support the project at https://Luca-Dellanna.com/donate.

**Supported sites**  
Top scholarly venues and major news outlets worldwide: doi.org, PubMed, CDC, Nature/Science/Lancet/NEJM/JAMA/PNAS, CVPR/ICCV/NeurIPS/ICLR/ICML, Springer/Wiley/Elsevier/ACS/IEEE/ACM, arXiv/bioRxiv/medRxiv/OSF, plus leading global news sites (NYT, BBC/BBC.co.uk, Guardian, CNN, Reuters, Fox, Bloomberg, and many more).

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
`https://github.com/lucadellanna/retraction-alert/blob/main/privacy.md`
