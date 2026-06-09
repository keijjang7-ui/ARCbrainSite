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

echo "Pushing to remote..."
BRANCH="$(git branch --show-current)"
git push -u origin "$BRANCH"
PUSH_STATUS=$?

if [[ $PUSH_STATUS -eq 0 ]]; then
  echo "Deploy push complete. Vercel should start from the pushed commit."
else
  echo "Push failed."
fi

exit $PUSH_STATUS
