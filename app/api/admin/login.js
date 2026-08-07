/* POST /api/admin/login  { password } → { token } (2h, HMAC-signed) */

const { json, readRawBody, wrap } = require("../../lib/http");
const { sign } = require("../../lib/auth");

async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "POST only" });
  const body = await readRawBody(req).then((b) => {
    try { return JSON.parse(b); } catch { return null; }
  });
  const password = body?.password || "";
  if (!process.env.ADMIN_PASSWORD || password !== process.env.ADMIN_PASSWORD) {
    return json(res, 401, { error: "Wrong password" });
  }
  return json(res, 200, { token: sign({ role: "admin" }) });
}

module.exports = wrap(handler);
