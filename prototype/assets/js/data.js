/* ==========================================================================
   VALMONT DATA — PRODUCT & PRICING DATA (Prototype)
   Prices mirror the Ghana data-bundle market (GHS, non-expiry / rollover).
   In the full-stack build these come from the `bundles` table via API.
   ========================================================================== */

window.VD_DATA = {
  networks: {
    mtn:       { name: "MTN",        short: "MTN",        color: "#ffcb05", badge: "No Expiry" },
    telecel:   { name: "Telecel",    short: "Telecel",    color: "#ff4d3d", badge: "60-Day Rollover" },
    airteltigo:{ name: "AirtelTigo", short: "AT iShare",  color: "#3d8bff", badge: "60-Day Rollover" }
  },

  /* account / member prices (reseller tier) */
  bundles: {
    mtn: [
      { gb: 1,  price: 4.10  }, { gb: 2,  price: 8.50  }, { gb: 3,  price: 12.50 },
      { gb: 4,  price: 16.80 }, { gb: 5,  price: 20.50 }, { gb: 6,  price: 24.00 },
      { gb: 8,  price: 32.00 }, { gb: 10, price: 40.50 }, { gb: 15, price: 57.00 },
      { gb: 20, price: 77.00 }, { gb: 25, price: 96.00 }, { gb: 30, price: 117.00 },
      { gb: 40, price: 155.00}, { gb: 50, price: 195.00}, { gb: 100, price: 407.00 }
    ],
    telecel: [
      { gb: 10, price: 38.50 }, { gb: 15, price: 54.85 }, { gb: 20, price: 73.80 },
      { gb: 25, price: 90.75 }, { gb: 30, price: 107.70}, { gb: 35, price: 130.65},
      { gb: 40, price: 142.60}, { gb: 45, price: 154.55}, { gb: 50, price: 177.50},
      { gb: 100, price: 397.00}
    ],
    airteltigo: [
      { gb: 1, price: 3.95 }, { gb: 2, price: 8.35 }, { gb: 3, price: 13.25 },
      { gb: 4, price: 16.50 }, { gb: 5, price: 19.50 }, { gb: 6, price: 23.50 },
      { gb: 8, price: 30.50 }, { gb: 10, price: 38.50 }, { gb: 12, price: 45.50 },
      { gb: 15, price: 57.50 }, { gb: 25, price: 95.00 }, { gb: 30, price: 115.00 },
      { gb: 40, price: 151.00}, { gb: 50, price: 190.00}
    ]
  },

  /* guest prices shown on /buy (no-account checkout) */
  guest: {
    mtn: [
      { gb: 1, price: 4.20 }, { gb: 2, price: 9.00 }, { gb: 3, price: 13.50 },
      { gb: 4, price: 19.00 }, { gb: 5, price: 23.00 }, { gb: 6, price: 27.00 },
      { gb: 8, price: 36.00 }, { gb: 10, price: 43.00 }, { gb: 15, price: 62.00 },
      { gb: 20, price: 82.00 }, { gb: 25, price: 103.00 }, { gb: 30, price: 125.00 },
      { gb: 50, price: 201.00 }
    ],
    telecel: [
      { gb: 10, price: 39.50 }, { gb: 15, price: 56.00 }, { gb: 20, price: 75.00 },
      { gb: 25, price: 92.00 }, { gb: 30, price: 110.00 }, { gb: 35, price: 133.00 },
      { gb: 40, price: 145.00 }, { gb: 45, price: 157.00 }, { gb: 50, price: 180.00 },
      { gb: 100, price: 405.00 }
    ],
    airteltigo: [
      { gb: 1, price: 4.00 }, { gb: 2, price: 8.50 }, { gb: 3, price: 13.50 },
      { gb: 4, price: 16.80 }, { gb: 5, price: 19.90 }, { gb: 6, price: 24.00 },
      { gb: 8, price: 31.00 }, { gb: 10, price: 39.00 }, { gb: 12, price: 46.00 },
      { gb: 15, price: 58.50 }, { gb: 25, price: 97.00 }, { gb: 30, price: 117.00 },
      { gb: 40, price: 154.00 }, { gb: 50, price: 193.00 }
    ]
  },

  /* airtime top-up denominations (GHS credit, member price) */
  airtime: [
    { val: 1, price: 0.98 }, { val: 2, price: 1.95 }, { val: 5, price: 4.85 },
    { val: 10, price: 9.65 }, { val: 20, price: 19.30 }, { val: 30, price: 28.90 },
    { val: 50, price: 48.00 }, { val: 100, price: 95.50 }, { val: 200, price: 190.00 },
    { val: 500, price: 472.00 }
  ],

  delivery: {
    fastLane: "≈ 1h 52m",
    standard: "≈ 4h",
    note: "Live network conditions shown before you pay. Typical wait 4 hr.",
    demoMinutes: 1.5   // demo fast-forward: orders "deliver" after ~90 seconds
  },

  stats: {
    orders: "480K+",
    resellers: "40K+",
    uptime: "99.9%",
    networks: "3"
  }
};
