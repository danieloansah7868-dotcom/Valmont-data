import Link from "next/link";

export default function Footer() {
  return (
    <footer className="footer">
      <div className="wrap">
        <div className="footer-grid">
          <div>
            <Link className="brand" href="/">
              <span className="logo">◈</span>
              <span>
                VALMONT<b style={{ color: "var(--green)" }}>DATA</b>
              </span>
            </Link>
            <p className="about-txt">
              Ghana&apos;s cheapest data bundles on MTN, Telecel &amp; AirtelTigo — with wallet
              payments, reseller stores and a developer API. A subsidiary of Valmont Group of
              Companies, Accra.
            </p>
          </div>
          <div>
            <h4>Platform</h4>
            <ul>
              <li><Link href="/buy">Buy Data</Link></li>
              <li><Link href="/deposit">Deposit / Wallet</Link></li>
              <li><Link href="/track">Track Order</Link></li>
            </ul>
          </div>
          <div>
            <h4>Account</h4>
            <ul>
              <li><Link href="/dashboard">Dashboard</Link></li>
              <li><Link href="/signin">Sign In</Link></li>
              <li><Link href="/signup">Sign Up Free</Link></li>
            </ul>
          </div>
          <div>
            <h4>Company</h4>
            <ul>
              <li><Link href="/api-doc">Developer API</Link></li>
              <li>
                <a href="https://valmont-group.vercel.app" target="_blank" rel="noopener">
                  Valmont Group →
                </a>
              </li>
            </ul>
          </div>
        </div>
        <div className="bottom">
          <span>© 2026 Valmont Data (Valmont Group of Companies). All rights reserved.</span>
          <span>Made in Ghana 🇬🇭</span>
        </div>
      </div>
    </footer>
  );
}
