-- ============================================================================
-- VALMONT DATA — PostgreSQL schema
-- Run: npm run db:migrate   (requires DATABASE_URL in .env.local)
-- Idempotent: safe to run repeatedly.
-- ============================================================================

-- ---------- users ----------
CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  phone         TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  tier          TEXT NOT NULL DEFAULT 'member'   -- member | reseller | dealer | wholesaler
                CHECK (tier IN ('member','reseller','dealer','wholesaler')),
  wallet_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  store_id      BIGINT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- stores (reseller storefronts) ----------
CREATE TABLE IF NOT EXISTS stores (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug        TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  tagline     TEXT NOT NULL DEFAULT '',
  markup_pct  NUMERIC(5,2) NOT NULL DEFAULT 10,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS store_id BIGINT REFERENCES stores(id);

-- ---------- transactions (wallet ledger — never mutate balance without a row here) ----------
CREATE TABLE IF NOT EXISTS transactions (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('deposit','purchase','refund','withdrawal','adjustment')),
  amount      NUMERIC(12,2) NOT NULL,
  ref         TEXT,                              -- Paystack reference or order id
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id, created_at DESC);

-- ---------- bundles ----------
CREATE TABLE IF NOT EXISTS bundles (
  id           BIGSERIAL PRIMARY KEY,
  network      TEXT NOT NULL CHECK (network IN ('mtn','telecel','airteltigo')),
  gb           INT NOT NULL,
  price_tiers  JSONB NOT NULL,                   -- {"guest":4.20,"member":4.10,"reseller":4.00,"dealer":3.90,"wholesaler":3.80}
  expiry_policy TEXT NOT NULL DEFAULT 'none',    -- none | rollover_60d
  active       BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (network, gb)
);

-- ---------- providers (wholesale data suppliers) ----------
CREATE TABLE IF NOT EXISTS providers (
  id           BIGSERIAL PRIMARY KEY,
  network      TEXT NOT NULL,
  name         TEXT NOT NULL,
  priority     INT NOT NULL DEFAULT 100,         -- lower = tried first
  health       JSONB NOT NULL DEFAULT '{"speed_ms":null,"success_rate":1,"price_index":1}',
  active       BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (network, name)
);

-- ---------- orders ----------
CREATE TABLE IF NOT EXISTS orders (
  id             BIGSERIAL PRIMARY KEY,
  public_id      TEXT UNIQUE NOT NULL,           -- e.g. VD-260802-4831
  user_id        BIGINT REFERENCES users(id),
  network        TEXT NOT NULL,
  bundle_gb      INT NOT NULL,
  price          NUMERIC(12,2) NOT NULL,
  recipient_phone TEXT NOT NULL,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('momo','wallet')),
  momo_ref       TEXT,                           -- Paystack reference for momo orders
  provider_id    BIGINT REFERENCES providers(id),
  status         TEXT NOT NULL DEFAULT 'unpaid'
                 CHECK (status IN ('unpaid','paid','processing','delivered','failed','refunded')),
  idempotency_key TEXT UNIQUE,                   -- client sends this to prevent double orders
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

-- ---------- order_events (tracking timeline) ----------
CREATE TABLE IF NOT EXISTS order_events (
  id         BIGSERIAL PRIMARY KEY,
  order_id   BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status     TEXT NOT NULL,
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_events_order ON order_events(order_id, created_at);

-- ---------- api_keys (developer API) ----------
CREATE TABLE IF NOT EXISTS api_keys (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_hash      TEXT UNIQUE NOT NULL,            -- store sha256 of the key, never the key itself
  tier          TEXT NOT NULL DEFAULT 'reseller',
  scopes        TEXT[] NOT NULL DEFAULT '{"purchase","status","balance"}',
  rate_limit    INT NOT NULL DEFAULT 60,         -- requests per minute
  webhook_url   TEXT,
  webhook_secret TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- seed: bundles (mirrors the prototype's prices) ----------
INSERT INTO bundles (network, gb, price_tiers, expiry_policy) VALUES
  ('mtn', 1,  '{"guest":4.20,"member":4.10,"reseller":4.00,"dealer":3.90,"wholesaler":3.80}', 'none'),
  ('mtn', 2,  '{"guest":9.00,"member":8.50,"reseller":8.30,"dealer":8.10,"wholesaler":7.90}', 'none'),
  ('mtn', 3,  '{"guest":13.50,"member":12.50,"reseller":12.20,"dealer":11.90,"wholesaler":11.60}', 'none'),
  ('mtn', 5,  '{"guest":20.50,"member":20.50,"reseller":19.90,"dealer":19.40,"wholesaler":18.90}', 'none'),
  ('mtn', 10, '{"guest":43.00,"member":40.50,"reseller":39.50,"dealer":38.50,"wholesaler":37.50}', 'none'),
  ('mtn', 20, '{"guest":82.00,"member":77.00,"reseller":75.00,"dealer":73.00,"wholesaler":71.00}', 'none'),
  ('mtn', 30, '{"guest":125.00,"member":117.00,"reseller":114.00,"dealer":111.00,"wholesaler":108.00}', 'none'),
  ('mtn', 50, '{"guest":201.00,"member":195.00,"reseller":190.00,"dealer":185.00,"wholesaler":180.00}', 'none'),
  ('mtn', 100,'{"guest":407.00,"member":407.00,"reseller":397.00,"dealer":387.00,"wholesaler":377.00}', 'none'),
  ('telecel', 10,  '{"guest":39.50,"member":38.50,"reseller":37.50,"dealer":36.50,"wholesaler":35.50}', 'rollover_60d'),
  ('telecel', 20,  '{"guest":75.00,"member":73.80,"reseller":71.80,"dealer":69.80,"wholesaler":67.80}', 'rollover_60d'),
  ('telecel', 30,  '{"guest":110.00,"member":107.70,"reseller":104.70,"dealer":101.70,"wholesaler":98.70}', 'rollover_60d'),
  ('telecel', 50,  '{"guest":180.00,"member":177.50,"reseller":172.50,"dealer":167.50,"wholesaler":162.50}', 'rollover_60d'),
  ('telecel', 100, '{"guest":405.00,"member":397.00,"reseller":387.00,"dealer":377.00,"wholesaler":367.00}', 'rollover_60d'),
  ('airteltigo', 1,  '{"guest":4.00,"member":3.95,"reseller":3.85,"dealer":3.75,"wholesaler":3.65}', 'rollover_60d'),
  ('airteltigo', 5,  '{"guest":19.90,"member":19.50,"reseller":19.00,"dealer":18.50,"wholesaler":18.00}', 'rollover_60d'),
  ('airteltigo', 10, '{"guest":39.00,"member":38.50,"reseller":37.50,"dealer":36.50,"wholesaler":35.50}', 'rollover_60d'),
  ('airteltigo', 30, '{"guest":117.00,"member":115.00,"reseller":112.00,"dealer":109.00,"wholesaler":106.00}', 'rollover_60d'),
  ('airteltigo', 50, '{"guest":193.00,"member":190.00,"reseller":185.00,"dealer":180.00,"wholesaler":175.00}', 'rollover_60d')
ON CONFLICT (network, gb) DO NOTHING;

-- ---------- seed: providers (mock driver only; replace with real contracts) ----------
INSERT INTO providers (network, name, priority) VALUES
  ('mtn', 'mock-provider', 10),
  ('telecel', 'mock-provider', 10),
  ('airteltigo', 'mock-provider', 10)
ON CONFLICT (network, name) DO NOTHING;
