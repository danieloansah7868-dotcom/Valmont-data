/* ==========================================================================
   VALMONT DATA — sync prices from your supplier
   Usage: node scripts/sync-prices.js

   RemaData's exact package-catalogue endpoint may vary — check their docs or
   dashboard. Until then this script prints a ready-to-paste REMADATA_PLANS
   mapping from a JSON file you export (or paste from their dashboard).

   File format (plans.json):
   { "mtn": { "1": 1001, "2": 1002, "5": 1003, "10": 1004 },
     "telecel": { "10": 2001 },
     "airteltigo": { "1": 3001 } }
   ========================================================================== */
const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, "..", "plans.json");
if (!fs.existsSync(file)) {
  console.log("ℹ️  No plans.json yet. Steps:");
  console.log("   1. Log in to https://remadata.com → Packages");
  console.log("   2. For each bundle you sell, copy its plan_id");
  console.log("   3. Save this file as plans.json in this repo:");
  console.log('      { "mtn": { "1": 1001, ... }, "telecel": {...}, "airteltigo": {...} }');
  console.log("   4. Run this script again — it prints your REMADATA_PLANS line.");
  process.exit(0);
}

const plans = JSON.parse(fs.readFileSync(file, "utf8"));
console.log("✅ Your REMADATA_PLANS for .env.local:");
console.log("REMADATA_PLANS=" + JSON.stringify(plans).replace(/"/g, '\\"'));
console.log("\nAlso update schema.sql bundle prices to your wholesale cost + margin.");
