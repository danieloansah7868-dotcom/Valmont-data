# Prompt to hand the next agent

Copy everything in the box below into a fresh agent session. It points the
agent at the repo, corrects the wrong assumption up front, and gives it one
job instead of a menu.

---

```
Work in the GitHub repo danieloansah7868-dotcom/Valmont-data, branch
arena/01a00ce7-valmont-data. The app lives in the ads/ folder.

FIRST: read ads/CONTEXT-FOR-AGENT.md before planning anything. Then read
ads/README.md. Do not propose work until you have read both.

The one thing agents get wrong about this project: "ads" here means small ads,
as in a newspaper classifieds page. This is a peer-to-peer Ghanaian classifieds
marketplace like Tonaton or Jiji — someone sells a fridge, a buyer phones them.
It is NOT an ad network. There is no CPM, no CPC, no ad inventory, no
availability calendar, no fill rate, and no embeddable ad script.

Never build escrow, held funds, platform commission, or a checkout that touches
buyer or seller money. Valmont Web's homepage promises "money comes direct to
you, no middleman, no commission" — payments through this site would contradict
the company's own marketing. Buyers and sellers settle between themselves.

To run it:
  cd ads && npm install && npm run dev     # http://localhost:3000, self-seeding
  npm run check                            # typecheck + 207 tests, server must be up

npm run lint does not work and cannot be fixed — next lint was removed in
Next 16 and ESLint is not a dependency. Use npm run check.

YOUR TASK: [pick ONE and delete the rest]

  (A) Wire up SMS delivery. Login codes currently print to the server log, so
      no real seller can sign in — this blocks launch. Change sendCode() in
      ads/src/lib/session.ts to send through a Ghana gateway (Hubtel, Arkesel
      or mNotify). Keep LOGIN_DEBUG off in production. Then reuse the same
      integration to text sellers when a buyer sends them a lead.

  (B) Fix photo storage. PostForm.tsx turns each photo into a base64 data URL
      and store.ts writes it into .data/ads.json. One ad with six 4MB photos is
      32MB of JSON, and persist() rewrites the whole file on every write — the
      site dies at roughly 50 real ads. Move uploads to object storage
      (Supabase Storage, S3 or Cloudinary), compress in the browser before
      upload since sellers are on mobile data, and store only a URL on the ad.

  (C) Add a report/flag button. Buyers spot scams faster than a moderator can.
      Add POST /api/ads/:id/report plus a small control on the ad page, feeding
      the existing admin queue.

  (D) Make town searchable. taxonomy.ts already has sub-localities (Osu, East
      Legon, Spintex, Adum) and /post collects one, but ListQuery has no town
      field and Filters.tsx never mentions it, so buyers cannot filter by it.

RULES:
- Match the existing house style: navy #0b1a38, orange #ff8c00, off-white
  #f8fafc, mobile-first, tap targets at least 44px, plain English in the UI.
- Add tests to ads/scripts/test.mjs for whatever you build. All 207 existing
  checks must still pass.
- Run npm run check before you commit and paste the output.
- Do not touch app/ or prototype/ — those are the existing production site and
  the design reference.
- Never remove an ad from a listing to make room for a paid one. Read the
  placement rules in README.md before touching store.ts.
- If something in the backlog is already built, say so instead of rebuilding
  it. The "What already exists" table in CONTEXT-FOR-AGENT.md is accurate.
```

---

## Why the task list is one item, not five

The previous two attempts both ended with *"which of these would you like to
tackle first?"* — a menu, not a plan. Give an agent one job with a stated
reason and it builds it; give it five and it writes another proposal.

## If it drifts back to ad-network language

Watch for: CPM, CPC, inventory, placements, slots, impressions sold, fill rate,
audience stats, media buyer, escrow, payout, commission. Any of those means it
has not read the context file. Reply:

> Re-read ads/CONTEXT-FOR-AGENT.md. This is a classifieds site, not an ad
> network, and nothing on it touches money.
