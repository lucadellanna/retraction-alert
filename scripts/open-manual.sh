#!/usr/bin/env bash
set -euo pipefail

URLS=(
  "https://www.theguardian.com/environment/2025/nov/28/africa-forests-transformed-carbon-sink-carbon-source-study"
  "https://www.theguardian.com/environment/2024/apr/17/climate-crisis-average-world-incomes-to-drop-by-nearly-a-fifth-by-2050"
  "https://www.nature.com/articles/s41586-024-07219-0#citeas"
  "https://pubmed.ncbi.nlm.nih.gov/39170312/"
  "https://scholar.google.com/scholar?cites=7181054636392857341"
  "https://scholar.google.com/citations?user=KnlmZ6EAAAAJ"
  "https://orcid.org/0000-0003-2564-5043"
)

echo "Opening ${#URLS[@]} pages for manual testing..."
for url in "${URLS[@]}"; do
  echo "  -> $url"
  open "$url"
done
