/* HTTP helpers shared by all serverless functions */

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

async function readRawBody(req) {
  if (req.rawBody != null) return req.rawBody; // dev server sets this
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 1e6) req.destroy(); // 1MB cap
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function getHeader(req, name) {
  const v = req.headers[name.toLowerCase()] || req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

function wrap(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error("[api]", req.method, req.url, err);
      json(res, status, { error: status >= 500 ? "Internal error" : err.message });
    }
  };
}

module.exports = { json, readRawBody, getHeader, wrap };
