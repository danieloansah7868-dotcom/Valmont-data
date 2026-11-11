(function () {
  'use strict';
  const form = document.getElementById('websiteRequest');
  const networkError = document.getElementById('networkError');
  const error = document.getElementById('paymentError');
  const button = document.getElementById('depositButton');
  const pending = document.getElementById('pendingLink');
  const storageKey = 'vd_website_deposit_reference';
  let reference = sessionStorage.getItem(storageKey);
  function showReference() {
    if (!reference) return;
    document.getElementById('pendingReference').textContent = reference;
    document.getElementById('pendingStatus').href = '/website-payment.html?reference=' + encodeURIComponent(reference);
    pending.hidden = false;
  }
  showReference();
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const networks = data.getAll('networks');
    if (!networks.length) { networkError.hidden = false; form.querySelector('[name="networks"]').focus(); return; }
    networkError.hidden = true; error.hidden = true;
    if (reference) {
      error.textContent = 'You already have a request in progress. Check its status before paying again.';
      error.hidden = false; showReference(); return;
    }
    const bytes = new Uint8Array(16); crypto.getRandomValues(bytes);
    reference = 'WD-' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    sessionStorage.setItem(storageKey, reference);
    button.disabled = true;
    const payload = { reference, networks };
    for (const key of ['package', 'name', 'phone', 'business', 'domain', 'colours', 'features', 'notes']) payload[key] = data.get(key) || '';
    try {
      const res = await fetch('/api/website-deposits', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const result = await res.json();
      if (!res.ok) {
        if (res.status === 400 || (res.status === 503 && !result.reference && result.error === 'Deposit checkout is not configured yet. Please contact us before paying.')) {
          sessionStorage.removeItem(storageKey); reference = null;
        }
        throw new Error(result.error || 'Checkout could not be confirmed.');
      }
      if (result.checkout_url) { window.location.assign(result.checkout_url); return; }
      window.location.assign('/website-payment.html?reference=' + encodeURIComponent(reference));
    } catch (err) {
      error.textContent = err.message + (reference ? ' Keep your reference and contact us before paying again.' : '');
      error.hidden = false; showReference(); button.disabled = false;
    }
  });
})();
