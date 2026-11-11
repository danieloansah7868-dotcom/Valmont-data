/* Homepage promotions: automatic rotation with manual and accessible controls. */
(function () {
  'use strict';
  const carousel = document.querySelector('.promo-carousel');
  if (!carousel) return;
  const slides = Array.from(carousel.querySelectorAll('[data-slide]'));
  const dots = Array.from(carousel.querySelectorAll('[data-go]'));
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let index = 0;
  let timer;

  function show(next) {
    index = (next + slides.length) % slides.length;
    carousel.dataset.current = String(index);
    slides.forEach((slide, i) => { slide.hidden = i !== index; });
    dots.forEach((dot, i) => {
      dot.classList.toggle('is-active', i === index);
      dot.setAttribute('aria-pressed', String(i === index));
    });
  }
  function schedule() {
    clearInterval(timer);
    if (!reducedMotion.matches && !carousel.matches(':hover') && !carousel.contains(document.activeElement)) {
      timer = setInterval(() => show(index + 1), 5000);
    }
  }
  carousel.querySelector('[data-prev]').addEventListener('click', () => { show(index - 1); schedule(); });
  carousel.querySelector('[data-next]').addEventListener('click', () => { show(index + 1); schedule(); });
  dots.forEach((dot, i) => dot.addEventListener('click', () => { show(i); schedule(); }));
  carousel.addEventListener('mouseenter', schedule);
  carousel.addEventListener('mouseleave', schedule);
  carousel.addEventListener('focusin', schedule);
  carousel.addEventListener('focusout', () => setTimeout(schedule, 0));
  show(0);
  reducedMotion.addEventListener?.('change', schedule);
  schedule();
})();
