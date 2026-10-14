-- NikhilWorks Ledger — v5 -> v6: payment receipts (no GST shown).
--
-- Additive only: creates the `receipts` table and adds the receipt
-- numbering fields to `settings`. Nothing existing is changed or deleted,
-- and it is safe to run more than once.
--
-- HOW TO RUN: phpMyAdmin -> your ledger database -> Import -> choose this
-- file -> Go.

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS receipts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  client_id INT NOT NULL,
  project_id INT NULL,
  payment_id INT NULL,
  client_name VARCHAR(190) NOT NULL,
  project_title VARCHAR(190) NOT NULL DEFAULT '',
  number VARCHAR(40) NOT NULL,
  receipt_date DATE NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  mode VARCHAR(40) NOT NULL DEFAULT 'Bank Transfer',
  reference VARCHAR(120) NOT NULL DEFAULT '',
  description VARCHAR(255) NOT NULL DEFAULT '',
  notes TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_receipts_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
  CONSTRAINT fk_receipts_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
  CONSTRAINT fk_receipts_payment FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE SET NULL,
  UNIQUE KEY uniq_receipt_number (number),
  UNIQUE KEY uniq_receipt_payment (payment_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

DROP PROCEDURE IF EXISTS nw_migrate_v5_to_v6;

DELIMITER $$
CREATE PROCEDURE nw_migrate_v5_to_v6()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='settings' AND column_name='receipt_prefix') THEN
    ALTER TABLE settings ADD COLUMN receipt_prefix VARCHAR(10) NOT NULL DEFAULT 'RC';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='settings' AND column_name='receipt_counter') THEN
    ALTER TABLE settings ADD COLUMN receipt_counter INT NOT NULL DEFAULT 1;
  END IF;
END$$
DELIMITER ;

CALL nw_migrate_v5_to_v6();
DROP PROCEDURE nw_migrate_v5_to_v6;
