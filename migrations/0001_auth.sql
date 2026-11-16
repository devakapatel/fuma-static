-- Users for the username/password login.
-- `paid_until` is the paywall: NULL means no AI access.
CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,
  username        TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  paid_until      TEXT,
  session_version INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users (username);

-- Simple brute-force guard, keyed by username + client IP.
CREATE TABLE IF NOT EXISTS login_attempts (
  key       TEXT PRIMARY KEY,
  count     INTEGER NOT NULL DEFAULT 0,
  reset_at  TEXT NOT NULL
);
