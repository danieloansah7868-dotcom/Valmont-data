import BundleGrid from "@/components/BundleGrid";

export const dynamic = "force-dynamic";

export default function BuyPage() {
  return (
    <section>
      <div className="wrap">
        <div className="k">Buy Data Bundles</div>
        <h1 className="t" style={{ margin: "8px 0 12px" }}>
          Buy Cheap Data Bundles Ghana
        </h1>
        <p className="lead">
          Pick a network, choose your size, pay with Mobile Money — and data lands on the number
          automatically. <b>No account needed.</b>
        </p>

        <div className="queuebar">
          <div className="lane fast">
            <span className="dot"></span>
            <span>
              <b>Fast lane · ≈ 1h 52m</b>
              <br />
              recent order delivered in 1h 51m
            </span>
          </div>
          <div className="lane std">
            <span className="dot"></span>
            <span>
              <b>Standard queue · ≈ 4h</b>
              <br />
              typical wait 4 hr
            </span>
          </div>
          <div className="spacer"></div>
          <a href="/track">Track Order →</a>
        </div>

        <div className="notice info">
          ⏳ <b>Good to know before you buy:</b> this is not an instant service — delivery times
          vary by network load. For urgent MTN data, dial <b>*138#</b> directly.
        </div>

        <BundleGrid />
      </div>
    </section>
  );
}
