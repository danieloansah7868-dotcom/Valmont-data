import Link from "next/link";

export const dynamic = "force-dynamic";

export default function LandingPage() {
  return (
    <>
      <section className="hero">
        <div className="wrap hero-grid">
          <div>
            <div className="hero-badges">
              <span className="chip live">● Live — new MTN orders within ≈ 1h 52m</span>
              <span className="chip">⚡ Instant delivery class</span>
              <span className="chip">🔒 MoMo secured</span>
            </div>
            <h1 className="t">
              Cheapest data bundles in Ghana. <em>No expiry.</em> No stress.
            </h1>
            <p className="lead">
              Buy MTN, Telecel and AirtelTigo non-expiry data bundles from <b>GH₵1</b> — pay with
              Mobile Money or your wallet, get delivered automatically, and start reselling with
              wholesale pricing. <b>Where resellers meet.</b>
            </p>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <Link className="btn btn-green" href="/buy">
                Buy Data Now — No Account Needed
              </Link>
              <Link className="btn btn-ghost" href="/signup">
                Create Free Account
              </Link>
            </div>
            <p style={{ marginTop: 16, fontSize: 13.5, color: "var(--muted)" }}>
              ✔ No account needed for purchases &nbsp;•&nbsp; ✔ Auto refunds on failed delivery
              &nbsp;•&nbsp; ✔ 24/7 service
            </p>
          </div>

          <div className="hero-price-panel">
            <h3>Live Bundle Prices</h3>
            <div className="sub">Non-expiry bundles · member prices · updated in real time</div>
            <div style={{ display: "grid", gap: 12 }}>
              {[
                ["MTN 1GB", "GH₵4.10", "#ffcb05"],
                ["MTN 10GB", "GH₵40.50", "#ffcb05"],
                ["Telecel 20GB", "GH₵73.80", "#ff4d3d"],
                ["AirtelTigo 1GB", "GH₵3.95", "#3d8bff"],
                ["AirtelTigo 30GB", "GH₵115.00", "#3d8bff"],
              ].map(([label, price, color]) => (
                <div
                  key={label}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid var(--line)",
                    borderRadius: 12,
                    padding: "10px 14px",
                    fontSize: 14,
                  }}
                >
                  <span style={{ color: color, fontWeight: 800 }}>{label}</span>
                  <b>{price}</b>
                </div>
              ))}
            </div>
            <div className="foot">
              <small>No expiry · auto delivery</small>
              <Link href="/buy" style={{ fontSize: 13, fontWeight: 800 }}>
                View all prices →
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="k">How it works</div>
          <h2 className="t" style={{ margin: "8px 0 26px" }}>
            Buying data takes under a minute
          </h2>
          <div className="steps">
            <div className="step">
              <h4>Choose your bundle</h4>
              <p>Pick your network and size — from 1GB to 100GB, all non-expiry.</p>
            </div>
            <div className="step">
              <h4>Enter the number</h4>
              <p>Type the recipient number and verify it twice. No refunds for wrong numbers.</p>
            </div>
            <div className="step">
              <h4>Pay with MoMo</h4>
              <p>Approve the Mobile Money prompt on your phone — or pay from your wallet balance.</p>
            </div>
            <div className="step">
              <h4>Data arrives</h4>
              <p>Our system routes your order through the fastest active provider and delivers automatically.</p>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="cta-band">
            <h2 className="t">Join thousands of Ghanaians buying smarter</h2>
            <p className="lead">
              Create a free account for member pricing, order history, wallet and your own
              storefront. Or skip signup entirely and buy as a guest.
            </p>
            <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
              <Link className="btn btn-green" href="/buy">
                Buy Data as Guest
              </Link>
              <Link className="btn btn-lime" href="/signup">
                Create Free Account
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
