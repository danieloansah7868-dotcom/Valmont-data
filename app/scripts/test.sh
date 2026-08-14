#!/bin/bash
# ============================================================================
# Valmont Data — end-to-end test suite (140+ checks). Start the dev server first:
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
for p in / /status.html /admin.html /autoreload.html /history.html; do
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
sim --ref "$REF_AR" --amount 12 >/dev/null
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
CODE_WRONGNET=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/autoreload" -H "$J" -H "Authorization: Bearer $CTOK" -d '{"phone":"0241112222","bundle_id":15,"trigger_percent":10,"momo_number":"0551112233","consent":true}')
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

echo "── 16. auto-reload: others lines (topping up FOR someone else) ──"
# Raise the OWN line's usage again (its rule was removed at the end of §15)
curl -s -X POST "$B/api/usage" -H "$J" -H "x-usage-key: dev-usage-key" -d '{"action":"report","phone":"0241112222","used_mb":1900}' >/dev/null
# The customer saves someone else's line (e.g. "Mum's line") — a favour line
curl -s -X POST "$B/api/account/saved" -H "$J" -H "Authorization: Bearer $CTOK" -d '{"kind":"data","phone":"0559988776","label":"Mum line"}' >/dev/null
# Buy a bundle for ANOTHER person's number (a favour) — not the customer's phone
R=$(curl -s -X POST "$B/api/orders" -H "$J" -H "Authorization: Bearer $CTOK" -d '{"bundle_id":2,"phone":"0559988776"}')
REF_GIFT=$(echo "$R" | jqget "['reference']")
sim --ref "$REF_GIFT" --amount 12 >/dev/null
curl -s -X POST "$B/api/usage" -H "$J" -H "x-usage-key: dev-usage-key" -d "{\"action\":\"report\",\"reference\":\"$REF_GIFT\",\"used_mb\":1900}" >/dev/null
R_AR=$(curl -s "$B/api/autoreload" -H "Authorization: Bearer $CTOK")
ck "others line flagged as 'other'" "$(echo "$R_AR" | python3 -c "import sys,json;d=json.load(sys.stdin);l=[x for x in d['lines'] if x['phone']=='0559988776'][0];print(l['relation'])")" "other"
ck "others line never auto-asks" "$(echo "$R_AR" | python3 -c "import sys,json;d=json.load(sys.stdin);l=[x for x in d['lines'] if x['phone']=='0559988776'][0];print(l['should_ask'])")" "False"
ck "others line is tracked (low usage surfaced)" "$(echo "$R_AR" | python3 -c "import sys,json;d=json.load(sys.stdin);l=[x for x in d['lines'] if x['phone']=='0559988776'][0];print(l['low'])")" "True"
ck "own line still shows the ask prompt" "$(echo "$R_AR" | python3 -c "import sys,json;d=json.load(sys.stdin);l=[x for x in d['lines'] if x['phone']=='0241112222'][0];print(l['should_ask'])")" "True"

# Opt-in for an others line REQUIRES the recipient confirmation
CODE_NOGIFT=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/autoreload" -H "$J" -H "Authorization: Bearer $CTOK" -d '{"phone":"0559988776","bundle_id":2,"trigger_percent":10,"momo_number":"0551112233","consent":true}')
ck "others opt-in without recipient confirm rejected (400)" "$CODE_NOGIFT" "400"
R_GIFT=$(curl -s -X POST "$B/api/autoreload" -H "$J" -H "Authorization: Bearer $CTOK" -d '{"phone":"0559988776","bundle_id":2,"trigger_percent":10,"momo_number":"0551112233","consent":true,"confirm_recipient":true}')
ck "others opt-in with recipient confirm accepted" "$(echo "$R_GIFT" | jqget "['ok']")" "True"
ck "others rule stored with relation other" "$(echo "$R_GIFT" | jqget "['rule']['relation']")" "other"
R_AR=$(curl -s "$B/api/autoreload" -H "Authorization: Bearer $CTOK")
ck "others rule shows as not-your-line" "$(echo "$R_AR" | python3 -c "import sys,json;d=json.load(sys.stdin);r=[x for x in d['rules'] if x['phone']=='0559988776'][0];print(r['is_own_line'])")" "False"
# clean up the others rule
curl -s -X DELETE "$B/api/autoreload?id=$(echo "$R_GIFT" | jqget "['rule_id']")" -H "Authorization: Bearer $CTOK" >/dev/null

echo "── 17. live gateway mode (no dev simulation) ──"
LIVE_ERR=$(VALMONTPAY_MODE=live VALMONTPAY_API_KEY= VALMONTPAY_WEBHOOK_SECRET= node -e "const v=require('./lib/valmontpay');v.createCheckout({reference:'VD-TEST-0000',amount:1,phone:'0241112222'}).then(()=>console.log('NOERR')).catch(e=>console.log(''+e.status))")
ck "live mode without gateway keys fails loudly (503)" "$LIVE_ERR" "503"
LIVE_ERR2=$(VALMONTPAY_MODE=live VALMONTPAY_API_KEY= VALMONTPAY_WEBHOOK_SECRET= node -e "const v=require('./lib/valmontpay');v.initiateCharge({reference:'VD-TEST-0000',amount:1,phone:'0241112222'}).then(()=>console.log('NOERR')).catch(e=>console.log(''+e.status))")
ck "live auto-reload charge without keys fails loudly (503)" "$LIVE_ERR2" "503"

echo "── 18. WhatsApp ordering bot ──"
# Webhook verification (GET)
R_VERIFY=$(curl -s -o /dev/null -w '%{http_code}' "$B/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=valmont-data-verify&hub.challenge=test123")
ck "whatsapp webhook verification returns 200" "$R_VERIFY" "200"
R_CHALLENGE=$(curl -s "$B/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=valmont-data-verify&hub.challenge=test123")
ck "whatsapp webhook returns challenge" "$R_CHALLENGE" "test123"

# Wrong verify token → 403
CODE_VERIFY=$(curl -s -o /dev/null -w '%{http_code}' "$B/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=test123")
ck "whatsapp webhook wrong verify token → 403" "$CODE_VERIFY" "403"

# Inbound message (hi) — creates session and sends welcome
R_WA=$(curl -s -X POST "$B/api/whatsapp/webhook" -H "$J" -d '{"entry":[{"changes":[{"field":"messages","value":{"messages":[{"from":"233241112222","type":"text","text":{"body":"hi"}}]}}]}]}')
ck "whatsapp webhook accepts inbound message" "$(echo "$R_WA" | jqget "['received']")" "True"

# Quick order via natural language
R_WA2=$(curl -s -X POST "$B/api/whatsapp/webhook" -H "$J" -d '{"entry":[{"changes":[{"field":"messages","value":{"messages":[{"from":"233559988776","type":"text","text":{"body":"1gb mtn"}}]}}]}]}')
ck "whatsapp quick order webhook accepted" "$(echo "$R_WA2" | jqget "['received']")" "True"

# Track order by reference
R_WA3=$(curl -s -X POST "$B/api/whatsapp/webhook" -H "$J" -d "{\"entry\":[{\"changes\":[{\"field\":\"messages\",\"value\":{\"messages\":[{\"from\":\"233241112222\",\"type\":\"text\",\"text\":{\"body\":\"track $REF\"}}]}}]}]}")
ck "whatsapp track order webhook accepted" "$(echo "$R_WA3" | jqget "['received']")" "True"

# Cancel command
R_WA4=$(curl -s -X POST "$B/api/whatsapp/webhook" -H "$J" -d '{"entry":[{"changes":[{"field":"messages","value":{"messages":[{"from":"233241112222","type":"text","text":{"body":"cancel"}}]}}]}]}')
ck "whatsapp cancel webhook accepted" "$(echo "$R_WA4" | jqget "['received']")" "True"

# Help command
R_WA5=$(curl -s -X POST "$B/api/whatsapp/webhook" -H "$J" -d '{"entry":[{"changes":[{"field":"messages","value":{"messages":[{"from":"233241112222","type":"text","text":{"body":"help"}}]}}]}]}')
ck "whatsapp help webhook accepted" "$(echo "$R_WA5" | jqget "['received']")" "True"

# Button reply (order)
R_WA6=$(curl -s -X POST "$B/api/whatsapp/webhook" -H "$J" -d '{"entry":[{"changes":[{"field":"messages","value":{"messages":[{"from":"233241112222","type":"interactive","interactive":{"type":"button_reply","button_reply":{"id":"order","title":"Buy Data"}}}]}}]}]}')
ck "whatsapp button reply webhook accepted" "$(echo "$R_WA6" | jqget "['received']")" "True"

echo "── 19. Referral program ──"
# Get or create referral code for the existing customer
R_REF=$(curl -s "$B/api/referrals" -H "Authorization: Bearer $CTOK")
HAS_CODE=$(echo "$R_REF" | python3 -c "import sys,json;d=json.load(sys.stdin);print(len(d.get('code',''))>0)")
ck "referral stats returns code" "$HAS_CODE" "True"
REF_CODE=$(echo "$R_REF" | jqget "['code']")

# Verify referral code (public endpoint)
R_VRFY=$(curl -s "$B/api/referrals/verify?code=$REF_CODE")
ck "referral code verification succeeds" "$(echo "$R_VRFY" | jqget "['valid']")" "True"
ck "referrer name returned" "$(echo "$R_VRFY" | jqget "['referrer_name']")" "Kofi"

# Invalid code
CODE_INVC=$(curl -s -o /dev/null -w '%{http_code}' "$B/api/referrals/verify?code=FAKE-XXXX")
ck "invalid referral code → 404" "$CODE_INVC" "404"

# New customer signs up with referral code
R_REF_SIGN=$(curl -s -X POST "$B/api/auth/customer" -H "$J" -d "{\"name\":\"Ama Serwaa\",\"phone\":\"0551234567\",\"pin\":\"5678\",\"referral_code\":\"$REF_CODE\"}")
RTOK=$(echo "$R_REF_SIGN" | jqget "['token']")
ck "customer signup with referral code" "${RTOK:0:3}" "eyJ"

# Self-referral should fail (use own code)
CODE_SELF=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/referrals/claim" -H "$J" -H "Authorization: Bearer $CTOK" -d "{\"code\":\"$REF_CODE\"}")
ck "self-referral rejected (400)" "$CODE_SELF" "400"

# Credit balance (should be 0 for both)
R_CRED=$(curl -s "$B/api/referrals/credits" -H "Authorization: Bearer $CTOK")
ck "referral credit balance returns 0" "$(echo "$R_CRED" | jqget "['balance']")" "0"

# Referral credits endpoint without auth → 401
CODE_CRED=$(curl -s -o /dev/null -w '%{http_code}' "$B/api/referrals/credits")
ck "referral credits without token → 401" "$CODE_CRED" "401"

# Referral stats endpoint without auth → 401
CODE_STATS=$(curl -s -o /dev/null -w '%{http_code}' "$B/api/referrals")
ck "referral stats without token → 401" "$CODE_STATS" "401"

echo "── 20. SMS notifications (mock mode) ──"
SMS_TEST=$(node -e "const s=require('./lib/sms');s.sendSMS('0241112222','Test message').then(r=>console.log(r.dev?'True':'False'))" 2>/dev/null | tail -1)
ck "SMS mock mode returns dev=true" "$SMS_TEST" "True"

SMS_TPL=$(node -e "const s=require('./lib/sms');console.log(s.templates.orderDelivered({reference:'VD-260812-0001',phone:'0241112222',size_mb:1024,network_code:'mtn'}).includes('delivered')?'True':'False')")
ck "SMS order delivered template correct" "$SMS_TPL" "True"

SMS_PROVIDER=$(node -e "const s=require('./lib/sms');console.log(s.provider())")
ck "SMS provider defaults to mock" "$SMS_PROVIDER" "mock"

echo "── 21. Referral credit spending at checkout ──"
# The customer (Kofi) has 0 credit — use_credit should be a no-op
R_CRED_ORDER=$(curl -s -X POST "$B/api/orders" -H "$J" -H "Authorization: Bearer $CTOK" -d '{"bundle_id":1,"phone":"0241112222","use_credit":true}')
ck "order with use_credit returns credit_applied field" "$(echo "$R_CRED_ORDER" | python3 -c "import sys,json;d=json.load(sys.stdin);print('credit_applied' in d)")" "True"
ck "credit_applied is 0 when balance is 0" "$(echo "$R_CRED_ORDER" | jqget "['credit_applied']")" "0"
# Order should still be created normally
ck "order created even with 0 credit" "$(echo "$R_CRED_ORDER" | jqget "['dev']")" "True"
# Simulate delivery for this order
CRED_REF=$(echo "$R_CRED_ORDER" | jqget "['reference']")
sim --ref "$CRED_REF" --amount 4.30 >/dev/null
ck "credit order delivers normally" "$(curl -s "$B/api/orders?reference=$CRED_REF" | jqget "['order']['status']")" "delivered"

echo "── 22. Reseller platform ──"
# No store yet
R_NOSTORE=$(curl -s "$B/api/store" -H "Authorization: Bearer $CTOK")
ck "no store returns null" "$(echo "$R_NOSTORE" | jqget "['store']")" "None"

# Store endpoint without auth → 401
CODE_STORE=$(curl -s -o /dev/null -w '%{http_code}' "$B/api/store")
ck "store endpoint without token → 401" "$CODE_STORE" "401"

# Create a store
R_STORE=$(curl -s -X POST "$B/api/store" -H "$J" -H "Authorization: Bearer $CTOK" -d '{"store_name":"Kofi Data Hub","tagline":"Cheapest data in Accra","markup_percent":15}')
ck "store created successfully" "$(echo "$R_STORE" | jqget "['ok']")" "True"
ck "store has slug" "$(echo "$R_STORE" | python3 -c "import sys,json;d=json.load(sys.stdin);print(len(d['store']['slug'])>0)")" "True"
STORE_SLUG=$(echo "$R_STORE" | jqget "['store']['slug']")

# Slug check
R_CHECK=$(curl -s "$B/api/store/check?slug=taken-slug-test")
ck "slug check returns available" "$(echo "$R_CHECK" | jqget "['available']")" "True"
R_CHECK2=$(curl -s "$B/api/store/check?slug=$STORE_SLUG")
ck "existing slug returns unavailable" "$(echo "$R_CHECK2" | jqget "['available']")" "False"

# Public store endpoint (no auth)
R_PUB=$(curl -s "$B/api/store/public?slug=$STORE_SLUG")
ck "public store returns name" "$(echo "$R_PUB" | jqget "['store']['store_name']")" "Kofi Data Hub"
ck "public store has markup" "$(echo "$R_PUB" | jqget "['store']['markup_percent']")" "15"

# Invalid store slug → 404
CODE_PUB=$(curl -s -o /dev/null -w '%{http_code}' "$B/api/store/public?slug=nonexistent-store")
ck "invalid store slug → 404" "$CODE_PUB" "404"

# Update store
R_UPD=$(curl -s -X POST "$B/api/store" -H "$J" -H "Authorization: Bearer $CTOK" -d '{"tagline":"Updated tagline","markup_percent":20}')
ck "store updated" "$(echo "$R_UPD" | jqget "['ok']")" "True"
ck "markup updated to 20" "$(echo "$R_UPD" | jqget "['store']['markup_percent']")" "20"

# Place an order through the reseller store (using store_slug)
R_RES_ORDER=$(curl -s -X POST "$B/api/orders" -H "$J" -H "Authorization: Bearer $CTOK" -d "{\"bundle_id\":1,\"phone\":\"0241112222\",\"store_slug\":\"$STORE_SLUG\"}")
ck "reseller order created" "$(echo "$R_RES_ORDER" | jqget "['dev']")" "True"
RES_REF=$(echo "$R_RES_ORDER" | jqget "['reference']")

# Deliver the reseller order
sim --ref "$RES_REF" --amount 4.30 >/dev/null
ck "reseller order delivered" "$(curl -s "$B/api/orders?reference=$RES_REF" | jqget "['order']['status']")" "delivered"

# Check earnings
R_EARN=$(curl -s "$B/api/store/earnings" -H "Authorization: Bearer $CTOK")
HAS_BAL=$(echo "$R_EARN" | python3 -c "import sys,json;d=json.load(sys.stdin);print('balance' in d)")
ck "earnings endpoint returns balance" "$HAS_BAL" "True"
HAS_ENT=$(echo "$R_EARN" | python3 -c "import sys,json;d=json.load(sys.stdin);print(len(d.get('entries',[]))>0)")
ck "earnings has entries" "$HAS_ENT" "True"

# Store orders list
R_SORD=$(curl -s "$B/api/store/orders" -H "Authorization: Bearer $CTOK")
HAS_ORD=$(echo "$R_SORD" | python3 -c "import sys,json;d=json.load(sys.stdin);print(len(d.get('orders',[]))>0)")
ck "store orders returns list" "$HAS_ORD" "True"

# Earnings without auth → 401
CODE_EARN=$(curl -s -o /dev/null -w '%{http_code}' "$B/api/store/earnings")
ck "earnings without token → 401" "$CODE_EARN" "401"

echo "── 23. OTP authentication ──"
# Send OTP
R_OTP=$(curl -s -X POST "$B/api/auth/otp/send" -H "$J" -d '{"phone":"0271234567"}')
ck "OTP send returns ok" "$(echo "$R_OTP" | jqget "['ok']")" "True"
HAS_CODE=$(echo "$R_OTP" | python3 -c "import sys,json;d=json.load(sys.stdin);print(len(d.get('dev_code',''))==6)")
ck "OTP send has dev_code in dev mode" "$HAS_CODE" "True"
OTP_CODE=$(echo "$R_OTP" | jqget "['dev_code']")

# Verify OTP (wrong code)
CODE_WRONG=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/auth/otp/verify" -H "$J" -d '{"phone":"0271234567","code":"000000"}')
ck "OTP wrong code → 401" "$CODE_WRONG" "401"

# Verify OTP (correct code → auto-creates account)
R_OTPV=$(curl -s -X POST "$B/api/auth/otp/verify" -H "$J" -d "{\"phone\":\"0271234567\",\"code\":\"$OTP_CODE\"}")
OTOK=$(echo "$R_OTPV" | jqget "['token']")
ck "OTP verify returns token" "${OTOK:0:3}" "eyJ"
ck "OTP creates new account" "$(echo "$R_OTPV" | jqget "['new_account']")" "True"

# Invalid phone
CODE_BADPHONE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/auth/otp/send" -H "$J" -d '{"phone":"12345"}')
ck "OTP invalid phone → 400" "$CODE_BADPHONE" "400"

# No code sent → verify fails
CODE_NOCODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/auth/otp/verify" -H "$J" -d '{"phone":"0551112233","code":"123456"}')
ck "OTP verify without send → 400" "$CODE_NOCODE" "400"

echo "── 24. Admin overview endpoint ──"
R_OV=$(curl -s "$B/api/admin/overview" -H "Authorization: Bearer $TOK")
HAS_WA=$(echo "$R_OV" | python3 -c "import sys,json;d=json.load(sys.stdin);print('active_sessions' in d.get('whatsapp',{}))")
ck "overview returns whatsapp stats" "$HAS_WA" "True"
HAS_REF=$(echo "$R_OV" | python3 -c "import sys,json;d=json.load(sys.stdin);print('total' in d.get('referrals',{}))")
ck "overview returns referral stats" "$HAS_REF" "True"
HAS_RES=$(echo "$R_OV" | python3 -c "import sys,json;d=json.load(sys.stdin);print('active' in d.get('resellers',{}))")
ck "overview returns reseller stats" "$HAS_RES" "True"
HAS_CH=$(echo "$R_OV" | python3 -c "import sys,json;d=json.load(sys.stdin);print(len(d.get('orders_by_channel',{}))>0)")
ck "overview returns channel breakdown" "$HAS_CH" "True"

# Overview without auth → 401
CODE_OV=$(curl -s -o /dev/null -w '%{http_code}' "$B/api/admin/overview")
ck "overview without token → 401" "$CODE_OV" "401"

echo "── 25. New static pages ──"
for p in /terms.html /privacy.html /about.html /contact.html /faq.html /otp.html /store.html /storefront.html; do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' "$B$p")
  ck "page $p" "$CODE" "200"
done

echo "── 26. WhatsApp delivery confirmations ──"
# The WhatsApp bot already tags orders with channel=whatsapp (tested in §18)
# Verify the notify module handles whatsapp_from correctly
WA_NOTIFY=$(node -e "
const n=require('./lib/notify');
n.send('order.receipt',{phone:'0241112222',reference:'VD-TEST-0001',size_mb:1024,network_code:'mtn',whatsapp_from:'233241112222',channel:'whatsapp'}).then(r=>console.log('ok'))
" 2>/dev/null | tail -1)
ck "WhatsApp delivery notification fires" "$WA_NOTIFY" "ok"


echo "── 27. purchase history ──"
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$B/api/account/history")
ck "history requires a customer token (401)" "$CODE" "401"
H=$(curl -s "$B/api/account/history?per_page=5" -H "Authorization: Bearer $CTOK")
ck "history returns orders" "$(echo "$H" | python3 -c "import sys,json;print(len(json.load(sys.stdin)['orders'])>0)")" "True"
ck "history order carries a tracking number" "$(echo "$H" | python3 -c "import sys,json;print(json.load(sys.stdin)['orders'][0]['track'].isdigit())")" "True"
ck "history order carries a size label" "$(echo "$H" | python3 -c "import sys,json;o=json.load(sys.stdin)['orders'][0];print(bool(o['size_label']))")" "True"
ck "history order carries a plain-English explainer" "$(echo "$H" | python3 -c "import sys,json;o=json.load(sys.stdin)['orders'][0];print(bool(o['explain']['title'] and o['explain']['body']))")" "True"
ck "history exposes delivery progress" "$(echo "$H" | python3 -c "import sys,json;p=json.load(sys.stdin)['progress'];print(bool(p['notice']) and 'checked_at' in p)")" "True"
ck "history totals add up" "$(echo "$H" | python3 -c "
import sys,json;t=json.load(sys.stdin)['totals']
print(t['all'] == t['processing']+t['delivered']+t['failed']+t['refunded'])")" "True"
HP=$(curl -s "$B/api/account/history?per_page=1" -H "Authorization: Bearer $CTOK")
ck "history paginates" "$(echo "$HP" | python3 -c "import sys,json;d=json.load(sys.stdin);print(len(d['orders'])==1 and d['pages']>=1)")" "True"
HQ=$(curl -s "$B/api/account/history?q=zzzznomatch" -H "Authorization: Bearer $CTOK")
ck "history search filters out non-matches" "$(echo "$HQ" | python3 -c "import sys,json;print(len(json.load(sys.stdin)['orders']))")" "0"
HN=$(curl -s "$B/api/account/history?network=telecel" -H "Authorization: Bearer $CTOK")
ck "history network filter is respected" "$(echo "$HN" | python3 -c "import sys,json;print(all(o['network']=='telecel' for o in json.load(sys.stdin)['orders']))")" "True"
HS=$(curl -s "$B/api/account/history?status=delivered" -H "Authorization: Bearer $CTOK")
ck "history status filter is respected" "$(echo "$HS" | python3 -c "import sys,json;print(all(o['status_group']=='delivered' for o in json.load(sys.stdin)['orders']))")" "True"

echo ""
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] && [ "$PASS" -ge 140 ]
