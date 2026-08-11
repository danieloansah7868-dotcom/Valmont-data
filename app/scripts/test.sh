#!/bin/bash
# ============================================================================
# Valmont Data — end-to-end test (73 checks). Start the dev server first:
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
CODE_FLOAT0=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/orders" -H "$J" -H "Authorization: Bearer $CTOK" -d '{"bundle_id":15,"phone":"0201112222"}')
ck "authed order rejected when float is 0 (422)" "$CODE_FLOAT0" "422"

# Now top up telecel and airteltigo float for remaining tests
curl -s -X POST "$B/api/admin/float/topup" -H "$J" -H "Authorization: Bearer $TOK" -d '{"network":"telecel","amount":100}' >/dev/null
curl -s -X POST "$B/api/admin/float/topup" -H "$J" -H "Authorization: Bearer $TOK" -d '{"network":"airteltigo","amount":100}' >/dev/null

echo "── 4. order creation + webhook delivery ──"
R=$(curl -s -X POST "$B/api/orders" -H "$J" -H "Authorization: Bearer $CTOK" -d '{"bundle_id":8,"phone":"0241112222"}')   # 10GB MTN 52.00
REF=$(echo "$R" | jqget "['reference']")
ck "order created" "$(echo "$R" | jqget "['dev']")" "True"
R=$(curl -s "$B/api/orders?reference=$REF")
ck "order status pending" "$(echo "$R" | jqget "['order']['status']")" "pending"

R=$(sim --ref "$REF" --amount 52)
ck "webhook handled" "$(echo "$R" | jqget "['handled']")" "True"
R=$(curl -s "$B/api/orders?reference=$REF")
ck "order delivered" "$(echo "$R" | jqget "['order']['status']")" "delivered"

R=$(curl -s "$B/api/admin/float" -H "Authorization: Bearer $TOK")
ck "float debited (200-38.5=161.5)" "$(echo "$R" | jqget "['balances'][0]['balance']")" "161.5"

echo "── 5. idempotency (duplicate webhook) ──"
R=$(sim --ref "$REF" --amount 52 --duplicate)
DUP=$(echo "$R" | jqget "['duplicate']['duplicate']")
ck "duplicate webhook detected" "$DUP" "True"
R=$(curl -s "$B/api/admin/float" -H "Authorization: Bearer $TOK")
ck "float NOT debited twice" "$(echo "$R" | jqget "['balances'][0]['balance']")" "161.5"

echo "── 6. signature + amount guards ──"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/valmontpay/webhook" -H "Content-Type: application/json" -H "x-valmontpay-signature: deadbeef" -d '{"event":"charge.success"}')
ck "bad signature → 401" "$CODE" "401"

R=$(curl -s -X POST "$B/api/orders" -H "$J" -H "Authorization: Bearer $CTOK" -d '{"bundle_id":15,"phone":"0241112222"}')  # 10GB telecel
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
sim --ref "$REF3" --amount 6 >/dev/null
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
for p in / /status.html /admin.html /autoreload.html; do
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

echo "── 14. SMS lead collection (storefront popup → admin export) ──"
# Public opt-in (no token): accepts spaced input, normalizes to 0XXXXXXXXX
R_OPT=$(curl -s -X POST "$B/api/account/optin" -H "$J" -d '{"phone":"055 987 6543","source":"storefront-popup"}')
ck "sms opt-in stores validated Ghana number" "$(echo "$R_OPT" | jqget "['ok']")" "True"
# Admin export list contains the normalized number
R_LEADS=$(curl -s "$B/api/admin/sms-leads" -H "Authorization: Bearer $TOK")
ck "sms-leads returns collected numbers" "$(echo "$R_LEADS" | python3 -c "import sys,json;d=json.load(sys.stdin);print('0559876543' in d.get('phones',[]))")" "True"

echo "── 15. auto-reload: usage tracking → opt-in → automatic top-up ──"
# Deliver a 2GB MTN bundle (id 2, GH₵9.00 — untouched by the §13 price sync) to the customer's line
R=$(curl -s -X POST "$B/api/orders" -H "$J" -H "Authorization: Bearer $CTOK" -d '{"bundle_id":2,"phone":"0241112222"}')
REF_AR=$(echo "$R" | jqget "['reference']")
sim --ref "$REF_AR" --amount 9 >/dev/null
ck "auto-reload order delivered" "$(curl -s "$B/api/orders?reference=$REF_AR" | jqget "['order']['status']")" "delivered"

# Usage tracking: every delivered bundle gets a bundle_usage row
R_U=$(curl -s "$B/api/usage?reference=$REF_AR" -H "x-usage-key: dev-usage-key")
ck "usage row created on delivery (0% used)" "$(echo "$R_U" | jqget "['usage']['percent_used']")" "0"
ck "usage row status active" "$(echo "$R_U" | jqget "['usage']['status']")" "active"

# Report usage → crosses the low threshold, no rule yet → should_ask=true
R_U=$(curl -s -X POST "$B/api/usage" -H "$J" -H "x-usage-key: dev-usage-key" -d "{\"action\":\"report\",\"reference\":\"$REF_AR\",\"used_mb\":1800}")
ck "usage report updates percent (88%)" "$(echo "$R_U" | jqget "['usage']['percent_used']")" "88"
ck "low usage flagged" "$(echo "$R_U" | jqget "['usage']['low']")" "True"
ck "no rule yet → should_ask true" "$(echo "$R_U" | jqget "['usage']['should_ask']")" "True"
R_AR=$(curl -s "$B/api/autoreload" -H "Authorization: Bearer $CTOK")
ck "line shows low usage + ask prompt" "$(echo "$R_AR" | python3 -c "import sys,json;d=json.load(sys.stdin);l=[x for x in d['lines'] if x['phone']=='0241112222'][0];print(l['low'] and l['should_ask'])")" "True"

# Opt-in is explicit: no consent → 400; duplicate/network mismatch guarded
CODE_NOC=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/autoreload" -H "$J" -H "Authorization: Bearer $CTOK" -d '{"phone":"0241112222","bundle_id":2,"trigger_percent":10,"momo_number":"0551112233"}')
ck "opt-in without consent rejected (400)" "$CODE_NOC" "400"
CODE_WRONGNET=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/autoreload" -H "$J" -H "Authorization: Bearer $CTOK" -d '{"phone":"0241112222","bundle_id":10,"trigger_percent":10,"momo_number":"0551112233","consent":true}')
ck "opt-in with wrong-network bundle rejected (400)" "$CODE_WRONGNET" "400"
R_AR=$(curl -s -X POST "$B/api/autoreload" -H "$J" -H "Authorization: Bearer $CTOK" -d '{"phone":"0241112222","bundle_id":2,"trigger_percent":10,"momo_number":"0551112233","consent":true}')
ARID=$(echo "$R_AR" | jqget "['rule_id']")
ck "valid opt-in creates rule" "$(echo "$R_AR" | jqget "['ok']")" "True"
ck "rule starts active with trigger 10" "$(echo "$R_AR" | jqget "['rule']['trigger_percent']")" "10"
R_DUP=$(curl -s -X POST "$B/api/autoreload" -H "$J" -H "Authorization: Bearer $CTOK" -d '{"phone":"0241112222","bundle_id":2,"trigger_percent":20,"momo_number":"0551112233","consent":true}')
ck "re-opt-in updates the existing rule (trigger → 20)" "$(echo "$R_DUP" | jqget "['rule']['trigger_percent']")" "20"

# Exhaust the bundle (98% > 90% threshold) and let the cron auto-reload it
curl -s -X POST "$B/api/usage" -H "$J" -H "x-usage-key: dev-usage-key" -d "{\"action\":\"report\",\"reference\":\"$REF_AR\",\"used_mb\":2000}" >/dev/null
R_SWEEP=$(curl -s "$B/api/cron/autoreload")
ck "cron triggered auto-reload" "$(echo "$R_SWEEP" | jqget "['triggered'][0]['triggered']")" "True"
ARREF=$(echo "$R_SWEEP" | jqget "['triggered'][0]['reference']")
ck "auto-reload delivered via real webhook pipeline" "$(echo "$R_SWEEP" | jqget "['triggered'][0]['outcome']['outcome']")" "delivered"
ck "auto-reload order is delivered" "$(curl -s "$B/api/orders?reference=$ARREF" | jqget "['order']['status']")" "delivered"
R_AR=$(curl -s "$B/api/autoreload" -H "Authorization: Bearer $CTOK")
ck "reload counted on the rule" "$(echo "$R_AR" | python3 -c "import sys,json;d=json.load(sys.stdin);r=[x for x in d['rules'] if x['id']==$ARID][0];print(r['reload_count'])")" "1"
ck "line usage reset (fresh bundle tracked)" "$(echo "$R_AR" | python3 -c "import sys,json;d=json.load(sys.stdin);l=[x for x in d['lines'] if x['phone']=='0241112222'][0];print(l['usage']['percent_used'])")" "0"

# Cooldown: a second sweep must NOT double-buy
R_SWEEP2=$(curl -s "$B/api/cron/autoreload")
ck "cooldown blocks second reload" "$(echo "$R_SWEEP2" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['results'][0]['action'] if d['results'] else 'skip')")" "skip"
ck "cooldown reason reported" "$(echo "$R_SWEEP2" | python3 -c "import sys,json;d=json.load(sys.stdin);print('cooldown' in (d['results'][0].get('reason') or '') if d['results'] else False)")" "True"

# Pause → sweep ignores it; resume → toggle back
R_TOG=$(curl -s -X POST "$B/api/autoreload" -H "$J" -H "Authorization: Bearer $CTOK" -d "{\"action\":\"toggle\",\"id\":$ARID,\"active\":false}")
ck "rule can be paused" "$(echo "$R_TOG" | jqget "['active']")" "False"
R_SWEEP3=$(curl -s "$B/api/cron/autoreload")
ck "paused rule not swept" "$(echo "$R_SWEEP3" | jqget "['checked']")" "0"

# Opt-out: delete the rule
R_DEL=$(curl -s -X DELETE "$B/api/autoreload?id=$ARID" -H "Authorization: Bearer $CTOK")
ck "rule deleted (opt-out)" "$(echo "$R_DEL" | jqget "['removed']")" "True"
R_AR=$(curl -s "$B/api/autoreload" -H "Authorization: Bearer $CTOK")
ck "no rules left after opt-out" "$(echo "$R_AR" | python3 -c "import sys,json;print(len(json.load(sys.stdin)['rules']))")" "0"

# Guard rails
CODE_AR_NOAUTH=$(curl -s -o /dev/null -w '%{http_code}' "$B/api/autoreload")
ck "autoreload endpoint without token → 401" "$CODE_AR_NOAUTH" "401"
CODE_USAGE_BADKEY=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/usage" -H "$J" -H "x-usage-key: wrong" -d '{"action":"report","phone":"0241112222","used_mb":10}')
ck "usage report with wrong key → 401" "$CODE_USAGE_BADKEY" "401"

echo ""
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] && [ "$PASS" -ge 73 ]
