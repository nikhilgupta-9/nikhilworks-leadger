-- NikhilWorks Ledger — v3 -> v4: monthly income and expense tracker.
--
-- Safe to run more than once. It only creates the new cash_entries table;
-- no existing client, project, payment, vendor-payment or invoice data is
-- changed.

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS cash_entries (
  id INT AUTO_INCREMENT PRIMARY KEY,
  entry_type ENUM('income','expense') NOT NULL,
  title VARCHAR(190) NOT NULL,
  category VARCHAR(80) NOT NULL DEFAULT '',
  amount DECIMAL(12,2) NOT NULL,
  entry_date DATE NOT NULL,
  month VARCHAR(7) NOT NULL,
  plan_status ENUM('planned','unplanned') NOT NULL DEFAULT 'planned',
  note VARCHAR(255) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_cash_entries_month (month),
  INDEX idx_cash_entries_date (entry_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
