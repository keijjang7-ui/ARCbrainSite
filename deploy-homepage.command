#!/bin/zsh

cd "$(dirname "$0")" || exit 1

echo "Checking homepage changes..."

if [[ -z "$(git status --short)" ]]; then
  echo "No changes to deploy."
  exit 0
fi

echo "Staging changes..."
git add .

echo "Creating commit..."
git commit -m "Update homepage"
COMMIT_STATUS=$?

if [[ $COMMIT_STATUS -ne 0 ]]; then
  echo "Commit failed. Push skipped."
  exit $COMMIT_STATUS
fi

BRANCH="$(git branch --show-current)"
if [[ -z "$BRANCH" ]]; then
  echo "Could not determine the current git branch."
  exit 1
fi

echo "Syncing with remote..."
git fetch origin "$BRANCH"
FETCH_STATUS=$?

if [[ $FETCH_STATUS -ne 0 ]]; then
  echo "Fetch failed. Push skipped."
  exit $FETCH_STATUS
fi

if git rev-parse --verify "origin/$BRANCH" >/dev/null 2>&1; then
  git rebase "origin/$BRANCH"
  REBASE_STATUS=$?

  if [[ $REBASE_STATUS -ne 0 ]]; then
    echo "Rebase failed. Resolve conflicts, then run this command again."
    exit $REBASE_STATUS
  fi
fi

echo "Pushing to remote..."
git push -u origin "$BRANCH"
PUSH_STATUS=$?

if [[ $PUSH_STATUS -eq 0 ]]; then
  echo "Deploy push complete. Vercel should start from the pushed commit."
else
  echo "Push failed."
fi

exit $PUSH_STATUS
