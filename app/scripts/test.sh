#!/bin/bash
# ============================================================================
# Valmont Data — end-to-end test (45 checks). Start the dev server first:
#   npm run dev   →  http://localhost:8787   (default mock DB)
# The retry path is exercised deterministically via the built-in convention:
# numbers ending 0000 fail their first delivery attempt (see lib/supplier.js).
# MOCK_FAIL_FIRST=1 is for MANUAL runs — it makes §4 fail by design, so the
# suite expects a plain dev server.
# ============================================================================
B="${B:-http://localhost:8787}"
J="Content-Type: application/json"
PASS=0; FAIL=0
ck(){ if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "PASS  $1"; else FAIL=$((FAIL+1)); echo "FAIL  $1  (got: $2, want: $3)"; fi; }
jqget(){ python3 -c "import sys,json;d=json.load(sys.stdin);print(d$1)"; }
sim(){ node scripts/sim-webhook.js "$@" 2>/dev/null; }

echo "── 1. float guard + guest order rejection (no float yet → nothing available) ──"
R=$(curl -s "$B/api/bundles")
ck "bundles endpoint returns 200" "$(curl -s -o /dev/null -w '%{http_code}' "$B/api/bundles")" "200"
AV=$(echo "$R" | jqget "['bundles'][0]['available']")
ck "bundle unavailable with 0 float" "$AV" "False"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/orders" -H "$J" -d '{"bundle_id":1,"phone":"0241112222"}')
ck "guest order rejected without token (401)" "$CODE" "401"

echo "── 2. admin login + float top-up ──"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/admin/login" -H "$J" -d '{"password":"wrong"}')
ck "wrong admin password rejected" "$CODE" "401"
TOK=$(curl -s -X POST "$B/api/admin/login" -H "$J" -d '{"password":"admin123"}' | jqget "['token']")
ck "admin login issues token" "${TOK:0:3}" "eyJ"
R=$(curl -s -X POST "$B/api/admin/float/topup" -H "$J" -H "Authorization: Bearer $TOK" -d '{"network":"mtn","amount":200}')
ck "mtn float top-up 200" "$(echo "$R" | jqget "['balance']")" "200"

echo "── 3. customer auth & account gating ──"
# Signup
R_SIGN=$(curl -s -X POST "$B/api/auth/customer" -H "$J" -d '{"name":"Kofi Mensah","phone":"0241112222","pin":"1234","email":"kofi@example.com"}')
CTOK=$(echo "$R_SIGN" | jqget "['token']")
ck "customer signup creates account" "${CTOK:0:3}" "eyJ"

# Duplicate signup -> 409
CODE_DUP=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/auth/customer" -H "$J" -d '{"action":"signup","phone":"0241112222","pin":"9999"}')
ck "signup with duplicate phone/email rejected (409)" "$CODE_DUP" "409"

# Wrong credentials login -> 401
CODE_BAD=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/auth/customer" -H "$J" -d '{"action":"login","phone":"0241112222","pin":"wrong"}')
ck "wrong customer credentials rejected (401)" "$CODE_BAD" "401"

# Correct login -> token
LTOK=$(curl -s -X POST "$B/api/auth/customer" -H "$J" -d '{"action":"login","phone":"0241112222","pin":"1234"}' | jqget "['token']")
ck "customer login issues token" "${LTOK:0:3}" "eyJ"

# Account endpoint without token -> 401
CODE_ACC_NOAUTH=$(curl -s -o /dev/null -w '%{http_code}' "$B/api/account")
ck "account endpoint without token rejected (401)" "$CODE_ACC_NOAUTH" "401"

# Authed order with 0 float (Telecel has 0 float) -> 422
CODE_FLOAT0=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/orders" -H "$J" -H "Authorization: Bearer $CTOK" -d '{"bundle_id":10,"phone":"0201112222"}')
ck "authed order rejected when float is 0 (422)" "$CODE_FLOAT0" "422"

# Now top up telecel and airteltigo float for remaining tests
curl -s -X POST "$B/api/admin/float/topup" -H "$J" -H "Authorization: Bearer $TOK" -d '{"network":"telecel","amount":100}' >/dev/null
curl -s -X POST "$B/api/admin/float/topup" -H "$J" -H "Authorization: Bearer $TOK" -d '{"network":"airteltigo","amount":100}' >/dev/null

echo "── 4. order creation + webhook delivery ──"
R=$(curl -s -X POST "$B/api/orders" -H "$J" -H "Authorization: Bearer $CTOK" -d '{"bundle_id":5,"phone":"0241112222"}')   # 10GB MTN 43.00
REF=$(echo "$R" | jqget "['reference']")
ck "order created" "$(echo "$R" | jqget "['dev']")" "True"
R=$(curl -s "$B/api/orders?reference=$REF")
ck "order status pending" "$(echo "$R" | jqget "['order']['status']")" "pending"

R=$(sim --ref "$REF" --amount 43)
ck "webhook handled" "$(echo "$R" | jqget "['handled']")" "True"
R=$(curl -s "$B/api/orders?reference=$REF")
ck "order delivered" "$(echo "$R" | jqget "['order']['status']")" "delivered"

R=$(curl -s "$B/api/admin/float" -H "Authorization: Bearer $TOK")
ck "float debited (200-38.5=161.5)" "$(echo "$R" | jqget "['balances'][0]['balance']")" "161.5"

echo "── 5. idempotency (duplicate webhook) ──"
R=$(sim --ref "$REF" --amount 43 --duplicate)
DUP=$(echo "$R" | jqget "['duplicate']['duplicate']")
ck "duplicate webhook detected" "$DUP" "True"
R=$(curl -s "$B/api/admin/float" -H "Authorization: Bearer $TOK")
ck "float NOT debited twice" "$(echo "$R" | jqget "['balances'][0]['balance']")" "161.5"

echo "── 6. signature + amount guards ──"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/valmontpay/webhook" -H "Content-Type: application/json" -H "x-valmontpay-signature: deadbeef" -d '{"event":"charge.success"}')
ck "bad signature → 401" "$CODE" "401"

R=$(curl -s -X POST "$B/api/orders" -H "$J" -H "Authorization: Bearer $CTOK" -d '{"bundle_id":10,"phone":"0241112222"}')  # 10GB telecel
REF2=$(echo "$R" | jqget "['reference']")
sim --ref "$REF2" --wrong-amount >/dev/null
R=$(curl -s "$B/api/orders?reference=$REF2")
ck "amount mismatch → refunded" "$(echo "$R" | jqget "['order']['status']")" "refunded"

echo "── 7. phone validation ──"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/orders" -H "$J" -H "Authorization: Bearer $CTOK" -d '{"bundle_id":1,"phone":"12345"}')
ck "invalid phone rejected" "$CODE" "400"

echo "── 8. retry path (…0000 numbers fail attempt 1 → retry succeeds) ──"
R=$(curl -s -X POST "$B/api/orders" -H "$J" -H "Authorization: Bearer $CTOK" -d '{"bundle_id":1,"phone":"0551110000"}')  # 1GB MTN
REF3=$(echo "$R" | jqget "['reference']")
sim --ref "$REF3" --amount 4.20 >/dev/null
R=$(curl -s "$B/api/orders?reference=$REF3")
ck "first attempt failed" "$(echo "$R" | jqget "['order']['status']")" "failed"
ck "attempts recorded = 1" "$(echo "$R" | jqget "['order']['attempts']")" "1"
R=$(curl -s -X POST "$B/api/admin/orders/retry" -H "$J" -H "Authorization: Bearer $TOK" -d "{\"reference\":\"$REF3\"}")
ck "manual retry succeeds" "$(echo "$R" | jqget "['ok']")" "True"
R=$(curl -s "$B/api/orders?reference=$REF3")
ck "order delivered after retry" "$(echo "$R" | jqget "['order']['status']")" "delivered"

echo "── 9. customer account features ──"
ACC=$(curl -s "$B/api/account" -H "Authorization: Bearer $CTOK")
ck "recent numbers extracted in account" "$(echo "$ACC" | python3 -c "import sys,json;d=json.load(sys.stdin);print('0241112222' in d.get('recent_numbers',[]))")" "True"

# Save number
R_SAVE=$(curl -s -X POST "$B/api/account/saved" -H "$J" -H "Authorization: Bearer $CTOK" -d '{"kind":"momo","phone":"0551112233","label":"My MoMo"}')
ck "save customer number succeeds" "$(echo "$R_SAVE" | jqget "['ok']")" "True"
SAVED_ID=$(echo "$R_SAVE" | jqget "['saved_number']['id']")

# Delete number
R_DEL=$(curl -s -X DELETE "$B/api/account/saved?id=$SAVED_ID" -H "Authorization: Bearer $CTOK")
ck "delete customer number succeeds" "$(echo "$R_DEL" | jqget "['ok']")" "True"

# Order history
ck "order history contains placed order" "$(echo "$ACC" | python3 -c "import sys,json;d=json.load(sys.stdin);print(len(d.get('orders',[])) > 0)")" "True"

# Personalized greeting
ck "account greeting personalized with time and name" "$(echo "$ACC" | python3 -c "import sys,json;d=json.load(sys.stdin);print('Kofi' in d.get('time_greeting','') or 'Kofi' in d.get('greeting',''))")" "True"

echo "── 10. admin views ──"
R=$(curl -s "$B/api/admin/pl?days=7" -H "Authorization: Bearer $TOK")
ck "P&L has rows" "$(echo "$R" | jqget "['rows'][0]['network']")" "mtn"
R=$(curl -s "$B/api/admin/webhooks" -H "Authorization: Bearer $TOK")
ck "webhook log has entries" "$(echo "$R" | jqget "['webhooks'][0]['signature_valid']")" "True"
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$B/api/admin/float")
ck "admin without token → 401" "$CODE" "401"

echo "── 11. static pages ──"
for p in / /status.html /admin.html; do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' "$B$p")
  ck "page $p" "$CODE" "200"
done

echo "── 12. seed initial float (networks already funded → no-op, safe) ──"
R=$(curl -s -X POST "$B/api/admin/float/seed" -H "$J" -H "Authorization: Bearer $TOK" -d '{}')
ck "seed returns results for 3 networks" "$(echo "$R" | python3 -c "import sys,json;print(len(json.load(sys.stdin)['results']))")" "3"
ck "already-funded networks are not re-seeded" "$(echo "$R" | python3 -c "import sys,json;print(json.load(sys.stdin)['seeded'])")" "0"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/admin/float/seed" -H "$J" -d '{}')
ck "seed without admin token → 401" "$CODE" "401"

echo "── 13. RemaData supplier & admin price sync ──"
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$B/api/admin/remadata-prices")
ck "remadata-prices without token → 401" "$CODE" "401"
R_PRICES=$(curl -s "$B/api/admin/remadata-prices" -H "Authorization: Bearer $TOK")
ck "remadata-prices returns bundles list" "$(echo "$R_PRICES" | python3 -c "import sys,json;d=json.load(sys.stdin);print(len(d.get('bundles',[])) > 0)")" "True"

CODE_WALLET=$(curl -s -o /dev/null -w '%{http_code}' "$B/api/admin/wallet-balance")
ck "wallet-balance without token → 401" "$CODE_WALLET" "401"
R_WALLET=$(curl -s "$B/api/admin/wallet-balance" -H "Authorization: Bearer $TOK")
ck "wallet-balance returns valid response" "$(echo "$R_WALLET" | jqget "['ok']")" "True"

R_UPDATE=$(curl -s -X POST "$B/api/admin/bundles/update-prices" -H "$J" -H "Authorization: Bearer $TOK" -d '{"updates":[{"id":1,"cost_price":3.95,"sell_price":4.30}]}')
ck "update-prices updates bundle" "$(echo "$R_UPDATE" | jqget "['ok']")" "True"

echo ""
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] && [ "$PASS" -ge 40 ]
