/* Data sales are temporarily paused. Set DATA_SALES_PAUSED=0 and redeploy to
   reopen; existing paid orders can still be fulfilled and tracked. */
function paused() { return String(process.env.DATA_SALES_PAUSED || '1').trim() !== '0'; }
function assertOpen() {
  if (paused()) { const err = new Error('All data bundles are currently out of stock. Please check back later.'); err.status = 503; err.code = 'DATA_OUT_OF_STOCK'; throw err; }
}
module.exports = { paused, assertOpen };
