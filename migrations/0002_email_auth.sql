-- Accounts are now identified by email instead of username.
ALTER TABLE users RENAME COLUMN username TO email;

DROP INDEX IF EXISTS idx_users_username;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users (email);
