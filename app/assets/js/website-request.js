(function () {
  'use strict';
  const form = document.getElementById('websiteRequest');
  const networkError = document.getElementById('networkError');
  const error = document.getElementById('paymentError');
  const button = document.getElementById('depositButton');
  const pending = document.getElementById('pendingLink');
  const whatsappReady = document.getElementById('whatsappReady');
  const whatsappLink = document.getElementById('whatsappLink');
  const checkoutFallback = document.getElementById('checkoutFallback');
  const checkoutLink = document.getElementById('checkoutLink');
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
    if (!data.get('consent')) {
      error.textContent = 'Please confirm the deposit and balance terms before continuing.';
      error.hidden = false; form.querySelector('[name="consent"]').focus(); return;
    }
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
    const value = (key) => String(payload[key] || '').trim();
    const message = [
      'Hello Valmont Data, I would like to request a data website.', '',
      'Package: ' + value('package'),
      'Name: ' + value('name'),
      'Contact number: ' + value('phone'),
      'Business or website name: ' + value('business'),
      'Preferred domain: ' + (value('domain') || 'Not specified'),
      'Brand colours: ' + value('colours'),
      'Networks: ' + networks.join(', '),
      'Website features: ' + (value('features') || 'Not specified'),
      'Additional details: ' + (value('notes') || 'Not specified'),
      'Request reference: ' + reference, '',
      'My deposit is handled separately through Valmont-Pay. Please check its status using the reference.',
      'I will attach my logo here if I have one.'
    ].join('\n');
    whatsappLink.href = 'https://wa.me/233542451578?text=' + encodeURIComponent(message);
    whatsappReady.hidden = false;
    checkoutFallback.hidden = true;
    // Open the chat during the user gesture so popup blockers do not intercept it.
    // No message is sent until the customer presses Send in WhatsApp.
    let opened = false;
    let popup = null;
    try {
      popup = window.open('', '_blank');
      if (popup) {
        popup.opener = null;
        popup.location.replace(whatsappLink.href);
        opened = true;
      }
    } catch (_) {
      if (popup) try { popup.close(); } catch (_) { /* already closed */ }
    }
    try {
      const res = await fetch('/api/website-deposits', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const result = await res.json();
      if (!res.ok) {
        if (res.status === 400 || (res.status === 503 && !result.reference && result.error === 'Deposit checkout is not configured yet. Please contact us before paying.')) {
          sessionStorage.removeItem(storageKey); reference = null;
        }
        throw new Error(result.error || 'Checkout could not be confirmed.');
      }
      const destination = result.checkout_url || '/website-payment.html?reference=' + encodeURIComponent(reference);
      if (opened) {
        window.location.assign(destination);
      } else {
        // Keep both actions available rather than losing the WhatsApp link if a popup was blocked.
        checkoutLink.href = destination;
        checkoutFallback.hidden = false;
        showReference();
      }
    } catch (err) {
      error.textContent = err.message + (reference ? ' Keep your reference and contact us before paying again.' : '');
      error.hidden = false; showReference(); button.disabled = false;
    }
  });
})();
