'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const script = fs.readFileSync('assets/js/website-request.js', 'utf8');
const page = fs.readFileSync('build-your-website.html', 'utf8');
assert(page.includes('id="depositButton"') && !page.includes('id="sendWhatsapp"'), 'one button starts both steps');
assert(page.includes('Tap Send in WhatsApp'), 'customer is told to send the prepared message');

function makePage(overrides = {}, options = {}) {
  const values = { package: 'Popular', name: 'Ama & Sons', phone: '0241234567', business: 'Ama Data', domain: '', colours: 'navy & orange', features: 'Orders\nTracking', notes: 'Use our logo', networks: ['MTN', 'Telecel'], consent:'on', ...overrides };
  const nodes = {};
  for (const name of ['networkError', 'paymentError', 'depositButton', 'pendingLink', 'pendingReference', 'pendingStatus', 'whatsappReady', 'whatsappLink', 'checkoutFallback', 'checkoutLink']) nodes[name] = { hidden: true, textContent: '', href: '', disabled: false };
  const focus = { value: null };
  let submit;
  const form = { addEventListener(name, callback) { assert.equal(name, 'submit'); submit = callback; }, querySelector(selector) { return { focus() { focus.value = selector; } }; } };
  const store = new Map(), opened = [], sent = [], navigation = [];
  const document = { getElementById(id) { return id === 'websiteRequest' ? form : nodes[id]; } };
  const sessionStorage = { getItem: (key) => store.get(key) || null, setItem: (key,value) => store.set(key, value), removeItem: (key) => store.delete(key) };
  class FormDataMock { get(key) { return values[key] || null; } getAll(key) { return key === 'networks' ? values.networks : []; } }
  const location = { assign(url) { navigation.push(url); } };
  const context = { document, sessionStorage, FormData: FormDataMock, Uint8Array, crypto: { getRandomValues(bytes) { bytes.fill(1); } }, window: { open(url, target) { assert.equal(url, ''); assert.equal(target, '_blank'); if (options.blocked) return null; return { opener:'current window', location: { replace(destination) { opened.push(destination); } }, close() {} }; }, location }, location, fetch: async (url, request) => { sent.push({url, request}); return options.response || { ok: true, json: async () => ({checkout_url:'https://payments.example/checkout'}) }; }, encodeURIComponent };
  vm.runInNewContext(script, context);
  return { nodes, store, opened, sent, navigation, focus, values, submit: () => submit({ preventDefault() {} }) };
}

(async () => {
  const page = makePage();
  await page.submit();
  assert.equal(page.opened.length, 1, 'one click opens WhatsApp');
  assert.equal(page.sent.length, 1, 'same click initializes deposit checkout');
  const url = new URL(page.opened[0]);
  assert.equal(url.origin + url.pathname, 'https://wa.me/233542451578');
  const text = url.searchParams.get('text');
  for (const expected of ['Popular', 'Ama & Sons', '0241234567', 'Ama Data', 'Not specified', 'navy & orange', 'MTN, Telecel', 'Orders\nTracking', 'Use our logo']) assert(text.includes(expected), 'message contains ' + expected);
  assert(!text.includes('Deposit confirmed'), 'message does not claim payment');
  const body = JSON.parse(page.sent[0].request.body);
  assert.equal(body.package, 'Popular'); assert.deepEqual(body.networks, ['MTN', 'Telecel']);
  assert(/^WD-[0-9a-f]{32}$/.test(body.reference));
  assert(text.includes(body.reference), 'message contains the checkout reference');
  assert.equal(page.navigation[0], 'https://payments.example/checkout');
  assert.equal(page.store.size, 1, 'only a reference is kept locally');
  await page.submit();
  assert.equal(page.sent.length, 1, 'pending reference prevents duplicate checkout');
  assert.equal(page.opened.length, 1, 'pending reference does not open another chat');

  const blocked = makePage({}, {blocked:true});
  await blocked.submit();
  assert.equal(blocked.opened.length, 0);
  assert.equal(blocked.navigation.length, 0, 'stay on form when WhatsApp popup is blocked');
  assert.equal(blocked.nodes.whatsappReady.hidden, false);
  assert.equal(blocked.nodes.checkoutFallback.hidden, false);
  assert(blocked.nodes.whatsappLink.href.startsWith('https://wa.me/233542451578?text='));
  assert.equal(blocked.nodes.checkoutLink.href, 'https://payments.example/checkout');
  await blocked.submit(); assert.equal(blocked.sent.length, 1, 'blocked popup does not create a duplicate checkout');

  const noConsent = makePage({consent:null});
  await noConsent.submit(); assert.equal(noConsent.opened.length, 0); assert.equal(noConsent.sent.length, 0);
  assert.equal(noConsent.focus.value, '[name="consent"]');
  const empty = makePage({networks: []});
  await empty.submit(); assert.equal(empty.opened.length, 0); assert.equal(empty.nodes.networkError.hidden, false);
  assert.equal(empty.focus.value, '[name="networks"]');
  const unavailable = makePage({}, {response: {ok:false, status:503, json:async () => ({error:'Deposit checkout is not configured yet. Please contact us before paying.'})}});
  await unavailable.submit(); assert.equal(unavailable.opened.length, 1); assert.equal(unavailable.navigation.length, 0);
  assert.equal(unavailable.store.size, 0, 'known configuration failure permits a new attempt');
  assert.equal(unavailable.nodes.paymentError.hidden, false);
  const unknown = makePage({}, {response: {ok:false, status:503, json:async () => ({error:'Checkout could not be confirmed.', reference:'WD-' + '01'.repeat(16)})}});
  await unknown.submit(); assert.equal(unknown.store.size, 1, 'ambiguous checkout keeps the idempotency key');
  await unknown.submit(); assert.equal(unknown.sent.length, 1, 'ambiguous checkout is not retried');
  console.log('One-click WhatsApp and deposit flow checks passed');
})().catch((err) => { console.error(err); process.exit(1); });
