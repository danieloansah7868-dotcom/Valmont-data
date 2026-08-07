export default function ApiDocPage() {
  const endpoints: Array<[string, string, string]> = [
    ["POST", "/api/developer/verify", "Confirm a number is valid on its network"],
    ["POST", "/api/developer/purchase", "Place a single bundle order"],
    ["POST", "/api/developer/bulk", "Up to 200 orders in one call"],
    ["GET", "/api/developer/order/:id", "Order status (processing → delivered | failed)"],
    ["GET", "/api/developer/tracker/:id", "Full delivery event timeline"],
    ["GET", "/api/developer/packages", "Live bundle catalogue with your tier's prices"],
    ["GET", "/api/developer/balance", "Check wallet balance"],
    ["POST", "/api/developer/withdraw", "Withdraw reseller earnings"],
    ["GET", "/api/developer/transactions", "Transaction history"],
    ["POST", "/api/developer/webhooks", "Register a webhook URL (HMAC-signed events)"],
  ];

  return (
    <section>
      <div className="wrap" style={{ maxWidth: 860 }}>
        <div className="k">Developer API</div>
        <h1 className="t" style={{ margin: "8px 0 12px" }}>ValmontDataAPI</h1>
        <p className="lead">
          Integrate data bundle purchases into your application. This page documents the public
          developer API contract — the internal API routes in this app implement the same flows.
        </p>

        <div className="card" style={{ marginTop: 26 }}>
          <h3 style={{ fontSize: 15, color: "var(--muted)" }}>BASE URL</h3>
          <div className="code-block">
            <span className="c"># Base URL (production)</span>{"\n"}
            https://api.valmontdata.com/api/developer
          </div>
          <div className="demo-note">
            In this starter, the same logic runs under /api/* — swap the prefix when you launch the
            public API.
          </div>
        </div>

        <h2 className="t" style={{ fontSize: 24, margin: "36px 0 6px" }}>Endpoints</h2>
        <div style={{ display: "grid", gap: 8, marginTop: 14 }}>
          {endpoints.map(([method, path, desc]) => (
            <div className="endpoint" key={path + method}>
              <span className={"method " + method.toLowerCase()}>{method}</span>
              <code>{path}</code>
              <span style={{ color: "var(--muted)", fontSize: 12.5, marginLeft: "auto" }}>{desc}</span>
            </div>
          ))}
        </div>

        <h2 className="t" style={{ fontSize: 24, margin: "36px 0 6px" }}>Sample: purchase</h2>
        <div className="code-block">
          <span className="k">const</span> res = await fetch(<span className="s">"https://api.valmontdata.com/api/developer/purchase"</span>, {"{"}
          {"\n"}  method: <span className="s">"POST"</span>,{"\n"}  headers: {"{"} <span className="s">"Authorization"</span>: <span className="s">"Bearer vd_live_xxx"</span> {"}"},{"\n"}  body: JSON.stringify({"{"} network: <span className="s">"mtn"</span>, bundle_gb: 10, number: <span className="s">"0241234567"</span> {"}"})
          {"\n}"});{"\n"}
          <span className="k">const</span> order = await res.json(); <span className="c">{"// { order_id, status, price, eta }"}</span>
        </div>

        <div className="cta-band" style={{ marginTop: 40 }}>
          <h2 className="t">Ready to build?</h2>
          <p className="lead">
            The full contract, webhook payloads and code samples live in the prototype&apos;s API docs.
          </p>
        </div>
      </div>
    </section>
  );
}
