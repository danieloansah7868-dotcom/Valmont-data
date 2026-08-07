import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await getSession();
  if (!user) redirect("/signin?next=/dashboard");

  const orders = await query(
    `SELECT public_id, network, bundle_gb, price, recipient_phone, status, created_at
     FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`,
    [user.id]
  );
  const txs = await query(
    `SELECT type, amount, ref, note, created_at FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`,
    [user.id]
  );

  return (
    <section>
      <div className="wrap">
        <div className="k">Account</div>
        <h1 className="t" style={{ margin: "8px 0 22px" }}>
          Hello, <span style={{ color: "var(--green)" }}>{user.name.split(" ")[0]}</span> 👋
        </h1>

        <div className="wallet-hero">
          <div>
            <div className="bal-label">Wallet Balance</div>
            <div className="bal">GH₵{Number(user.wallet_balance).toFixed(2)}</div>
            <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
              Tier: <b style={{ color: "var(--lime)" }}>{user.tier}</b>
            </div>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Link className="btn btn-green" href="/deposit">+ Deposit Funds</Link>
            <Link className="btn btn-ghost" href="/buy">Buy Data</Link>
          </div>
        </div>

        <h2 className="t" style={{ fontSize: 22, margin: "38px 0 14px" }}>Recent Orders</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Order ID</th>
                <th>Bundle</th>
                <th>Number</th>
                <th>Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {orders.rows.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: "center", color: "var(--muted)", padding: 26 }}>
                    No orders yet — <Link href="/buy">buy your first bundle</Link>.
                  </td>
                </tr>
              ) : (
                orders.rows.map((o) => (
                  <tr key={o.public_id}>
                    <td><b style={{ color: "#fff" }}>{o.public_id}</b></td>
                    <td>{o.bundle_gb}GB {o.network}</td>
                    <td>{o.recipient_phone}</td>
                    <td>GH₵{Number(o.price).toFixed(2)}</td>
                    <td><span className={"pill " + o.status}>{String(o.status).toUpperCase()}</span></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <h2 className="t" style={{ fontSize: 22, margin: "38px 0 14px" }}>Wallet Transactions</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Description</th>
                <th>Date</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {txs.rows.length === 0 ? (
                <tr>
                  <td colSpan={3} style={{ textAlign: "center", color: "var(--muted)", padding: 26 }}>
                    No transactions yet.
                  </td>
                </tr>
              ) : (
                txs.rows.map((t, i) => (
                  <tr key={i}>
                    <td>{t.note || t.ref}</td>
                    <td>{new Date(t.created_at).toLocaleString("en-GH")}</td>
                    <td
                      style={{
                        color: t.type === "deposit" || t.type === "refund" ? "var(--green-2)" : "var(--at-red)",
                      }}
                    >
                      {t.type === "deposit" || t.type === "refund" ? "+" : "−"}GH₵
                      {Number(t.amount).toFixed(2)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
