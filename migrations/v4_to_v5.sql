-- NikhilWorks Ledger — v4 -> v5: optional client links for Cash Flow.
-- Existing cash-flow entries remain unlinked and are not changed.

SET NAMES utf8mb4;

DROP PROCEDURE IF EXISTS nw_migrate_v4_to_v5;

DELIMITER $$
CREATE PROCEDURE nw_migrate_v4_to_v5()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='cash_entries' AND column_name='client_id') THEN
    ALTER TABLE cash_entries ADD COLUMN client_id INT NULL AFTER id;
    ALTER TABLE cash_entries ADD INDEX idx_cash_entries_client (client_id);
    ALTER TABLE cash_entries ADD CONSTRAINT fk_cash_entries_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL;
  END IF;
END$$
DELIMITER ;

CALL nw_migrate_v4_to_v5();
DROP PROCEDURE nw_migrate_v4_to_v5;
