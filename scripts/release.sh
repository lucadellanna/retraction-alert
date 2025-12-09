#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VERSION="$(node -p "require('./package.json').version")"
TAG="v${VERSION}"
ZIP_PATH="${ROOT}/retraction-alert.zip"

echo "Preparing release ${TAG}"

echo "Building fresh artifact..."
npm run build >/dev/null

if [[ ! -f "${ZIP_PATH}" ]]; then
  echo "Build did not produce ${ZIP_PATH}. Aborting."
  exit 1
fi

if git rev-parse "${TAG}" >/dev/null 2>&1; then
  echo "Tag ${TAG} already exists locally."
else
  echo "Creating tag ${TAG}..."
  git tag -a "${TAG}" -m "Release ${TAG}"
fi

if command -v gh >/dev/null 2>&1; then
  echo "Creating GitHub release ${TAG} with ${ZIP_PATH}..."
  gh release create "${TAG}" "${ZIP_PATH}" --title "${TAG}" --notes "Release ${TAG}" --verify-tag || {
    echo "GitHub release failed. Ensure the tag is pushed and gh is authenticated."
    exit 1
  }
  echo "Release ${TAG} created."
else
  echo "gh CLI not found. To publish:"
  echo "  git push origin ${TAG}"
  echo "  gh release create ${TAG} ${ZIP_PATH} --title \"${TAG}\" --notes \"Release ${TAG}\""
fi
