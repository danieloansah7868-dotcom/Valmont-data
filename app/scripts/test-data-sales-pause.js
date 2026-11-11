'use strict';
const assert = require('assert');
process.env.SUPABASE_MOCK = '1';
process.env.AUTH_SECRET = 'test-secret';
process.env.DATA_SALES_PAUSED = '1';
const { sign } = require('../lib/auth');
const orders = require('../lib/orders');
const autoReload = require('../lib/autoreload');
const bundles = require('../api/bundles');
const apiOrders = require('../api/orders');
function response() { return { statusCode: 200, setHeader() {}, end(data) { this.body = JSON.parse(data); } }; }
(async () => {
  await orders.addFloatEntry(1, 'topup', 10000, null, 'test');
  let res = response(); await bundles({ method: 'GET', url: '/api/bundles', headers: {} }, res);
  assert.equal(res.body.sales_paused, true);
  assert(res.body.bundles.length > 0 && res.body.bundles.every((b) => !b.available), 'all networks must be out of stock despite float');
  const bundle = await orders.findBundleById(1);
  await assert.rejects(() => orders.createOrder(bundle, '0241234567', bundle.network_id, 1), (e) => e.code === 'DATA_OUT_OF_STOCK');
  res = response(); await apiOrders({method:'POST', url:'/api/orders', headers:{authorization:'Bearer ' + sign({role:'customer',id:1})}, rawBody:JSON.stringify({bundle_id:1,phone:'0241234567'})}, res);
  assert.equal(res.statusCode,503); assert.equal(res.body.code,'DATA_OUT_OF_STOCK');
  const reload = await autoReload.triggerReload({bundle_id:1,network_id:1,phone:'0241234567'});
  assert.equal(reload.triggered,false); assert.equal(reload.reason,'data bundles out of stock');
  process.env.DATA_SALES_PAUSED = '0';
  res = response(); await bundles({ method: 'GET', url: '/api/bundles', headers: {} }, res);
  assert.equal(res.body.sales_paused,false); assert(res.body.bundles.some((b) => b.network === 'mtn' && b.available));
  console.log('Data sales pause checks passed');
})().catch((error) => { console.error(error); process.exit(1); });
