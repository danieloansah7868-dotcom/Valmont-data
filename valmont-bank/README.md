# Valmont Bank — SaveSmart 💰

> **Spend mindfully. Save automatically.**
> A personal savings-automation app from the **Valmont Group of Companies** (Accra, Ghana).

SaveSmart is built to fix one problem: **spending habits win when saving depends on
willpower**. So it flips the order — money moves into your **Vault automatically**
(round-ups, weekly sweeps, pay-yourself-first) before your habits get a chance at it.

## Status

🧪 **Front-end prototype** — plain HTML/CSS/JS, zero build step, zero dependencies.
All data lives in the browser (`localStorage`). No real money moves; the MoMo
prompt is a simulation.

## Run it

```bash
cd valmont-bank
python3 -m http.server 8000   # → http://localhost:8000
# or just open index.html in a browser
```

## What's inside

| File | What it is |
|---|---|
| `index.html` | Single-page app: Home · Spending · Automate · Goals · Insights |
| `style.css` | Valmont house style — navy `#0b1f3a` / `#071428`, orange-gold `#d9772a`, gold `#D4AF37`, white `#f8fafc`; mobile-first |
| `app.js` | State (localStorage), automation engine, MoMo-prompt simulation, insights |
| `logo.svg` | Gold hexagonal constellation mark (Valmont brand) |

## Features

- **💰 Savings Vault** — the balance your automations fill up, with a progress ring.
- **💸 Spending tracker** — log spends in 8 categories; per-category monthly caps
  that turn amber at 75% and call you out in red when you blow them.
- **⚡ Automation rules** (the whole point):
  - **Pay Yourself First** — auto-save X% of every income before you can touch it.
  - **Round-Ups** — every spend rounds up to the nearest GH₵5/10; spare change
    silently lands in the Vault.
  - **Weekly Sweep** — a fixed standing order to the Vault, every chosen weekday,
    confirmed with a simulated MoMo approval prompt.
- **📈 12-month projection** — what your rules + one habit-cut are worth in a year.
- **🎯 Goals** — named targets (Emergency fund, iPhone 16…) funded from the Vault.
- **💡 Insights** — top spending leak, budget health, daily safe-to-spend, 7-day chart.
- **Demo data** button to explore instantly · **JSON export** · full reset.

## Roadmap to production (when the new repo is ready)

1. **Backend:** Supabase schema (vault ledger, rules, goals) — same postgREST
   pattern as Valmont Data, zero-build static frontend stays as-is.
2. **Real money:** Valmont-Pay MoMo charges for sweeps/round-ups, using the
   Valmont Data **auto-reload pattern** (pre-authorised MoMo → PIN prompt →
   signed webhook → idempotent credit). Never silent debits.
3. **Cron:** `api/cron/sweep.js` for weekly rules (mirrors `api/cron/autoreload.js`).
4. **Auth:** customer accounts (Valmont Data's `api/auth/customer.js` pattern).

---

© 2026 Valmont Bank · Valmont Group of Companies · Accra, Ghana 🇬🇭
