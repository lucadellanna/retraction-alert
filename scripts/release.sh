#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

read -rp "Bump version before release? (patch/minor/major/skip) [skip]: " BUMP_CHOICE
BUMP_CHOICE="${BUMP_CHOICE:-skip}"
if [[ "$BUMP_CHOICE" =~ ^(patch|minor|major)$ ]]; then
  echo "Bumping version ($BUMP_CHOICE)..."
  npm version "$BUMP_CHOICE"
  echo "Version bumped."
elif [[ "$BUMP_CHOICE" != "skip" ]]; then
  echo "Invalid choice: $BUMP_CHOICE. Use patch, minor, major, or skip."
  exit 1
else
  echo "Skipping version bump."
fi

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
