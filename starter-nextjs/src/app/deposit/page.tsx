"use client";

import { useState } from "react";

export default function DepositPage() {
  const [amount, setAmount] = useState("");
  const [phone, setPhone] = useState("");
  const [network, setNetwork] = useState("mtn");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/deposits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: Number(amount), phone, network }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ ok: false, text: data.error || "Deposit failed" });
      } else {
        setMsg({
          ok: true,
          text:
            data.payment?.message +
            (data.wallet_balance != null ? ` New balance: GH₵${data.wallet_balance.toFixed(2)}` : ""),
        });
        if (data.wallet_balance != null) setAmount("");
      }
    } catch {
      setMsg({ ok: false, text: "Network error — try again" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <div className="wrap" style={{ maxWidth: 720 }}>
        <div className="k">Wallet</div>
        <h1 className="t" style={{ margin: "8px 0 12px" }}>
          Deposit Funds
        </h1>
        <p className="lead">
          Add money to your wallet via Mobile Money — then pay for bundles with one tap, no MoMo
          prompt on every order.
        </p>

        <div className="card" style={{ marginTop: 26, padding: 30 }}>
          <form onSubmit={submit}>
            <div className="field">
              <label htmlFor="depAmount">Amount (GHS)</label>
              <input
                className="inp"
                id="depAmount"
                type="number"
                min={1}
                step="0.01"
                placeholder="e.g. 50"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="depPhone">Mobile Money Number</label>
              <input
                className="inp"
                id="depPhone"
                inputMode="tel"
                placeholder="e.g. 024 000 0000"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="depNet">Mobile Network</label>
              <select className="inp" id="depNet" value={network} onChange={(e) => setNetwork(e.target.value)}>
                <option value="mtn">MTN Mobile Money</option>
                <option value="telecel">Telecel Cash</option>
                <option value="airteltigo">AirtelTigo Money</option>
              </select>
            </div>
            <button className="btn btn-green btn-block" type="submit" disabled={busy}>
              {busy ? "Processing…" : "Deposit Now →"}
            </button>
            {msg && (
              <div
                className="notice"
                style={
                  msg.ok
                    ? { background: "rgba(47,230,143,0.08)", borderColor: "rgba(47,230,143,0.4)", color: "var(--green-2)" }
                    : undefined
                }
              >
                {msg.text}
              </div>
            )}
            <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 12, textAlign: "center" }}>
              Support: support@valmontdata.com · Deposits require a signed-in account.
            </p>
          </form>
        </div>
      </div>
    </section>
  );
}
