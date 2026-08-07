#!/bin/bash
# Valmont Data smoke test — run against a running server:
#   MEMORY_DB=1 npm run dev   (or: MEMORY_DB=1 npx next start)
#   bash scripts/smoke.sh
# Requires: curl, python3
B=${B:-http://localhost:3199}
J="Content-Type: application/json"
PASS=0; FAIL=0
ck(){ if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "PASS  $1"; else FAIL=$((FAIL+1)); echo "FAIL  $1  (got: $2, want: $3)"; fi; }
ckc(){ code=$2; if [ "$3" = "any" ] || [ "$code" = "$3" ]; then PASS=$((PASS+1)); echo "PASS  $1 (HTTP $code)"; else FAIL=$((FAIL+1)); echo "FAIL  $1 (HTTP $code, want $3)"; fi; }

# 1. bundles (guest)
R=$(curl -s "$B/api/bundles?network=mtn")
ck "bundles guest tier" "$(echo $R | python3 -c 'import sys,json;print(json.load(sys.stdin)["tier"])')" "guest"
N=$(echo $R | python3 -c 'import sys,json;print(len(json.load(sys.stdin)["bundles"]))')
ck "bundles count mtn" "$N" "9"
P=$(echo $R | python3 -c 'import sys,json;print(json.load(sys.stdin)["bundles"][0]["price"])')
ck "guest 1GB price 4.20" "$P" "4.2"

# 2. signup
R=$(curl -s -X POST "$B/api/auth/signup" -H "$J" -d '{"name":"Ama Owusu","email":"ama@test.com","phone":"0241112222","password":"secret1"}')
ck "signup returns user" "$(echo $R | python3 -c 'import sys,json;print(json.load(sys.stdin)["user"]["email"])')" "ama@test.com"
ckc "signup cookie set" "$(curl -s -o /dev/null -w '%{http_code}' -c /tmp/vd-cookies.txt -X POST "$B/api/auth/signup" -H "$J" -d '{"name":"Ama Owusu","email":"ama@test.com","phone":"0241112222","password":"secret1"}')" "409"

# 4. wrong password
ckc "signin wrong password" "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/auth/signin" -H "$J" -d '{"email":"ama@test.com","password":"nope"}')" "401"
# sign in for real
curl -s -c /tmp/vd-cookies.txt -X POST "$B/api/auth/signin" -H "$J" -d '{"email":"ama@test.com","password":"secret1"}' >/dev/null

# 3. session (with cookie from signin)
R=$(curl -s -b /tmp/vd-cookies.txt "$B/api/auth/session")
ck "session returns user" "$(echo $R | python3 -c 'import sys,json;print(json.load(sys.stdin)["user"]["name"])')" "Ama Owusu"

# 5. deposit (dev mode → instant credit)
R=$(curl -s -b /tmp/vd-cookies.txt -X POST "$B/api/deposits" -H "$J" -d '{"amount":50,"phone":"0241112222","network":"mtn"}')
ck "deposit dev credit balance" "$(echo $R | python3 -c 'import sys,json;print(float(json.load(sys.stdin)["wallet_balance"]))')" "50.0"

# 6. wallet GET
R=$(curl -s -b /tmp/vd-cookies.txt "$B/api/wallet")
ck "wallet balance" "$(echo $R | python3 -c 'import sys,json;print(float(json.load(sys.stdin)["balance"]))')" "50.0"
ck "wallet tx count" "$(echo $R | python3 -c 'import sys,json;print(len(json.load(sys.stdin)["transactions"]))')" "1"

# 7. member pricing
R=$(curl -s -b /tmp/vd-cookies.txt "$B/api/bundles?network=mtn")
ck "member tier" "$(echo $R | python3 -c 'import sys,json;print(json.load(sys.stdin)["tier"])')" "member"
P=$(echo $R | python3 -c 'import sys,json;print(json.load(sys.stdin)["bundles"][3]["price"])')  # 5GB
ck "member 5GB price 20.50" "$P" "20.5"

# 8. wallet order
R=$(curl -s -b /tmp/vd-cookies.txt -X POST "$B/api/orders" -H "$J" -d '{"network":"mtn","bundle_gb":10,"number":"0241112222","payment_method":"wallet","idempotency_key":"test-key-001"}')
OID=$(echo $R | python3 -c 'import sys,json;print(json.load(sys.stdin)["order"]["id"])')
ck "wallet order placed" "$(echo $R | python3 -c 'import sys,json;print(json.load(sys.stdin)["order"]["status"])')" "processing"
# duplicate idempotency
ckc "idempotency duplicate rejected" "$(curl -s -o /dev/null -w '%{http_code}' -b /tmp/vd-cookies.txt -X POST "$B/api/orders" -H "$J" -d '{"network":"mtn","bundle_gb":10,"number":"0241112222","payment_method":"wallet","idempotency_key":"test-key-001"}')" "409"
# wallet debited 50 - 40.50 = 9.50
R=$(curl -s -b /tmp/vd-cookies.txt "$B/api/wallet")
ck "wallet debited to 9.50" "$(echo $R | python3 -c 'import sys,json;print(float(json.load(sys.stdin)["balance"]))')" "9.5"

# 9. order status + events
R=$(curl -s "$B/api/orders/$OID")
ck "order status processing" "$(echo $R | python3 -c 'import sys,json;print(json.load(sys.stdin)["order"]["status"])')" "processing"
EV=$(echo $R | python3 -c 'import sys,json;print(len(json.load(sys.stdin)["events"]))')
ck "order events >= 3" "$EV" "3"

# wait for mock delivery (2.5s) then re-check
sleep 5
R=$(curl -s "$B/api/orders/$OID")
ck "order delivered after pipeline" "$(echo $R | python3 -c 'import sys,json;print(json.load(sys.stdin)["order"]["status"])')" "delivered"

# 10. momo order (dev auto-approve)
R=$(curl -s -X POST "$B/api/orders" -H "$J" -d '{"network":"telecel","bundle_gb":10,"number":"0207654321","payment_method":"momo","momo_network":"telecel","idempotency_key":"test-key-002"}')
OID2=$(echo $R | python3 -c 'import sys,json;print(json.load(sys.stdin)["order"]["id"])')
ck "momo dev order processing" "$(echo $R | python3 -c 'import sys,json;print(json.load(sys.stdin)["order"]["status"])')" "processing"
sleep 5
R=$(curl -s "$B/api/orders/$OID2")
ck "momo order delivered" "$(echo $R | python3 -c 'import sys,json;print(json.load(sys.stdin)["order"]["status"])')" "delivered"

# 11. invalid number rejected
ckc "invalid number 400" "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/orders" -H "$J" -d '{"network":"mtn","bundle_gb":10,"number":"12345","payment_method":"momo","momo_network":"mtn"}')" "400"
# guest wallet rejected
ckc "guest wallet 401" "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/orders" -H "$J" -d '{"network":"mtn","bundle_gb":10,"number":"0241112222","payment_method":"wallet"}')" "401"

# 12. pages
for p in / /buy /signup /signin /deposit /track /api-doc; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "$B$p")
  ckc "page $p" "$code" "200"
done
ckc "page /dashboard (logged in)" "$(curl -s -o /dev/null -w '%{http_code}' -b /tmp/vd-cookies.txt "$B/dashboard")" "200"

echo ""
echo "SMOKE: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
