(function () {
  'use strict';
  const ref = new URLSearchParams(location.search).get('reference') || '';
  const title = document.getElementById('statusTitle'), msg = document.getElementById('statusMessage');
  const resume = document.getElementById('resumeCheckout');
  document.getElementById('statusRef').textContent = ref || 'Not provided';
  document.getElementById('contactWhatsapp').href = 'https://wa.me/233542451578?text=' + encodeURIComponent('Hello, I need help with my website request. Reference: ' + ref);
  async function check() {
    resume.hidden = true;
    if (!/^WD-[a-f0-9]{32}$/.test(ref)) { title.textContent = 'Invalid reference'; msg.textContent = 'Please check your reference or contact us.'; return; }
    try {
      const response = await fetch('/api/website-deposits?reference=' + encodeURIComponent(ref), { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to check your request');
      const r = data.request;
      if (r.status === 'paid') {
        title.textContent = 'Deposit confirmed';
        document.getElementById('newRequest').hidden = false;
        msg.textContent = r.package + ' package: GH₵' + Number(r.amount).toFixed(2) + ' received. Your request is saved. Contact us to share your logo and discuss the build.';
      } else if (r.status === 'payment_review' || r.status === 'checkout_unknown') {
        title.textContent = 'Payment needs review'; msg.textContent = 'Do not pay again. Please contact us with your reference so we can check with Valmont-Pay.';
      } else {
        title.textContent = 'Waiting for payment confirmation'; msg.textContent = 'Your deposit is not confirmed yet. If you have paid, wait and refresh this page. Do not start another payment.';
        if (r.status === 'awaiting_payment' && data.checkout_url) { resume.href = data.checkout_url; resume.hidden = false; }
      }
    } catch (e) { title.textContent = 'Unable to check status'; msg.textContent = 'Please try again or contact us with your reference. Do not pay again until your payment is checked.'; }
  }
  document.getElementById('newRequest').addEventListener('click', () => {
    if (sessionStorage.getItem('vd_website_deposit_reference') === ref) sessionStorage.removeItem('vd_website_deposit_reference');
    location.assign('/build-your-website.html');
  });
  document.getElementById('refreshStatus').addEventListener('click', check);
  check();
})();
