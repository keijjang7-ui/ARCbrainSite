#!/bin/zsh

cd "$(dirname "$0")" || exit 1

URL="http://127.0.0.1:8788/text-editor.html"
PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/Applications/Codex.app/Contents/Resources:$PATH"
NODE_BIN="$(command -v node)"

if [[ -z "$NODE_BIN" ]]; then
  echo "Node.js was not found."
  echo "Install Node.js, or add it to PATH, then run this file again."
  echo
  read -k 1 "reply?Press any key to close..."
  exit 1
fi

if ! curl -fsS "$URL" >/dev/null 2>&1; then
  "$NODE_BIN" editor-server.js &
  SERVER_PID=$!
  echo "Text editor server started with PID $SERVER_PID"

  for attempt in {1..30}; do
    if curl -fsS "$URL" >/dev/null 2>&1; then
      break
    fi
    sleep 0.2
  done
else
  echo "Text editor server is already running."
fi

if curl -fsS "$URL" >/dev/null 2>&1; then
  open "$URL"
else
  echo "The text editor server did not become available."
  echo "Check the messages above, then run this file again."
  echo
  read -k 1 "reply?Press any key to close..."
  exit 1
fi

echo
echo "Editor opened: $URL"
echo "Keep this window open while editing. Close it to stop the helper session if it started here."
echo

wait
