-- NikhilWorks Ledger — v6 -> v7: biometric (passkey) login.
--
-- Additive only: creates the `passkeys` table. Nothing existing is changed,
-- and it is safe to run more than once.
--
-- HOW TO RUN: phpMyAdmin -> your ledger database -> Import -> choose this
-- file -> Go.

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS passkeys (
  id INT AUTO_INCREMENT PRIMARY KEY,
  admin_id INT NOT NULL,
  credential_id VARCHAR(255) NOT NULL,
  public_key TEXT NOT NULL,
  alg INT NOT NULL,
  sign_count INT UNSIGNED NOT NULL DEFAULT 0,
  label VARCHAR(100) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at DATETIME NULL,
  UNIQUE KEY uq_passkey_credential (credential_id),
  KEY idx_passkey_admin (admin_id),
  CONSTRAINT fk_passkey_admin FOREIGN KEY (admin_id) REFERENCES admin_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
