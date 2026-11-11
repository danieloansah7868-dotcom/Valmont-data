/* Website-building deposits: separate from data orders and supplier delivery. */
const { db } = require('./supabase');
const { json, readRawBody } = require('./http');
const valmontpay = require('./valmontpay');
const { siteOrigin, isDeployment } = require('./runtime');
const phones = require('./phones');

const PACKAGES = Object.freeze({ Starter: 1750, Popular: 2500, 'Auto-Sell': 3250 });
const REF = /^WD-[a-f0-9]{32}$/;
const NETWORKS = ['MTN', 'Telecel', 'AirtelTigo'];
const text = (v, max) => typeof v === 'string' ? v.trim().slice(0, max) : '';
async function find(reference) {
  return (await db.select({ from: 'website_requests', where: { reference: `eq.${reference}` }, limit: 1 }))[0] || null;
}
function publicStatus(row) {
  return { reference: row.reference, package: row.package, amount: Number(row.amount), status: row.status };
}
async function api(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') {
    const reference = new URL(req.url, 'http://local').searchParams.get('reference') || '';
    if (!REF.test(reference)) return json(res, 400, { error: 'Invalid reference' });
    const row = await find(reference);
    if (!row) return json(res, 404, { error: 'Request not found' });
    return json(res, 200, { request: publicStatus(row), checkout_url: row.status === "awaiting_payment" ? row.checkout_url : null });
  }
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  const body = await readRawBody(req).then((raw) => { try { return JSON.parse(raw); } catch { return null; } });
  if (!body || !REF.test(String(body.reference || ''))) return json(res, 400, { error: 'Invalid request reference' });
  // The reference is an idempotency key. Never create another checkout for it.
  const existing = await find(body.reference);
  if (existing) return json(res, 200, { request: publicStatus(existing), checkout_url: existing.checkout_url || null });
  if (!Object.hasOwn(PACKAGES, body.package)) return json(res, 400, { error: 'Select a valid package' });
  const name = text(body.name, 100), business = text(body.business, 100), colours = text(body.colours, 120);
  const phone = phones.validate(body.phone);
  const networks = Array.isArray(body.networks) ? [...new Set(body.networks)] : [];
  if (!name || !business || !colours || !phone.valid || !networks.length || networks.some((n) => !NETWORKS.includes(n))) {
    return json(res, 400, { error: 'Please check your name, Ghana phone number, brand colours and network selection.' });
  }
  try { valmontpay.assertLiveReady(); } catch { return json(res, 503, { error: 'Deposit checkout is not configured yet. Please contact us before paying.' }); }
  if (!valmontpay.configured()) return json(res, 503, { error: 'Deposit checkout is not configured yet. Please contact us before paying.' });
  const origin = isDeployment() ? siteOrigin() : (req.headers['x-forwarded-host'] ? `https://${req.headers['x-forwarded-host']}` : siteOrigin());
  const row = { reference: body.reference, package: body.package, amount: PACKAGES[body.package], customer_name: name, phone: phone.normalized, business, colours, networks,
    domain: text(body.domain, 160), features: text(body.features, 1200), notes: text(body.notes, 800), status: 'initializing' };
  try { await db.insert('website_requests', row); }
  catch (e) {
    // A concurrent request with the same key may have won the insert.
    const duplicate = await find(body.reference);
    if (duplicate) return json(res, 200, { request: publicStatus(duplicate), checkout_url: duplicate.checkout_url || null });
    throw e;
  }
  try {
    const checkout = await valmontpay.createCheckout({ reference: row.reference, amount: row.amount, phone: row.phone,
      description: `Website ${row.package} deposit`, returnUrl: `${origin}/website-payment.html?reference=${row.reference}` });
    if (!checkout.checkout_url || checkout.dev) throw new Error('No live checkout URL');
    const updated = await db.update('website_requests', { checkout_url: checkout.checkout_url, status: 'awaiting_payment' }, { reference: `eq.${row.reference}`, status: 'eq.initializing' });
    const current = updated[0] || await find(row.reference);
    return json(res, 201, { request: publicStatus(current), checkout_url: current.checkout_url || null });
  } catch (err) {
    // Gateway may have created a checkout before the connection failed. Never
    // initialize again with this reference; an operator must reconcile it.
    await db.update('website_requests', { status: 'checkout_unknown' }, { reference: `eq.${row.reference}`, status: 'eq.initializing' });
    console.error('[website-deposits] checkout requires reconciliation:', err.message);
    return json(res, 503, { error: 'Checkout could not be confirmed. Do not pay again; contact us with your reference.', reference: row.reference });
  }
}
async function handleWebhook(reference, providerReference, amount) {
  const row = await find(reference);
  if (!row) return { unknown: true };
  const amountNumber = Number(amount);
  const correct = amount !== null && amount !== undefined && amount !== '' && Number.isFinite(amountNumber) && Math.round(amountNumber * 100) === Math.round(Number(row.amount) * 100) && Math.abs(amountNumber * 100 - Math.round(amountNumber * 100)) < 0.000001;
  const updates = { provider_reference: providerReference, received_amount: Number.isFinite(amountNumber) ? amountNumber : null,
    status: correct ? 'paid' : 'payment_review', paid_at: correct ? new Date().toISOString() : null };
  const claimed = await db.update('website_requests', updates, { id: `eq.${row.id}`, provider_reference: 'is.null' });
  return claimed.length ? { outcome: updates.status } : { duplicate: true };
}
module.exports = { api, find, handleWebhook, PACKAGES, REF };
