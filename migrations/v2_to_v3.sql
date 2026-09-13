-- NikhilWorks Ledger — v2 -> v3: exact-match invoice design + manual
-- invoice import.
--
-- Purely additive (new columns with safe defaults) — does not touch or
-- delete any existing client/project/payment/invoice data. Safe to run
-- more than once.
--
-- HOW TO RUN: same as before — phpMyAdmin -> your database -> Import ->
-- choose this file -> Go.

SET NAMES utf8mb4;

DROP PROCEDURE IF EXISTS nw_migrate_v2_to_v3;

DELIMITER $$
CREATE PROCEDURE nw_migrate_v2_to_v3()
BEGIN

  -- settings: business tagline, the name that signs invoices, and how many
  -- days a Proforma Invoice stays valid for (used to print "Valid Till").
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='settings' AND column_name='tagline') THEN
    ALTER TABLE settings ADD COLUMN tagline VARCHAR(190) NOT NULL DEFAULT 'WEB DEVELOPMENT & SEO';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='settings' AND column_name='owner_name') THEN
    ALTER TABLE settings ADD COLUMN owner_name VARCHAR(190) NOT NULL DEFAULT 'Nikhil Gupta';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='settings' AND column_name='proforma_validity_days') THEN
    ALTER TABLE settings ADD COLUMN proforma_validity_days INT NOT NULL DEFAULT 7;
  END IF;

  -- clients: optional contact person, printed as "Attn: <name> (<title>)"
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='clients' AND column_name='contact_name') THEN
    ALTER TABLE clients ADD COLUMN contact_name VARCHAR(190) NOT NULL DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='clients' AND column_name='contact_title') THEN
    ALTER TABLE clients ADD COLUMN contact_title VARCHAR(190) NOT NULL DEFAULT '';
  END IF;

  -- invoices: optional advance/balance split (e.g. "50% advance now"),
  -- a printed validity date for Proforma Invoices, and a flag for
  -- invoices you generated outside the app and are just logging here
  -- (so re-running an import never clashes with the auto-numbering).
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='invoices' AND column_name='advance_percent') THEN
    ALTER TABLE invoices ADD COLUMN advance_percent DECIMAL(5,2) NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='invoices' AND column_name='advance_amount') THEN
    ALTER TABLE invoices ADD COLUMN advance_amount DECIMAL(12,2) NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='invoices' AND column_name='balance_amount') THEN
    ALTER TABLE invoices ADD COLUMN balance_amount DECIMAL(12,2) NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='invoices' AND column_name='valid_till') THEN
    ALTER TABLE invoices ADD COLUMN valid_till DATE NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='invoices' AND column_name='is_imported') THEN
    ALTER TABLE invoices ADD COLUMN is_imported TINYINT(1) NOT NULL DEFAULT 0;
  END IF;

END$$
DELIMITER ;

CALL nw_migrate_v2_to_v3();
DROP PROCEDURE nw_migrate_v2_to_v3;
