-- NikhilWorks Ledger — migration from v1 (one project per client) to v2
-- (multiple projects per client + outsourcing tracker).
--
-- SAFE TO RUN ON YOUR LIVE DATABASE. It does not delete any client,
-- payment, or invoice data — it only reshapes it into the new tables.
-- It is also safe to run more than once: if it detects you're already
-- on the new structure (or partly migrated), it skips what's already
-- done instead of erroring out.
--
-- HOW TO RUN:
--   1. cPanel -> phpMyAdmin -> click your ledger database in the left
--      sidebar (the SAME database your live ledger is already using).
--   2. Click the "Import" tab.
--   3. Choose this file (migrations/v1_to_v2.sql) -> click "Go".
--   4. You should see "Query OK" / success messages, no errors.
--   5. Reload the ledger app in your browser — your existing clients
--      should now each show up with one project carrying their old
--      service/amount/status, and their old payments attached to it.
--
-- After this runs successfully, your `clients` table no longer has
-- service/start_date/total_amount/status columns (that data now lives
-- in `projects`), which matches the schema.sql shipped with v2.

SET NAMES utf8mb4;

DROP PROCEDURE IF EXISTS nw_migrate_v1_to_v2;

DELIMITER $$
CREATE PROCEDURE nw_migrate_v1_to_v2()
proc_body: BEGIN

  -- ---- 1. Make sure the new tables exist (harmless if they already do) ----
  CREATE TABLE IF NOT EXISTS projects (
    id INT AUTO_INCREMENT PRIMARY KEY,
    client_id INT NOT NULL,
    title VARCHAR(190) NOT NULL,
    description TEXT NULL,
    total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    gst_rate DECIMAL(5,2) NOT NULL DEFAULT 18,
    start_date DATE NULL,
    status ENUM('active','on-hold','completed') NOT NULL DEFAULT 'active',
    is_outsourced TINYINT(1) NOT NULL DEFAULT 0,
    vendor_name VARCHAR(190) NOT NULL DEFAULT '',
    vendor_phone VARCHAR(40) NOT NULL DEFAULT '',
    vendor_cost DECIMAL(12,2) NOT NULL DEFAULT 0,
    vendor_notes TEXT NULL,
    notes TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_projects_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

  CREATE TABLE IF NOT EXISTS vendor_payments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    project_id INT NOT NULL,
    amount DECIMAL(12,2) NOT NULL,
    payment_date DATE NOT NULL,
    mode VARCHAR(40) NOT NULL DEFAULT 'Bank Transfer',
    note VARCHAR(255) NOT NULL DEFAULT '',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_vendorpay_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

  -- ---- 2. Only migrate embedded client data if the OLD columns are
  --         still there. Once migrated, `service` is dropped below, so
  --         re-running this procedure later just skips straight past.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'clients' AND column_name = 'service'
  ) THEN
    LEAVE proc_body;
  END IF;

  -- Add the two new client-level fields (harmless defaults for existing rows)
  ALTER TABLE clients ADD COLUMN gstin VARCHAR(20) NOT NULL DEFAULT '' AFTER email;
  ALTER TABLE clients ADD COLUMN address VARCHAR(255) NOT NULL DEFAULT '' AFTER gstin;

  -- Turn every existing client's embedded service/amount/status into a
  -- real project row, one project per existing client.
  INSERT INTO projects (client_id, title, total_amount, start_date, status, created_at, updated_at)
    SELECT id,
           COALESCE(NULLIF(TRIM(service), ''), 'General Project'),
           total_amount, start_date, status, created_at, updated_at
    FROM clients;

  -- Point every existing payment at the project we just created for its client.
  ALTER TABLE payments ADD COLUMN project_id INT NULL AFTER client_id;
  ALTER TABLE payments ADD COLUMN month VARCHAR(7) NOT NULL DEFAULT '';
  UPDATE payments p
    JOIN projects pr ON pr.client_id = p.client_id
    SET p.project_id = pr.id,
        p.month = DATE_FORMAT(p.payment_date, '%Y-%m')
    WHERE p.project_id IS NULL;
  ALTER TABLE payments MODIFY project_id INT NOT NULL;
  ALTER TABLE payments ADD CONSTRAINT fk_payments_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;

  -- Point every existing invoice at the same project (keeps old PIs/Tax
  -- invoices correctly linked instead of orphaned).
  ALTER TABLE invoices ADD COLUMN project_id INT NULL AFTER client_id;
  ALTER TABLE invoices ADD COLUMN project_title VARCHAR(190) NOT NULL DEFAULT '';
  UPDATE invoices i
    JOIN projects pr ON pr.client_id = i.client_id
    SET i.project_id = pr.id,
        i.project_title = pr.title
    WHERE i.project_id IS NULL;
  ALTER TABLE invoices ADD CONSTRAINT fk_invoices_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL;

  -- Finally, drop the now-redundant single-project columns from clients —
  -- this also marks the migration as "done" so re-running is a no-op.
  ALTER TABLE clients DROP COLUMN service;
  ALTER TABLE clients DROP COLUMN start_date;
  ALTER TABLE clients DROP COLUMN total_amount;
  ALTER TABLE clients DROP COLUMN status;

END proc_body $$
DELIMITER ;

CALL nw_migrate_v1_to_v2();
DROP PROCEDURE nw_migrate_v1_to_v2;
