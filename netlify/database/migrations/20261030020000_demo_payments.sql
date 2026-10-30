-- V15.3: simulated payments only. No bank, card or payment-provider data.
-- Existing customers, room types and bookings are preserved.
CREATE TABLE IF NOT EXISTS demo_payments (
 id BIGSERIAL PRIMARY KEY,
 booking_id BIGINT NOT NULL UNIQUE REFERENCES bookings(id),
 reference TEXT NOT NULL UNIQUE,
 method TEXT NOT NULL CHECK (method IN ('demo_card','demo_wallet')),
 amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
 status TEXT NOT NULL CHECK (status IN ('paid','refunded')),
 paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 refunded_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_demo_payments_status_paid_at ON demo_payments(status,paid_at);
