/* ============================================================================
   ValmontAI brain test — zero-dependency, run with: node scripts/test-valmontai.js
   Stubs fetch() so the widget's live-stock sync can be exercised in Node
   (the UI layer itself is browser-only). Tests every rule in the FINAL
   ValmontAI prompt plus the example conversations.
   ============================================================================ */

const path = require('path');
const Module = require('module');

let stockMock = null; // set per scenario

// Stub fetch before requiring the widget.
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes('/valmontai-data-config.json')) {
    return { ok: false, status: 404, json: async () => ({}) }; // defaults stand
  }
  if (u.includes('/api/bundles')) {
    if (stockMock instanceof Error) throw stockMock;
    return { ok: stockMock ? true : false, status: stockMock ? 200 : 503, json: async () => stockMock || {} };
  }
  throw new Error('unexpected fetch: ' + u);
};
// Require the widget — it exports its brain because module.exports exists.
const ai = require(path.join(__dirname, '..', 'assets', 'js', 'valmontai.js'));

let passed = 0;
let failed = 0;
function check(name, cond, detail) {
  if (cond) {
    passed++;
    console.log('  ✅ ' + name);
  } else {
    failed++;
    console.log('  ❌ ' + name + (detail ? '\n     → ' + detail : ''));
  }
}

async function setStock(snapshot) {
  stockMock = snapshot;
  await ai.loadStock(true);
}

(async () => {
  console.log('\nValmontAI rule tests — all networks in stock:\n');
  const allInStock = {
    networks: [
      { code: 'mtn', name: 'MTN' },
      { code: 'telecel', name: 'Telecel' },
      { code: 'airteltigo', name: 'AirtelTigo' },
    ],
    bundles: [
      ...[1, 2, 3, 4].map((i) => ({ id: 'm' + i, network: 'mtn', available: true })),
      ...[1, 2, 3].map((i) => ({ id: 't' + i, network: 'telecel', available: true })),
      ...[1, 2].map((i) => ({ id: 'a' + i, network: 'airteltigo', available: true })),
    ],
  };
  await setStock(allInStock);

  let r = await ai.answerFor('Hello');
  check('Rule 1 greeting', r.text.includes('Hello! Welcome to Valmont Data. How can I help you buy data today?'), r.text);

  r = await ai.answerFor('How do I buy MTN data?');
  check('Rule 2 how-to-buy (prompt example)',
    r.text.includes('Choose') && r.text.includes('network') && r.text.includes('30 seconds') && r.text.includes('auto-credited'), r.text);

  r = await ai.answerFor('Is MTN available?');
  check('Rule 3 live stock — MTN available shows live count',
    r.text.includes('MTN is available') && r.text.includes('4'), r.text);

  r = await ai.answerFor('Telecel stock?');
  check('Rule 3 live stock — Telecel available', r.text.includes('Telecel is available'), r.text);

  r = await ai.answerFor('What bundles do you have?');
  check('Rule 3 general stock — all networks reported in stock',
    r.text.includes('All networks are in stock'), r.text);

  r = await ai.answerFor('How long does delivery take?');
  check('Rule 4 delivery', r.text.includes('30-Second Instant Delivery') && r.text.includes('after payment'), r.text);

  r = await ai.answerFor('I entered wrong number');
  check('Rule 5 wrong number (prompt example)',
    r.text.includes('double-check') && r.text.includes('not refundable') && r.text.includes('0542451578'), r.text);

  r = await ai.answerFor('How do I track my order?');
  check('Rule 6 track order (prompt example)',
    r.text.includes('Track Order menu') && r.actions.some((a) => a.href === '/status.html'), r.text);

  r = await ai.answerFor("I haven't received my data");
  check('Missing delivery → tracking + WhatsApp',
    r.text.includes('Track Order menu') && r.actions.some((a) => a.href.includes('wa.me')), r.text);

  r = await ai.answerFor('How do I install the app?');
  check('Rule 7 install', r.text.includes('one-tap access') && r.text.includes('home-screen icon') && r.text.includes('offline load'), r.text);

  r = await ai.answerFor('Do you take mobile money?');
  check('Payment method answer', r.text.includes('Mobile Money') && r.text.includes('card'), r.text);

  r = await ai.answerFor('How much is 1GB?');
  check('Rule 9 never invents price — directs to live section',
    r.text.includes('Buy Data') && !/\bgh[sc]?\s*\d/i.test(r.text), r.text);

  r = await ai.answerFor('What is your return policy on bundles?');
  check('Rule 8 unknown → WhatsApp', r.text.includes('WhatsApp 0542451578'), r.text);

  r = await ai.answerFor('Thank you!');
  check('Thanks handled gracefully', /welcome/i.test(r.text), r.text);

  r = await ai.answerFor('Can I speak to a human?');
  check('Human/contact → WhatsApp', r.text.includes('WhatsApp 0542451578') && r.text.includes('24/7'), r.text);

  console.log('\nValmontAI rule tests — MTN paused (out of stock):\n');
  const mtnOut = {
    networks: allInStock.networks,
    bundles: allInStock.bundles.map((b) => (b.network === 'mtn' ? { ...b, available: false } : b)),
  };
  await setStock(mtnOut);

  r = await ai.answerFor('Is MTN available?');
  check('MTN out → low-stock notice names MTN',
    r.text.includes('MTN') && r.text.includes('running low on stock') && r.text.includes('restock'), r.text);

  r = await ai.answerFor('Can I buy Telecel now?');
  check('Telecel still available while MTN is down', r.text.includes('Telecel is available'), r.text);

  r = await ai.answerFor('Any bundles available?');
  check('General stock mentions which network is down',
    r.text.includes('MTN') && r.text.includes('running low') && r.text.includes('Telecel'), r.text);

  r = await ai.answerFor('AirtelTigo?');
  check('Bare network name → stock answer', r.text.includes('AirtelTigo is available'), r.text);

  console.log('\nValmontAI rule tests — live API unreachable (config fallback):\n');
  await setStock(new Error('network down'));

  r = await ai.answerFor('Is MTN available?');
  check('API down → configured stock notice (never invent)',
    r.text.includes('running low') && r.text.includes('Other networks are unaffected'), r.text);

  r = await ai.answerFor('How do I buy data?');
  check('API down — how-to still answers fully',
    r.text.includes('Choose your network') && r.text.includes('30 seconds'), r.text);

  r = await ai.answerFor('refund please');
  check('Wrong-number/refund still answers with warning', r.text.includes('not refundable'), r.text);

  console.log('\nValmontAI — response shape / safety:\n');
  check('WhatsApp action is a proper wa.me link',
    r.actions && r.actions.some((a) => /^https:\/\/wa\.me\/233542451578/.test(a.href)),
    JSON.stringify(r.actions));
  check('Network detector: "airtel" → airteltigo', ai.detectNetwork('do you have airtel bundles') === 'airteltigo');
  check('Network detector: "vodafone" → telecel', ai.detectNetwork('vodafone data') === 'telecel');
  check('Network detector: none → null', ai.detectNetwork('how do I track my order') === null);

  const long = await ai.answerFor('hello');
  check('Responses are brief (2-3 lines)', long.text.split('\n').length <= 3, long.text);

  console.log('\n' + (failed ? '❌ ' + failed + ' FAILED' : '✅ All ' + passed + ' ValmontAI tests passed') + '\n');
  process.exit(failed ? 1 : 0);
})();
