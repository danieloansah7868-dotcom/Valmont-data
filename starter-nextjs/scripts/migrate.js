/* ============================================================================
   VALMONT DATA — migrate script
   Usage: npm run db:migrate    (reads DATABASE_URL from .env.local)
   ========================================================================== */
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

(async () => {
  if (process.env.MEMORY_DB === "1") {
    console.log("ℹ️  MEMORY_DB mode is on — schema is auto-applied by the app on first use. Nothing to migrate.");
    process.exit(0);
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("❌ DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
    process.exit(1);
  }
  const sql = fs.readFileSync(path.join(__dirname, "..", "schema.sql"), "utf8");
  const client = new Client({
    connectionString: url,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  });
  try {
    await client.connect();
    await client.query(sql);
    console.log("✅ Schema migrated + seeds applied.");
  } catch (err) {
    console.error("❌ Migration failed:", err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
})();
