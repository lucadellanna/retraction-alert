import { ArticleStatus } from "./types";

export const ALERT_STATUSES: Set<ArticleStatus> = new Set([
  "retracted",
  "withdrawn",
  "expression_of_concern",
]);

export const MAX_REFERENCE_CONCURRENCY = 4;
export const MAX_REFERENCED_DOIS = 10000;
export const SUPPORT_URL = "https://Luca-Dellanna.com/contact";
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
export const UNKNOWN_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes for unknown results
export const CROSSREF_USER_AGENT =
  "RetractionAlert/0.3.0 (https://Luca-Dellanna.com/contact)";
export const CROSSREF_RATE_LIMIT_MS = 100; // ~10 req/s spacing
export const CROSSREF_MAX_RETRIES = 2;

export const NEWS_CONTACTS: Record<string, string> = {
  "wsj.com": "wsjcontact@wsj.com",
  "theguardian.com": "reader@theguardian.com",
  "nytimes.com": "letters@nytimes.com",
  "washingtonpost.com": "letters@washpost.com",
  "economist.com": "letters@economist.com",
  "ft.com": "customer.support@ft.com",
  "bbc.com": "haveyoursay@bbc.co.uk",
  "reuters.com": "editor@reuters.com",
  "latimes.com": "readers.rep@latimes.com",
  "nbcnews.com": "tips@nbcuni.com",
  "cnn.com": "cnntips@cnn.com",
  "abc.net.au": "",
  "elpais.com": "",
  "elmundo.es": "",
  "lavanguardia.com": "",
  "faz.net": "",
  "globo.com": "",
  "lemonde.fr": "",
  "lefigaro.fr": "",
  "lastampa.it": "",
  "repubblica.it": "",
  "bild.de": "",
  "zeit.de": "",
  "spiegel.de": "",
  "theage.com.au": "",
  "telegraph.co.uk": "",
  "independent.co.uk": "",
  "thetimes.co.uk": "",
};
