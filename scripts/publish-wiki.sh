#!/usr/bin/env bash
# Publish docs/wiki/* to the GitHub Wiki remote.
# Prerequisite: create at least one wiki page once via the GitHub web UI
# so that https://github.com/<owner>/<repo>.wiki.git exists.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OWNER_REPO="${GITHUB_REPOSITORY:-calvin11527/crewtopus}"
WIKI_URL="https://github.com/${OWNER_REPO}.wiki.git"
TMP="$(mktemp -d)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

if ! git ls-remote "$WIKI_URL" &>/dev/null; then
  echo "Wiki git remote not found yet: $WIKI_URL"
  echo "Open https://github.com/${OWNER_REPO}/wiki/_new , save any page once, then re-run."
  exit 1
fi

git clone "$WIKI_URL" "$TMP/wiki"
# Copy pages (GitHub wiki uses Page-Name.md with hyphens)
rsync -a --delete --exclude .git "$ROOT/docs/wiki/" "$TMP/wiki/"
# Remove docs-only README from wiki root if present
rm -f "$TMP/wiki/README.md"
cd "$TMP/wiki"
git add -A
if git diff --cached --quiet; then
  echo "Wiki already up to date."
  exit 0
fi
git -c user.email="${GIT_AUTHOR_EMAIL:-15146190+calvin11527@users.noreply.github.com}" \
    -c user.name="${GIT_AUTHOR_NAME:-calvin11527}" \
    commit -m "Sync wiki from docs/wiki"
git push origin HEAD:master || git push origin HEAD:main
echo "Wiki published: https://github.com/${OWNER_REPO}/wiki"
