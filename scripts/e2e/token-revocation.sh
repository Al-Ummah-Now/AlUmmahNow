#!/bin/zsh
# Token revocation end to end (#437), against a deployed environment.
#
#   RESEND_KEY_FILE=/path/to/key ./scripts/e2e/token-revocation.sh qa|prod
#
# For each scenario a throwaway test-rev-<ts>@delivered.resend.dev account is
# registered (code read from Resend; the key is only ever sent as a header):
#   A. delete the account          -> refresh fails, api-videos rejects the old access token
#   B. sign out of all devices     -> same; a fresh sign-in works again (then deleted)
# The access-token rejection is polled every 10 s up to BOUND_S (default 180).
# Prints timings only, never tokens. Exits non-zero on any failed expectation.
set -euo pipefail
ENVNAME=${1:-qa}
case $ENVNAME in
  # Viewer (desktop) client: loopback redirect; ids differ per environment (migration 0013)
  qa)   ISS=https://auth.qa.alummahnow.net; API=https://videos.api.qa.alummahnow.net; CID=ce7de8a4-59dd-4682-ab4d-105399105294 ;;
  prod) ISS=https://auth.alummahnow.net;    API=https://videos.api.alummahnow.net;    CID=f97abe68-ef61-41b6-bf08-d86650cc7cb3 ;;
  *) echo "usage: $0 qa|prod"; exit 2 ;;
esac
: ${RESEND_KEY_FILE:?set RESEND_KEY_FILE}
RED=http://127.0.0.1:53682/auth/callback
BOUND_S=${BOUND_S:-180}
# WORKDIR keeps the throwaway credentials (mode 700) so a failed run can be cleaned up
W=${WORKDIR:-$(mktemp -d)}; mkdir -p $W; chmod 700 $W
fail=0
enc() { python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1],safe=""))' "$1"; }
field() { python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get(sys.argv[2],""))' "$1" "$2"; }
check() { if [ "$2" = "$3" ]; then echo "  ok   $1 ($2)"; else echo "  FAIL $1: got $2, want $3"; fail=1; fi; }

# authorize + PKCE; leaves auth_flow in $W/$1.flow, verifier in $W/$1.ver
start_flow() {
  local d=$W/$1; rm -f $d.jar
  local ver=$(openssl rand -hex 32); print -rn -- $ver > $d.ver
  local ch=$(printf %s "$ver" | openssl dgst -sha256 -binary | openssl base64 | tr '+/' '-_' | tr -d '=\n')
  curl -s -c $d.jar -b $d.jar -D $d.h -o /dev/null "$ISS/authorize?client_id=$CID&redirect_uri=$(enc $RED)&response_type=code&state=s1&code_challenge=$ch&code_challenge_method=S256&provider=password"
  local loc=$(grep -i '^location' $d.h | awk '{print $2}' | tr -d '\r')
  [[ $loc == *auth_flow=* ]] || { echo "  FAIL /authorize: $(head -1 $d.h | tr -d '\r')"; exit 1; }
  loc=${loc#*auth_flow=}; print -rn -- ${loc%%&*} > $d.flow
}
# exchange the code in the Location of $W/$1.h into $W/$1.tok
finish_flow() {
  local d=$W/$1
  local cb=$(grep -i '^location' $d.h | awk '{print $2}' | tr -d '\r')
  [[ $cb == *code=* ]] || { echo "  FAIL no authorization code ($(head -1 $d.h | tr -d '\r'))"; exit 1; }
  local code=$(python3 -c 'import sys,urllib.parse as u;print(u.parse_qs(u.urlparse(sys.argv[1]).query)["code"][0])' "$cb")
  curl -s -X POST "$ISS/token" --data-urlencode grant_type=authorization_code --data-urlencode "code=$code" \
    --data-urlencode "redirect_uri=$RED" --data-urlencode "client_id=$CID" --data-urlencode "code_verifier=$(cat $d.ver)" > $d.tok
}
register() {
  local d=$W/$1; local email="test-rev-$1-$(date +%s)@delivered.resend.dev"; print -rn -- $email > $d.email
  openssl rand -base64 18 | tr -d '\n/+=' > $d.pw
  start_flow $1; local flow=$(cat $d.flow)
  curl -s -c $d.jar -b $d.jar -o /dev/null "$ISS/password/register?auth_flow=$flow"
  curl -s -c $d.jar -b $d.jar -o /dev/null -X POST "$ISS/password/register?auth_flow=$flow" \
    --data-urlencode action=register --data-urlencode "email=$email" --data-urlencode password@$d.pw --data-urlencode repeat@$d.pw
  local code="" id
  for i in {1..10}; do
    sleep 6
    id=$(curl -s -H "Authorization: Bearer $(cat $RESEND_KEY_FILE)" "https://api.resend.com/emails?limit=20" | python3 -c '
import sys,json
for m in json.load(sys.stdin).get("data",[]):
    if sys.argv[1] in (m.get("to") or []): print(m["id"]); break' "$email")
    [ -n "$id" ] || continue
    code=$(curl -s -H "Authorization: Bearer $(cat $RESEND_KEY_FILE)" "https://api.resend.com/emails/$id" | python3 -c '
import sys,json,re
m=json.load(sys.stdin); t=(m.get("text") or "")+" "+re.sub("<[^>]+>"," ",m.get("html") or "")
r=re.findall(r"\b(\d{6})\b",t); print(r[0] if r else "")')
    [ -n "$code" ] && break
  done
  [ -n "$code" ] || { echo "  FAIL no verification code for $email"; exit 1; }
  curl -s -c $d.jar -b $d.jar -D $d.h -o /dev/null -X POST "$ISS/password/register?auth_flow=$flow" --data-urlencode action=verify --data-urlencode "code=$code"
  finish_flow $1
  echo "  registered $email"
}
signin() {
  local d=$W/$1; start_flow $1
  curl -s -c $d.jar -b $d.jar -D $d.h -o /dev/null -X POST "$ISS/password/authorize?auth_flow=$(cat $d.flow)" \
    --data-urlencode "email=$(cat $d.email)" --data-urlencode password@$d.pw
  finish_flow $1
}
refresh_status() {  # refresh with the refresh token in file $1 (json); write the response to $2
  curl -s -o $2 -w '%{http_code}' -X POST "$ISS/token" --data-urlencode grant_type=refresh_token \
    --data-urlencode "refresh_token=$(field $1 refresh_token)" --data-urlencode "client_id=$CID"
}
api_status() { curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $(field $1 access_token)" "$API/api/watch-history"; }
wait_rejected() {  # poll api-videos with the access token in $2 until 401
  local t0=$(date +%s) s
  while true; do
    s=$(api_status $2)
    if [ "$s" = 401 ]; then echo "  ok   $1: api-videos rejects the old access token after $(( $(date +%s) - t0 )) s"; return; fi
    if (( $(date +%s) - t0 >= BOUND_S )); then echo "  FAIL $1: api-videos still answers $s after ${BOUND_S} s"; fail=1; return; fi
    sleep 10
  done
}

echo "== A. account deletion ($ENVNAME)"
register a
check "refresh before" "$(refresh_status $W/a.tok $W/a.tok2)" 200
check "api-videos before" "$(api_status $W/a.tok2)" 200
check "DELETE /account" "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$ISS/account" -H "Authorization: Bearer $(field $W/a.tok2 access_token)")" 200
check "refresh after delete" "$(refresh_status $W/a.tok2 $W/a.tok3)" 400
wait_rejected "deletion" $W/a.tok2

echo "== B. sign out of all devices ($ENVNAME)"
sleep 20   # auth sends at most 5 codes per 5 min per IP
register b
cp $W/b.tok $W/b.other   # a second "device"
check "refresh before" "$(refresh_status $W/b.tok $W/b.tok2)" 200
check "POST /account/sign-out-all" "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$ISS/account/sign-out-all" -H "Authorization: Bearer $(field $W/b.tok2 access_token)")" 200
check "refresh after sign-out-all (this device)" "$(refresh_status $W/b.tok2 $W/b.tok3)" 400
check "refresh after sign-out-all (other device)" "$(refresh_status $W/b.other $W/b.tok3)" 400
wait_rejected "sign-out-all" $W/b.tok2
sleep 2   # a sign-in in the same second as the revocation counts as revoked
signin b
check "fresh sign-in works again" "$(api_status $W/b.tok)" 200
check "fresh sign-in can refresh" "$(refresh_status $W/b.tok $W/b.tok4)" 200
check "cleanup: DELETE /account" "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$ISS/account" -H "Authorization: Bearer $(field $W/b.tok4 access_token)")" 200

[ $fail = 0 ] && echo "PASS" || { echo "FAILED"; exit 1; }
