/* Keep catalogue landing pages in step with the live data-sales pause. */
(function () {
  'use strict';
  fetch('/api/bundles', { cache: 'no-store' }).then((response) => {
    if (!response.ok) throw new Error('Stock unavailable');
    return response.json();
  }).then((data) => {
    if (!data.sales_paused) return;
    const notice = document.getElementById('catalogueStockNotice');
    if (notice) notice.hidden = false;
    document.querySelectorAll('a[href^="/?net="], a[href="/#buy"]').forEach((link) => {
      if (!/buy/i.test(link.textContent)) return;
      const label = document.createElement('span');
      label.className = link.className;
      label.textContent = 'Out of stock';
      label.setAttribute('aria-disabled', 'true');
      link.replaceWith(label);
    });
    document.querySelectorAll('a[href^="https://wa.me/"]').forEach((link) => {
      if (!/order on whatsapp/i.test(link.textContent)) return;
      const label = document.createElement('span');
      label.className = link.className;
      label.textContent = 'Ordering unavailable';
      label.setAttribute('aria-disabled', 'true');
      link.replaceWith(label);
    });
  }).catch(() => {});
})();
