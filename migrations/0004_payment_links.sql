-- Switch the account page from Razorpay UPI QR codes to Payment Links.
-- The QR columns stay in place so intents created before this migration
-- can still be settled by the legacy qr_code.credited webhook.
ALTER TABLE payment_intents ADD COLUMN razorpay_link_id TEXT;
ALTER TABLE payment_intents ADD COLUMN short_url TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_intents_link
  ON payment_intents (razorpay_link_id);
