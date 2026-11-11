'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const html = fs.readFileSync('index.html', 'utf8');
const init = html.match(/<script>\s*(\/\/ Keep the page usable[\s\S]*?)\s*<\/script>/);
const timer = html.match(/<script>\s*(\(function \(\) \{\s*var root = document.documentElement;[\s\S]*?\}\(\)\);)\s*<\/script>/);
assert(init && timer, 'welcome scripts exist');
assert(html.includes('logo-blink 3.4s ease-in-out 600ms 3'), 'logo blinks three times at a relaxed pace');
assert(html.includes('animation: var(--wave) 10.2s ease-in-out 600ms both'), 'letters run the forward and reverse wave');
assert(html.includes('.site-welcome { display: none; }'), 'hidden without JavaScript');
assert(html.includes('welcome-failsafe 18s forwards'), 'CSS fail-safe exists');
assert(html.includes('.site-welcome.is-done { animation: none;'), 'dismissal overrides fail-safe animation');
const overlay = html.match(/<div class="site-welcome"[\s\S]*?\n  <\/div>/)[0];
assert(overlay.includes('style="--wave:letter-wave-0">V</tspan>'), 'wave starts with V');
assert(overlay.includes('style="--wave:letter-wave-10">A</tspan>'), 'wave turns around at the last A');
assert.equal((html.match(/@keyframes letter-wave-\d+/g) || []).length, 11, 'all letters have forward and reverse timing');
assert.equal((overlay.match(/class="site-welcome-letter(?: |")/g) || []).length, 11, 'eleven letters take part in sequence');
assert(html.includes('38.5%, 50% { opacity: .5; transform: translateY(-35px);'), 'last A stays partly visible at the turn');
assert(html.includes('6.5%, 82% { opacity: 0; transform: translateY(-35px);'), 'V disappears first and returns last');
assert(!overlay.includes('site-welcome-progress') && !overlay.includes('site-welcome-label'), 'only the logo is visible');
function setup(reduced) {
  let now = 10000, timers = [];
  const rootClasses = new Set(), screenClasses = new Set(), attributes = {};
  const classList = set => ({ add: x => set.add(x), remove: x => set.delete(x), contains: x => set.has(x) });
  let animationEnd;
  const logo = { addEventListener: (type, fn) => { assert.equal(type, 'animationend'); animationEnd = fn; } };
  const screen = { classList: classList(screenClasses), setAttribute: (k,v) => { attributes[k]=v; }, querySelector: () => logo };
  const document = { documentElement: { classList: classList(rootClasses) }, getElementById: () => screen };
  const setTimeoutMock = (fn, delay) => { timers.push({fn, at:now+delay}); };
  const context = {document, window: {matchMedia: () => ({matches: reduced})}, setTimeout: setTimeoutMock};
  vm.runInNewContext(init[1], context);
  vm.runInNewContext(timer[1], context);
  function advance(ms) {
    const end = now + ms;
    while (true) {
      timers.sort((a,b) => a.at-b.at);
      if (!timers.length || timers[0].at > end) break;
      const item = timers.shift(); now = item.at; item.fn();
    }
    now = end;
  }
  return {rootClasses,screenClasses,attributes,advance, end: (name, pseudo = "") => animationEnd({target: logo, animationName: name, pseudoElement: pseudo})};
}
let x=setup(false); assert(x.rootClasses.has('is-welcoming'));
x.end('logo-arrive'); x.end('logo-blink', '::after'); assert(!x.screenClasses.has('is-done'));
x.end('logo-blink'); assert(!x.screenClasses.has('is-done')); x.end('letter-wave-10'); assert(x.screenClasses.has('is-done')); assert.equal(x.attributes['aria-hidden'],'true'); x.advance(250); assert(!x.rootClasses.has('is-welcoming'));
x=setup(false); x.advance(15999); assert(!x.screenClasses.has('is-done')); x.advance(1); assert(x.screenClasses.has('is-done')); x.advance(250); assert(!x.rootClasses.has('is-welcoming'));
x=setup(true); assert(!x.rootClasses.has('is-welcoming'));
console.log('Logo blink completion, fail-safe and reduced-motion checks passed');
