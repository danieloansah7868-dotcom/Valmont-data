#!/bin/bash
# ============================================================================
# Valmont Data — end-to-end test (26 checks). Start the dev server first:
#   npm run dev   →  http://localhost:8787   (default mock DB)
# The retry path is exercised deterministically via the built-in convention:
# numbers ending 0000 fail their first delivery attempt (see lib/supplier.js).
# MOCK_FAIL_FIRST=1 is for MANUAL runs — it makes §3 fail by design, so the
# suite expects a plain dev server.
# ============================================================================
B="${B:-http://localhost:8787}"
J="Content-Type: application/json"
PASS=0; FAIL=0
ck(){ if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "PASS  $1"; else FAIL=$((FAIL+1)); echo "FAIL  $1  (got: $2, want: $3)"; fi; }
jqget(){ python3 -c "import sys,json;d=json.load(sys.stdin);print(d$1)"; }
sim(){ node scripts/sim-webhook.js "$@" 2>/dev/null; }

echo "── 1. float guard (no float yet → nothing available, order rejected) ──"
R=$(curl -s "$B/api/bundles")
ck "bundles endpoint returns 200" "$(curl -s -o /dev/null -w '%{http_code}' "$B/api/bundles")" "200"
AV=$(echo "$R" | jqget "['bundles'][0]['available']")
ck "bundle unavailable with 0 float" "$AV" "False"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/orders" -H "$J" -d '{"bundle_id":1,"phone":"0241112222"}')
ck "order rejected when float is 0 (422)" "$CODE" "422"

echo "── 2. admin login + float top-up ──"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/admin/login" -H "$J" -d '{"password":"wrong"}')
ck "wrong admin password rejected" "$CODE" "401"
TOK=$(curl -s -X POST "$B/api/admin/login" -H "$J" -d '{"password":"admin123"}' | jqget "['token']")
ck "admin login issues token" "${TOK:0:3}" "eyJ"
R=$(curl -s -X POST "$B/api/admin/float/topup" -H "$J" -H "Authorization: Bearer $TOK" -d '{"network":"mtn","amount":200}')
ck "mtn float top-up 200" "$(echo "$R" | jqget "['balance']")" "200"
curl -s -X POST "$B/api/admin/float/topup" -H "$J" -H "Authorization: Bearer $TOK" -d '{"network":"telecel","amount":100}' >/dev/null
curl -s -X POST "$B/api/admin/float/topup" -H "$J" -H "Authorization: Bearer $TOK" -d '{"network":"airteltigo","amount":100}' >/dev/null

echo "── 3. order creation + webhook delivery ──"
R=$(curl -s -X POST "$B/api/orders" -H "$J" -d '{"bundle_id":5,"phone":"0241112222"}')   # 10GB MTN 43.00
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

echo "── 4. idempotency (duplicate webhook) ──"
R=$(sim --ref "$REF" --amount 43 --duplicate)
DUP=$(echo "$R" | jqget "['duplicate']['duplicate']")
ck "duplicate webhook detected" "$DUP" "True"
R=$(curl -s "$B/api/admin/float" -H "Authorization: Bearer $TOK")
ck "float NOT debited twice" "$(echo "$R" | jqget "['balances'][0]['balance']")" "161.5"

echo "── 5. signature + amount guards ──"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/valmontpay/webhook" -H "Content-Type: application/json" -H "x-valmontpay-signature: deadbeef" -d '{"event":"payment.succeeded"}')
ck "bad signature → 401" "$CODE" "401"

R=$(curl -s -X POST "$B/api/orders" -H "$J" -d '{"bundle_id":10,"phone":"0241112222"}')  # 10GB telecel
REF2=$(echo "$R" | jqget "['reference']")
sim --ref "$REF2" --wrong-amount >/dev/null
R=$(curl -s "$B/api/orders?reference=$REF2")
ck "amount mismatch → refunded" "$(echo "$R" | jqget "['order']['status']")" "refunded"

echo "── 6. phone validation ──"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/orders" -H "$J" -d '{"bundle_id":1,"phone":"12345"}')
ck "invalid phone rejected" "$CODE" "400"

echo "── 7. retry path (…0000 numbers fail attempt 1 → retry succeeds) ──"
R=$(curl -s -X POST "$B/api/orders" -H "$J" -d '{"bundle_id":1,"phone":"0551110000"}')  # 1GB MTN
REF3=$(echo "$R" | jqget "['reference']")
sim --ref "$REF3" --amount 4.20 >/dev/null
R=$(curl -s "$B/api/orders?reference=$REF3")
ck "first attempt failed" "$(echo "$R" | jqget "['order']['status']")" "failed"
ck "attempts recorded = 1" "$(echo "$R" | jqget "['order']['attempts']")" "1"
R=$(curl -s -X POST "$B/api/admin/orders/retry" -H "$J" -H "Authorization: Bearer $TOK" -d "{\"reference\":\"$REF3\"}")
ck "manual retry succeeds" "$(echo "$R" | jqget "['ok']")" "True"
R=$(curl -s "$B/api/orders?reference=$REF3")
ck "order delivered after retry" "$(echo "$R" | jqget "['order']['status']")" "delivered"

echo "── 8. admin views ──"
R=$(curl -s "$B/api/admin/pl?days=7" -H "Authorization: Bearer $TOK")
ck "P&L has rows" "$(echo "$R" | jqget "['rows'][0]['network']")" "mtn"
R=$(curl -s "$B/api/admin/webhooks" -H "Authorization: Bearer $TOK")
ck "webhook log has entries" "$(echo "$R" | jqget "['webhooks'][0]['signature_valid']")" "True"
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$B/api/admin/float")
ck "admin without token → 401" "$CODE" "401"

echo "── 9. static pages ──"
for p in / /status.html /admin.html; do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' "$B$p")
  ck "page $p" "$CODE" "200"
done

echo ""
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
