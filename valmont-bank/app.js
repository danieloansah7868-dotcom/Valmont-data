/* ==========================================================================
   VALMONT BANK — SaveSmart prototype
   Front-end only. State persists in localStorage. "Vault" and MoMo prompts
   are simulated — wire to Valmont-Pay + a cron (like Valmont Data's
   autoreload) for the real build.
   ========================================================================== */

'use strict';

const KEY = 'valmont-bank-v1';
const CATS = [
  ['Food & Drinks', '🍜'],
  ['Transport', '🚗'],
  ['Data & Airtime', '📱'],
  ['Fun & Vibes', '🎬'],
  ['Bills & Utilities', '🧾'],
  ['Shopping', '🛍️'],
  ['Health', '🏥'],
  ['Other', '📦'],
];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const DEFAULT_BUDGETS = {
  'Food & Drinks': 500, 'Transport': 300, 'Data & Airtime': 150,
  'Fun & Vibes': 200, 'Bills & Utilities': 350, 'Shopping': 250,
  'Health': 100, 'Other': 150,
};

/* ---------------- state ---------------- */
let S = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* corrupted state → fresh start */ }
  return freshState();
}
function freshState() {
  return {
    onboarded: false,
    name: '',
    monthlyBudget: 2000,
    budgets: { ...DEFAULT_BUDGETS },
    vault: 0,
    expenses: [], // {id, amount, cat, note, ts}
    incomes: [],  // {id, amount, note, ts}
    goals: [],    // {id, name, emoji, target, saved}
    activity: [], // {id, dir:'in'|'out', icon, title, sub, amount, ts}
    rules: {
      payday: { on: false, pct: 10 },
      roundup: { on: false, unit: 5 },
      weekly: { on: false, amount: 50, day: 5, lastRun: 0 },
    },
  };
}
function save() { localStorage.setItem(KEY, JSON.stringify(S)); }

/* ---------------- helpers ---------------- */
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const uid = () => Math.random().toString(36).slice(2, 10);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => 'GH₵' + Number(n || 0).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt0 = n => 'GH₵' + Math.round(Number(n || 0)).toLocaleString('en-GH');
const catEmoji = c => (CATS.find(([n]) => n === c) || [0, '📦'])[1];
const monthKey = ts => { const d = new Date(ts); return d.getFullYear() + '-' + d.getMonth(); };
const nowMonth = () => monthKey(Date.now());
const relTime = ts => {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  const d = Math.floor(s / 86400);
  return d === 1 ? 'yesterday' : d + 'd ago';
};

function toast(msg, kind = '', ms = 3800) {
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 320); }, ms);
}

/* ---------------- derived numbers ---------------- */
function monthExpenses() { return S.expenses.filter(e => monthKey(e.ts) === nowMonth()); }
function monthSpend() { return monthExpenses().reduce((a, e) => a + e.amount, 0); }
function monthSaved() {
  return S.activity.filter(a => a.dir === 'in' && a.kind !== 'income' && monthKey(a.ts) === nowMonth())
    .reduce((a, x) => a + x.amount, 0);
}
function savedCount() {
  return S.activity.filter(a => a.dir === 'in' && a.kind !== 'income' && monthKey(a.ts) === nowMonth()).length;
}
function catSpend(cat) { return monthExpenses().filter(e => e.cat === cat).reduce((a, e) => a + e.amount, 0); }
function daysLeftInMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() - d.getDate() + 1;
}

/* ---------------- activity ---------------- */
function logAct(dir, icon, title, sub, amount, kind) {
  S.activity.unshift({ id: uid(), dir, icon, title, sub, amount, ts: Date.now(), kind });
  if (S.activity.length > 120) S.activity.length = 120;
}

/* ==========================================================================
   RENDER
   ========================================================================== */
function renderAll() {
  renderHome(); renderSpending(); renderAutomate(); renderGoals(); renderInsights();
}

function renderHome() {
  const hr = new Date().getHours();
  const greet = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
  $('#greeting').textContent = `${greet}${S.name ? ', ' + S.name : ''} 👋`;

  $('#vaultBalance').textContent = fmt(S.vault);
  $('#vaultSub').textContent = S.vault > 0
    ? `${fmt(monthSaved())} swept in this month · ${savedCount()} saves`
    : 'Turn on an automation rule — money starts moving itself →';

  const spent = monthSpend(), budget = S.monthlyBudget || 0;
  $('#statSpent').textContent = fmt0(spent);
  $('#statBudget').textContent = `of ${fmt0(budget)} budget`;
  const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;
  const bar = $('#budgetBar');
  bar.style.width = pct + '%';
  bar.className = 'bar-fill' + (budget > 0 && spent > budget ? ' over' : pct > 75 ? ' warn' : '');

  const safe = budget > 0 ? Math.max(0, (budget - spent) / daysLeftInMonth()) : 0;
  $('#statSafe').textContent = fmt(Math.floor(safe * 100) / 100).replace('.00', '');
  $('#statDays').textContent = daysLeftInMonth() + ' days left this month';

  $('#statSaved').textContent = fmt0(monthSaved());
  const n = savedCount();
  $('#statStreak').textContent = n > 0 ? `${n} save${n > 1 ? 's' : ''} this month 🔥` : 'no saves yet — let’s fix that';

  // hero ring = % of monthly budget kept as savings (cap 100)
  const ringPct = budget > 0 ? Math.min(1, monthSaved() / (budget * 0.2) ) : 0;
  const C = 2 * Math.PI * 52;
  $('#heroRing').style.strokeDashoffset = C * (1 - ringPct);

  renderRuleChips();
  renderActivity($('#homeActivity'), S.activity.slice(0, 6));
}

function renderRuleChips() {
  const r = S.rules, chips = [];
  chips.push(`<span class="rule-chip ${r.payday.on ? 'on' : ''}">💵 Pay-yourself-first ${r.payday.on ? `· ${r.payday.pct}%` : '· off'}</span>`);
  chips.push(`<span class="rule-chip ${r.roundup.on ? 'on' : ''}">🪙 Round-ups ${r.roundup.on ? `· GH₵${r.roundup.unit}` : '· off'}</span>`);
  chips.push(`<span class="rule-chip ${r.weekly.on ? 'on' : ''}">📅 Weekly sweep ${r.weekly.on ? `· ${fmt0(r.weekly.amount)} ${DAY_NAMES[r.weekly.day].slice(0,3)}s` : '· off'}</span>`);
  $('#homeRules').innerHTML = chips.join('');
}

function renderActivity(ul, items) {
  if (!items.length) {
    ul.innerHTML = `<div class="empty-note">Nothing yet. Log your first spend or income — this feed tells your money story.</div>`;
    return;
  }
  ul.innerHTML = items.map(a => `
    <li>
      <span class="act-ico ${a.dir}">${a.icon}</span>
      <span class="act-body">
        <span class="act-title">${esc(a.title)}</span>
        <span class="act-sub">${esc(a.sub)} · ${relTime(a.ts)}</span>
      </span>
      <span class="act-amt ${a.dir}">${a.dir === 'in' ? '+' : '−'}${fmt(a.amount)}</span>
    </li>`).join('');
}

function renderSpending() {
  $('#totalCapLabel').textContent = fmt0(S.monthlyBudget);
  $('#catList').innerHTML = CATS.map(([name, emoji]) => {
    const spent = catSpend(name);
    const cap = S.budgets[name] || 0;
    const pct = cap > 0 ? Math.min(100, (spent / cap) * 100) : (spent > 0 ? 100 : 0);
    const cls = cap > 0 && spent > cap ? 'over' : pct > 75 ? 'warn' : '';
    return `
    <div class="cat-row">
      <span class="cat-emoji">${emoji}</span>
      <div>
        <div class="cat-name"><span>${name}</span>
          <span class="spent ${cls === 'over' ? 'over' : ''}">${fmt0(spent)} / ${fmt0(cap)}</span></div>
        <div class="bar"><div class="bar-fill ${cls}" style="width:${pct}%"></div></div>
      </div>
      <button class="cat-edit" data-cat="${esc(name)}" data-cap="${cap}" title="Edit cap">✏️</button>
    </div>`;
  }).join('');

  renderActivity($('#spendActivity'), S.activity.filter(a => a.kind === 'expense').slice(0, 8));
}

function renderAutomate() {
  const r = S.rules;
  $('#tglPayday').checked = r.payday.on;
  $('#tglRoundup').checked = r.roundup.on;
  $('#tglWeekly').checked = r.weekly.on;
  $('#paydayPct').value = r.payday.pct;
  $('#roundupUnit').value = r.roundup.unit;
  $('#weeklyAmt').value = r.weekly.amount;
  $('#weeklyDay').value = r.weekly.day;
  $('#rulePayday').classList.toggle('on', r.payday.on);
  $('#ruleRoundup').classList.toggle('on', r.roundup.on);
  $('#ruleWeekly').classList.toggle('on', r.weekly.on);

  // projections
  let perYear = 0;
  if (r.weekly.on) {
    const today = new Date();
    const weeksLeft = Math.max(0, Math.ceil((new Date(today.getFullYear() + 1, today.getMonth(), today.getDate()) - today) / (7 * 864e5)));
    perYear += r.weekly.amount * Math.min(52, weeksLeft);
  }
  if (r.payday.on) {
    const avgIncome = S.incomes.length ? S.incomes.reduce((a, i) => a + i.amount, 0) / S.incomes.length : 0;
    if (avgIncome > 0) perYear += (avgIncome * r.payday.pct / 100) * 12;
  }
  if (r.roundup.on) {
    const rups = S.activity.filter(a => a.kind === 'roundup');
    const monthly = rups.length >= 4 ? rups.reduce((a, x) => a + x.amount, 0) / Math.max(1, distinctMonths(rups)) : r.roundup.unit * 6; // estimate
    perYear += monthly * 12;
  }
  $('#projRules').textContent = fmt0(perYear);

  const top = topCategory();
  const cut = top ? catSpend(top) * 0.2 * 12 : 0;
  $('#projCut').textContent = fmt0(cut);
  $('#projCutSub').textContent = top ? `cut ${top.toLowerCase()} by 20% → per year` : 'log spends to unlock';
  $('#projTotal').textContent = fmt0(perYear + cut);
}
function distinctMonths(items) { return new Set(items.map(a => monthKey(a.ts))).size; }
function topCategory() {
  let best = null, bestAmt = 0;
  for (const [name] of CATS) { const s = catSpend(name); if (s > bestAmt) { bestAmt = s; best = name; } }
  return bestAmt > 0 ? best : null;
}

function renderGoals() {
  const g = $('#goalsGrid');
  if (!S.goals.length) {
    g.innerHTML = `<div class="panel" style="grid-column:1/-1"><div class="empty-note">No goals yet. Create one — savings with a name and a deadline actually happen.</div></div>`;
    return;
  }
  g.innerHTML = S.goals.map(goal => {
    const pct = Math.min(100, (goal.saved / goal.target) * 100);
    const done = goal.saved >= goal.target;
    return `
    <div class="goal-card ${done ? 'done' : ''}">
      <div class="goal-top">
        <span class="goal-emoji">${esc(goal.emoji)}</span>
        <div><h3>${esc(goal.name)}</h3><p>${done ? 'Fully funded 🎉' : `${Math.round(pct)}% funded`}</p></div>
      </div>
      <div class="bar"><div class="bar-fill ${done ? '' : ''}" style="width:${pct}%"></div></div>
      <div class="goal-nums"><span>${fmt(goal.saved)}</span><span class="t">of ${fmt(goal.target)}</span></div>
      ${done ? '<div class="done-badge">🎉 Goal reached — well done!</div>' : `
      <div class="goal-actions">
        <button class="btn btn-ghost btn-sm" data-fund="${goal.id}">＋ Fund from Vault</button>
        <button class="btn btn-danger btn-sm" data-delgoal="${goal.id}">✕</button>
      </div>`}
    </div>`;
  }).join('');
}

function renderInsights() {
  const list = [];
  const spent = monthSpend(), budget = S.monthlyBudget;
  const top = topCategory();

  if (!S.expenses.length) {
    list.push(['💡', 'good', 'Start logging', 'Log a few spends and Valmont Bank will start spotting your money habits here.']);
  } else {
    if (budget > 0) {
      const pct = (spent / budget) * 100;
      if (pct > 100) list.push(['🚨', 'bad', 'Over your monthly cap', `You've spent ${fmt(spent)} — ${fmt(spent - budget)} over your ${fmt0(budget)} cap. Freeze non-essentials until the 1st.`]);
      else if (pct > 75) list.push(['⚠️', 'warn', 'Budget amber zone', `${Math.round(pct)}% of your monthly cap is gone with ${daysLeftInMonth()} days left. Max safe: ${fmt((budget - spent) / daysLeftInMonth())}/day.`]);
      else list.push(['✅', 'good', 'On track', `You've used ${Math.round(pct)}% of your cap with ${daysLeftInMonth()} days to go. Keep it up.`]);
    }
    if (top) {
      const amt = catSpend(top);
      const cut = amt * 0.2;
      list.push(['🎯', 'warn', `Your leak: ${top}`, `${fmt(amt)} this month — your biggest category. Cutting just 20% frees ${fmt(cut)}/month = ${fmt0(cut * 12)}/year straight into your Vault.`]);
    }
    const todaySpend = S.expenses.filter(e => new Date(e.ts).toDateString() === new Date().toDateString()).reduce((a, e) => a + e.amount, 0);
    if (todaySpend > 0) list.push(['📅', '', 'Today so far', `You've spent ${fmt(todaySpend)} today across ${S.expenses.filter(e => new Date(e.ts).toDateString() === new Date().toDateString()).length} transaction(s).`]);
    const rups = S.activity.filter(a => a.kind === 'roundup').reduce((a, x) => a + x.amount, 0);
    if (rups > 0) list.push(['🪙', 'good', 'Pennies are working', `Round-ups alone have moved ${fmt(rups)} to your Vault. Invisible savings add up.`]);
    if (!S.rules.payday.on && !S.rules.roundup.on && !S.rules.weekly.on)
      list.push(['⚡', 'warn', 'Automation is off', 'Willpower loses to habits. Turn on at least one rule in the Automate tab — even a GH₵20 weekly sweep is GH₵1,040/year.']);
  }

  $('#insightList').innerHTML = list.map(([ico, cls, title, body]) => `
    <div class="insight ${cls}"><span class="i-ico">${ico}</span>
    <div><strong>${esc(title)}</strong>${esc(body)}</div></div>`).join('');

  renderWeekChart();
}

function renderWeekChart() {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
    const next = new Date(d); next.setDate(next.getDate() + 1);
    const amt = S.expenses.filter(e => e.ts >= d.getTime() && e.ts < next.getTime()).reduce((a, e) => a + e.amount, 0);
    days.push({ label: 'SMTWTFS'[d.getDay()], amt, today: i === 0 });
  }
  const max = Math.max(...days.map(d => d.amt), 1);
  $('#weekChart').innerHTML = days.map(d => `
    <div class="wcol">
      <span class="wval">${d.amt > 0 ? fmt0(d.amt).replace('GH₵', '') : '·'}</span>
      <div class="wbar ${d.today ? 'today' : ''}" style="height:${(d.amt / max) * 78}%"></div>
      <span class="wlab">${d.label}</span>
    </div>`).join('');
}

/* ==========================================================================
   ACTIONS
   ========================================================================== */
function addExpense(amount, cat, note) {
  const e = { id: uid(), amount, cat, note, ts: Date.now() };
  S.expenses.unshift(e);
  logAct('out', catEmoji(cat), note || cat, cat, amount, 'expense');

  // round-up automation (silent — true automation)
  const r = S.rules.roundup;
  if (r.on && r.unit > 0) {
    const rem = amount % r.unit;
    if (rem > 0.001) {
      const spare = Math.round((r.unit - rem) * 100) / 100;
      if (spare > 0) {
        S.vault = Math.round((S.vault + spare) * 100) / 100;
        logAct('in', '🪙', 'Round-up → Vault', `spare change from ${note || cat}`, spare, 'roundup');
        toast(`🪙 ${fmt(spare)} round-up swept to your Vault`, 'good');
      }
    }
  }

  // over-cap callout
  const cap = S.budgets[cat] || 0;
  const cs = catSpend(cat);
  if (cap > 0 && cs > cap && cs - amount <= cap) {
    toast(`🚨 ${cat} cap exceeded — ${fmt(cs - cap)} over. Easy on it!`, 'bad', 5000);
  } else if (S.monthlyBudget > 0 && monthSpend() > S.monthlyBudget && monthSpend() - amount <= S.monthlyBudget) {
    toast(`🚨 You've blown your monthly cap of ${fmt0(S.monthlyBudget)}`, 'bad', 5000);
  }

  save(); renderAll();
}

function addIncome(amount, note) {
  S.incomes.unshift({ id: uid(), amount, note, ts: Date.now() });
  logAct('in', '💵', note || 'Income', 'money in', amount, 'income');

  const r = S.rules.payday;
  if (r.on && r.pct > 0) {
    const cut = Math.round(amount * r.pct / 100 * 100) / 100;
    openMomo(cut, `Pay-yourself-first: ${r.pct}% of ${fmt(amount)}`, () => {
      S.vault = Math.round((S.vault + cut) * 100) / 100;
      logAct('in', '💵', 'Pay-yourself-first → Vault', `${r.pct}% of ${note || 'income'}`, cut, 'payday');
      save(); renderAll();
      toast(`💵 ${fmt(cut)} moved to your Vault before you could touch it`, 'good');
    });
  }
  save(); renderAll();
}

function weeklyDue() {
  const r = S.rules.weekly;
  if (!r.on) return false;
  const now = new Date();
  const due = new Date(now); due.setHours(9, 0, 0, 0);
  due.setDate(now.getDate() - ((now.getDay() - r.day + 7) % 7)); // most recent chosen weekday
  if (due.getTime() > now.getTime()) due.setDate(due.getDate() - 7); // not 9am yet today → previous week's slot
  return r.lastRun < due.getTime();
}

function runAutomation() {
  const r = S.rules.weekly;
  if (!r.on) { toast('Turn on the Weekly Vault Sweep first 📅', 'warn'); go('automate'); return; }
  if (!weeklyDue()) {
    toast(`No sweep due — next run is ${DAY_NAMES[r.day]} ${fmt0(r.amount)}`, '');
    return;
  }
  openMomo(r.amount, `Weekly Vault Sweep (${DAY_NAMES[r.day]})`, () => {
    S.vault = Math.round((S.vault + r.amount) * 100) / 100;
    r.lastRun = Date.now();
    logAct('in', '📅', 'Weekly sweep → Vault', `every ${DAY_NAMES[r.day]}`, r.amount, 'weekly');
    save(); renderAll();
    toast(`📅 ${fmt(r.amount)} swept into your Vault. See you next week!`, 'good');
  });
}

function fundGoal(id) {
  const g = S.goals.find(x => x.id === id);
  if (!g) return;
  if (S.vault <= 0) { toast('Your Vault is empty — let automation fill it first 🏦', 'warn'); return; }
  const need = g.target - g.saved;
  const def = Math.min(need, S.vault);
  const raw = prompt(`Move money from Vault (${fmt(S.vault)} available) to “${g.name}”.\nStill needs ${fmt(need)}. Amount:`, def.toFixed(2));
  if (raw === null) return;
  const amt = Math.round(parseFloat(raw) * 100) / 100;
  if (!amt || amt <= 0) { toast('Enter a valid amount', 'warn'); return; }
  if (amt > S.vault) { toast(`Vault only holds ${fmt(S.vault)}`, 'bad'); return; }
  S.vault = Math.round((S.vault - amt) * 100) / 100;
  g.saved = Math.round((g.saved + amt) * 100) / 100;
  logAct('in', g.emoji, `Funded “${g.name}”`, 'from Vault', amt, 'goal');
  save(); renderAll();
  toast(g.saved >= g.target ? `🎉 “${g.name}” fully funded!` : `${g.emoji} ${fmt(amt)} → “${g.name}”`, 'good');
}

/* ---------------- MoMo simulation modal ---------------- */
let momoCb = null;
function openMomo(amount, label, onApprove) {
  $('#momoText').textContent = `Valmont Bank requests ${fmt(amount)} → your Savings Vault`;
  $('#momoAmount').textContent = fmt(amount);
  $('#momoDecline').nextElementSibling; // noop guard
  momoCb = onApprove;
  open('modal-momo');
}

/* ---------------- modal plumbing ---------------- */
function open(id) { $('#' + id).classList.add('open'); }
function close(el) { el.closest('.modal-back').classList.remove('open'); }
function closeAll() { $$('.modal-back.open').forEach(m => m.classList.remove('open')); }

/* ---------------- navigation ---------------- */
function go(view) {
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
  $$('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === view));
  if (location.hash !== '#' + view) history.replaceState(null, '', '#' + view);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ---------------- demo seed ---------------- */
function seedDemo() {
  const dayAgo = d => Date.now() - d * 864e5 - Math.random() * 6e6;
  const demo = [
    ['Data & Airtime', 25, 'MTN 10GB bundle'], ['Food & Drinks', 32, 'waakye + sobolo'],
    ['Transport', 18, 'trotro to Accra Mall'], ['Fun & Vibes', 120, 'Friday night out'],
    ['Food & Drinks', 45, 'KFC'], ['Data & Airtime', 25, 'MTN 10GB bundle'],
    ['Transport', 25, 'Bolt'], ['Shopping', 210, 'sneakers 👟'],
    ['Food & Drinks', 28, 'fried rice'], ['Bills & Utilities', 150, 'ECG prepaid'],
    ['Fun & Vibes', 60, 'Cinema + popcorn'], ['Data & Airtime', 50, 'Telecel bundle'],
    ['Food & Drinks', 70, 'weekend groceries'], ['Transport', 15, 'trotro'],
  ];
  demo.forEach(([cat, amount, note], i) => {
    const ts = dayAgo(Math.min(i, 12));
    S.expenses.unshift({ id: uid(), amount, cat, note, ts });
    logAct('out', catEmoji(cat), note, cat, amount, 'expense');
    S.activity[0].ts = ts; // logAct unshifts → newest is at index 0
  });
  S.incomes.unshift({ id: uid(), amount: 3500, note: 'Monthly salary', ts: dayAgo(10) });
  logAct('in', '💵', 'Monthly salary', 'money in', 3500, 'income');
  S.activity[0].ts = dayAgo(10);

  S.vault = 285.5;
  logAct('in', '📅', 'Weekly sweep → Vault', 'every Friday', 50, 'weekly'); S.activity[0].ts = dayAgo(2);
  logAct('in', '📅', 'Weekly sweep → Vault', 'every Friday', 50, 'weekly'); S.activity[0].ts = dayAgo(9);
  logAct('in', '🪙', 'Round-up → Vault', 'spare change', 3.5, 'roundup'); S.activity[0].ts = dayAgo(1);
  logAct('in', '💵', 'Pay-yourself-first → Vault', '10% of salary', 350, 'payday'); S.activity[0].ts = dayAgo(10);

  S.goals.push({ id: uid(), name: 'Emergency fund', emoji: '🛡️', target: 2000, saved: 640 });
  S.goals.push({ id: uid(), name: 'iPhone 16', emoji: '📱', target: 12000, saved: 1250 });

  S.rules.payday.on = true; S.rules.roundup.on = true; S.rules.weekly.on = true;
  S.rules.weekly.lastRun = dayAgo(2);
  S.name = S.name || 'Kwame';
  S.onboarded = true;
  save(); renderAll();
  toast('✨ Demo data loaded — poke around, then Reset when ready', 'good', 5000);
}

/* ---------------- events ---------------- */
function bind() {
  // nav
  $$('[data-nav]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); go(a.dataset.nav); }));

  // modals open/close
  $$('[data-open]').forEach(b => b.addEventListener('click', () => open(b.dataset.open)));
  $$('[data-close]').forEach(b => b.addEventListener('click', () => close(b)));
  $$('.modal-back').forEach(m => m.addEventListener('click', e => { if (e.target === m && m.id !== 'modal-onboard') closeAll(); }));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAll(); });

  // expense
  $('#expCat').innerHTML = CATS.map(([n, e]) => `<option value="${n}">${e} ${n}</option>`).join('');
  $('#btnAddExpense').addEventListener('click', () => {
    const amt = Math.round(parseFloat($('#expAmount').value) * 100) / 100;
    if (!amt || amt <= 0) { toast('Enter a valid amount', 'warn'); return; }
    addExpense(amt, $('#expCat').value, $('#expNote').value.trim());
    $('#expAmount').value = ''; $('#expNote').value = '';
    closeAll();
    toast(`💸 Logged ${fmt(amt)} — awareness is step one`, '');
  });

  // income
  $('#btnAddIncome').addEventListener('click', () => {
    const amt = Math.round(parseFloat($('#incAmount').value) * 100) / 100;
    if (!amt || amt <= 0) { toast('Enter a valid amount', 'warn'); return; }
    closeAll();
    addIncome(amt, $('#incNote').value.trim());
    $('#incAmount').value = ''; $('#incNote').value = '';
  });
  $('#incAmount').addEventListener('input', () => {
    const amt = parseFloat($('#incAmount').value);
    const r = S.rules.payday;
    $('#paydayPreview').textContent = (r.on && amt > 0)
      ? `💵 Pay-yourself-first is ON — ${fmt(amt * r.pct / 100)} will auto-move to your Vault.`
      : '';
  });

  // goals
  $('#btnAddGoal').addEventListener('click', () => {
    const name = $('#goalName').value.trim();
    const target = Math.round(parseFloat($('#goalTarget').value) * 100) / 100;
    const emoji = $('#goalEmoji').value.trim() || '🎯';
    if (!name) { toast('Give the goal a name', 'warn'); return; }
    if (!target || target <= 0) { toast('Enter a valid target', 'warn'); return; }
    S.goals.unshift({ id: uid(), name, emoji, target, saved: 0 });
    save(); renderAll(); closeAll();
    $('#goalName').value = ''; $('#goalTarget').value = ''; $('#goalEmoji').value = '🎯';
    toast(`🎯 Goal “${name}” created — now feed it`, 'good');
  });
  $('#goalsGrid').addEventListener('click', e => {
    const fund = e.target.closest('[data-fund]');
    const del = e.target.closest('[data-delgoal]');
    if (fund) fundGoal(fund.dataset.fund);
    if (del && confirm('Delete this goal? Its savings stay in your Vault.')) {
      S.goals = S.goals.filter(g => g.id !== del.dataset.delgoal);
      save(); renderAll(); toast('Goal removed', '');
    }
  });

  // category cap edit
  $('#catList').addEventListener('click', e => {
    const b = e.target.closest('.cat-edit');
    if (!b) return;
    const raw = prompt(`Monthly cap for “${b.dataset.cat}” (GH₵):`, b.dataset.cap);
    if (raw === null) return;
    const cap = Math.round(parseFloat(raw) * 100) / 100;
    if (isNaN(cap) || cap < 0) { toast('Enter a valid cap', 'warn'); return; }
    S.budgets[b.dataset.cat] = cap;
    S.monthlyBudget = Math.round(CATS.reduce((a, [n]) => a + (S.budgets[n] || 0), 0) * 100) / 100;
    save(); renderAll(); toast(`${b.dataset.cat} cap set to ${fmt0(cap)}`, 'good');
  });

  // rules
  $('#tglPayday').addEventListener('change', e => { S.rules.payday.on = e.target.checked; save(); renderAll(); toast(e.target.checked ? '💵 Pay-yourself-first ON — you pay you now' : 'Pay-yourself-first off', e.target.checked ? 'good' : ''); });
  $('#tglRoundup').addEventListener('change', e => { S.rules.roundup.on = e.target.checked; save(); renderAll(); toast(e.target.checked ? '🪙 Round-ups ON — spare change now saves itself' : 'Round-ups off', e.target.checked ? 'good' : ''); });
  $('#tglWeekly').addEventListener('change', e => { S.rules.weekly.on = e.target.checked; save(); renderAll(); toast(e.target.checked ? `📅 Weekly sweep ON — ${fmt0(S.rules.weekly.amount)} every ${DAY_NAMES[S.rules.weekly.day]}` : 'Weekly sweep off', e.target.checked ? 'good' : ''); });
  $('#paydayPct').addEventListener('change', e => { S.rules.payday.pct = Math.min(50, Math.max(1, +e.target.value || 10)); save(); renderAll(); });
  $('#roundupUnit').addEventListener('change', e => { S.rules.roundup.unit = +e.target.value; save(); renderAll(); });
  $('#weeklyAmt').addEventListener('change', e => { S.rules.weekly.amount = Math.max(1, +e.target.value || 50); save(); renderAll(); });
  $('#weeklyDay').addEventListener('change', e => { S.rules.weekly.day = +e.target.value; save(); renderAll(); });

  // automation run
  $('#btnRunAuto').addEventListener('click', runAutomation);
  $('#btnRunAuto2').addEventListener('click', runAutomation);

  // momo
  $('#momoApprove').addEventListener('click', () => { closeAll(); if (momoCb) { const cb = momoCb; momoCb = null; cb(); } });
  $('#momoDecline').addEventListener('click', () => { momoCb = null; closeAll(); toast('Transfer declined — nothing moved. Your future self noticed 👀', 'warn'); });

  // demo / export / reset
  $('#btnSeed').addEventListener('click', seedDemo);
  $('#btnExport').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'valmont-bank-data.json';
    a.click(); URL.revokeObjectURL(a.href);
  });
  $('#btnReset').addEventListener('click', () => {
    if (!confirm('Reset everything? Your local data will be wiped.')) return;
    S = freshState(); save(); renderAll();
    open('modal-onboard');
    toast('Fresh slate 🧼', '');
  });

  // onboarding
  $('#btnOnboard').addEventListener('click', () => {
    const name = $('#obName').value.trim();
    const budget = Math.round(parseFloat($('#obBudget').value) * 100) / 100;
    if (!budget || budget <= 0) { toast('Set a monthly spending cap — even a rough one', 'warn'); return; }
    S.name = name;
    S.monthlyBudget = budget;
    S.onboarded = true;
    save(); renderAll(); closeAll();
    toast(`🚀 Account live, ${name || 'champ'} — head to Automate and flip a rule on`, 'good', 5000);
  });
}

/* ---------------- boot ---------------- */
bind();
renderAll();
const initial = location.hash.replace('#', '');
if (['home', 'spending', 'automate', 'goals', 'insights'].includes(initial)) go(initial);
if (!S.onboarded) open('modal-onboard');
