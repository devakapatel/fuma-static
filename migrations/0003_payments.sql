-- Payment intents for the in-page Razorpay UPI QR flow.
-- `amount` and `currency` follow Razorpay: paise and INR.
CREATE TABLE IF NOT EXISTS payment_intents (
  id                    TEXT PRIMARY KEY,
  user_id               TEXT NOT NULL,
  purpose               TEXT NOT NULL,              -- ai | donation | ad
  plan_id               TEXT,
  label                 TEXT NOT NULL,
  amount                INTEGER NOT NULL,
  currency              TEXT NOT NULL DEFAULT 'INR',
  duration_days         INTEGER,
  status                TEXT NOT NULL DEFAULT 'created', -- created | paid | refunded
  razorpay_qr_id        TEXT UNIQUE,
  razorpay_payment_id   TEXT UNIQUE,
  qr_image_url          TEXT,
  metadata              TEXT,
  expires_at            TEXT NOT NULL,
  paid_at               TEXT,
  fulfilled_at          TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_payment_intents_user
  ON payment_intents (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_intents_qr
  ON payment_intents (razorpay_qr_id);

-- Replay protection for Razorpay webhook deliveries.
CREATE TABLE IF NOT EXISTS webhook_events (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL,
  received_at TEXT NOT NULL
);
