'use strict';
const assert = require('assert');
process.env.SUPABASE_MOCK = '1';
process.env.AUTH_SECRET = 'test-auth-secret';
process.env.VALMONTPAY_API_KEY = 'test-key';
process.env.VALMONTPAY_WEBHOOK_SECRET = 'test-secret';
process.env.VALMONTPAY_MODE = 'live';
const crypto = require('crypto');
const vp = require('../lib/valmontpay');
let calls = 0;
vp.createCheckout = async ({ reference, amount }) => { calls++; const expected = reference.endsWith('d'.repeat(32)) ? 1750 : reference.endsWith('e'.repeat(32)) ? 3250 : 2500; assert.equal(amount, expected); return { checkout_url: 'https://example.com/pay/' + reference }; };
const deposits = require('../lib/website-deposits');
const webhook = require('../api/valmontpay/webhook');
function response() { return { statusCode: 200, setHeader() {}, end(data) { this.body = JSON.parse(data); } }; }
async function api(method, body, url) { const res = response(); await deposits.api({method, rawBody: JSON.stringify(body), url: url || '/api/website-deposits', headers: {}}, res); return res; }
async function hook(reference, amount, signatureGood = true) {
  const raw = JSON.stringify({event:'charge.success', data: {reference, amount, gateway_reference:'GATEWAY-' + reference}});
  const sig = crypto.createHmac('sha512', process.env.VALMONTPAY_WEBHOOK_SECRET).update(raw).digest('hex');
  const res = response(); await webhook({ method:'POST', rawBody:raw, url:'/api/valmontpay/webhook', headers:{'x-valmontpay-signature': signatureGood ? sig : 'bad'} }, res); return res;
}
(async () => {
  const ref = 'WD-' + 'a'.repeat(32);
  const body = { reference:ref, package:'Popular', name:'Kofi', phone:'0241234567', business:'Example', colours:'navy', networks:['MTN'], amount:1 };
  let r = await api('POST', body); assert.equal(r.statusCode, 201); assert.equal(r.body.request.amount, 2500); assert.equal(calls, 1);
  r = await api('POST', body); assert.equal(r.statusCode, 200); assert.equal(calls, 1);
  r = await hook(ref, 2500, false); assert.equal(r.statusCode, 401); assert.equal((await deposits.find(ref)).status, 'awaiting_payment');
  r = await hook(ref, 2500); assert.equal(r.body.outcome, 'paid'); assert.equal((await deposits.find(ref)).status, 'paid');
  r = await hook(ref, 2500); assert.equal(r.body.duplicate, true);
  const ref2 = 'WD-' + 'b'.repeat(32); await api('POST', {...body, reference:ref2});
  r = await hook(ref2, 1); assert.equal(r.body.outcome, 'payment_review'); assert.equal((await deposits.find(ref2)).status, 'payment_review');
  r = await api('GET', null, '/api/website-deposits?reference=' + ref2); assert.equal(r.body.request.status, 'payment_review'); assert.equal(r.body.request.phone, undefined);
  r = await api('POST', {...body, reference:'WD-' + 'c'.repeat(32), package:'Invalid'}); assert.equal(r.statusCode, 400);
  r = await api('POST', {...body, reference:'WD-' + 'd'.repeat(32), package:'Starter', amount:1}); assert.equal(r.body.request.amount, 1750);
  r = await api('POST', {...body, reference:'WD-' + 'e'.repeat(32), package:'Auto-Sell', amount:1}); assert.equal(r.body.request.amount, 3250);
  console.log('Website deposit checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
