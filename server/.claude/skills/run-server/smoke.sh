#!/usr/bin/env bash
# Signs up, follows a feed and reads its newest entry back through the API of the server start.sh runs, then
# summarizes and translates that entry (answering code 5 when AI is not configured).
set -euo pipefail
PORT=${PORT:-3100}
STATE=${YANRR_RUN_DIR:-${TMPDIR:-${TEMP:-/tmp}}/yanrr-run}
FEED=${1:-https://blog.rust-lang.org/feed.xml}
API=http://127.0.0.1:$PORT/api
JAR=$STATE/cookies.txt

call() {
  curl -sS --noproxy '*' -b "$JAR" -c "$JAR" -H "Origin: http://127.0.0.1:$PORT" \
    -H 'Content-Type: application/json' -X "$1" "$API$2" ${3:+-d "$3"}
}

account='"email":"run@example.com","password":"correct-horse-battery"'
call POST /better-auth/sign-up/email "{$account,\"name\":\"run\"}" >/dev/null
call POST /better-auth/sign-in/email "{$account}" >/dev/null
echo "== follow $FEED"
call POST /subscriptions "{\"url\":\"$FEED\",\"view\":0}" | head -c 200; echo
ENTRY=$(call POST /entries '{"limit":1}' | grep -o '"entries":{"id":"[0-9]*"' | head -1 | grep -o '[0-9]\{6,\}')
echo "== newest entry $ENTRY"
call GET "/entries?id=$ENTRY" | head -c 300; echo
echo "== AI summary"
call GET "/ai/summary?id=$ENTRY&language=en" | head -c 600; echo
echo "== AI translation"
call POST /ai/translation/batch "{\"ids\":[\"$ENTRY\"],\"language\":\"zh-CN\",\"fields\":\"title,description\"}"
echo
