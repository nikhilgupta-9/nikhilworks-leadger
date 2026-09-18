-- NikhilWorks Ledger — database schema (MySQL / MariaDB)
-- Import this once via phpMyAdmin (or `mysql -u USER -p DBNAME < schema.sql`)
-- before visiting install/setup.php on your site.
--
-- v2: clients can now have multiple projects/services, each project has its
-- own cost, its own monthly payment history, and (optionally) its own
-- outsourced-vendor cost/advance tracking. Invoices are generated against a
-- specific client (optionally tied to one project).

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS admin_users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(60) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS settings (
  id TINYINT PRIMARY KEY DEFAULT 1,
  legal_name VARCHAR(190) NOT NULL DEFAULT '',
  tagline VARCHAR(190) NOT NULL DEFAULT 'WEB DEVELOPMENT & SEO',
  owner_name VARCHAR(190) NOT NULL DEFAULT 'Nikhil Gupta',
  gstin VARCHAR(20) NOT NULL DEFAULT '',
  pan VARCHAR(15) NOT NULL DEFAULT '',
  address VARCHAR(255) NOT NULL DEFAULT '',
  state VARCHAR(60) NOT NULL DEFAULT 'Delhi',
  email VARCHAR(190) NOT NULL DEFAULT '',
  phone VARCHAR(40) NOT NULL DEFAULT '',
  website VARCHAR(190) NOT NULL DEFAULT '',
  bank_account_name VARCHAR(190) NOT NULL DEFAULT '',
  bank_account_number VARCHAR(60) NOT NULL DEFAULT '',
  bank_ifsc VARCHAR(20) NOT NULL DEFAULT '',
  bank_name VARCHAR(190) NOT NULL DEFAULT '',
  bank_branch VARCHAR(190) NOT NULL DEFAULT '',
  proforma_validity_days INT NOT NULL DEFAULT 7,
  tax_prefix VARCHAR(10) NOT NULL DEFAULT 'NW',
  tax_counter INT NOT NULL DEFAULT 1,
  proforma_prefix VARCHAR(10) NOT NULL DEFAULT 'PF',
  proforma_counter INT NOT NULL DEFAULT 1,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- A client is just the company/person. Their actual paid work lives in
-- `projects` below — one client can have many projects/services.
CREATE TABLE IF NOT EXISTS clients (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(190) NOT NULL,
  phone VARCHAR(40) NOT NULL DEFAULT '',
  email VARCHAR(190) NOT NULL DEFAULT '',
  contact_name VARCHAR(190) NOT NULL DEFAULT '',
  contact_title VARCHAR(190) NOT NULL DEFAULT '',
  gstin VARCHAR(20) NOT NULL DEFAULT '',
  address VARCHAR(255) NOT NULL DEFAULT '',
  state VARCHAR(60) NOT NULL DEFAULT 'Delhi',
  notes TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- One row per service/project you're doing for a client (website, SEO,
-- ads management, etc). Each project has its own value and its own
-- month-by-month payment trail. If you've outsourced part of the work,
-- the vendor_* fields track what you owe/have paid your vendor for it —
-- completely separate from what the client owes you.
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

-- Money the CLIENT has paid you, against a specific project. Multiple rows
-- per project over many months is exactly the point (e.g. one row per
-- month's retainer/installment).
CREATE TABLE IF NOT EXISTS payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  project_id INT NOT NULL,
  client_id INT NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  payment_date DATE NOT NULL,
  month VARCHAR(7) NOT NULL DEFAULT '',
  mode VARCHAR(40) NOT NULL DEFAULT 'Bank Transfer',
  note VARCHAR(255) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_payments_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_payments_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Money YOU have paid an outsourced vendor for a project (advance +
-- further installments). Independent of what the client has paid you.
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

-- General business cash flow, kept separate from client/project payments so
-- you can track all monthly incoming and outgoing money in one place.
CREATE TABLE IF NOT EXISTS cash_entries (
  id INT AUTO_INCREMENT PRIMARY KEY,
  client_id INT NULL,
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
  INDEX idx_cash_entries_date (entry_date),
  CONSTRAINT fk_cash_entries_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS invoices (
  id INT AUTO_INCREMENT PRIMARY KEY,
  client_id INT NOT NULL,
  project_id INT NULL,
  client_name VARCHAR(190) NOT NULL,
  project_title VARCHAR(190) NOT NULL DEFAULT '',
  type ENUM('proforma','tax') NOT NULL,
  number VARCHAR(40) NOT NULL,
  invoice_date DATE NOT NULL,
  due_date DATE NULL,
  valid_till DATE NULL,
  items JSON NOT NULL,
  subtotal DECIMAL(12,2) NOT NULL DEFAULT 0,
  gst_rate DECIMAL(5,2) NOT NULL DEFAULT 0,
  cgst DECIMAL(12,2) NOT NULL DEFAULT 0,
  sgst DECIMAL(12,2) NOT NULL DEFAULT 0,
  igst DECIMAL(12,2) NOT NULL DEFAULT 0,
  total DECIMAL(12,2) NOT NULL DEFAULT 0,
  advance_percent DECIMAL(5,2) NOT NULL DEFAULT 0,
  advance_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  balance_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  notes TEXT NULL,
  place_of_supply VARCHAR(60) NOT NULL DEFAULT '',
  is_imported TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_invoices_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
  CONSTRAINT fk_invoices_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
  UNIQUE KEY uniq_invoice_number (number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Seed the single settings row with NikhilWorks' business details.
-- Edit these values any time from the app's Settings page after install.
INSERT INTO settings (id, legal_name, tagline, owner_name, gstin, pan, address, state, email, phone, website,
  bank_account_name, bank_account_number, bank_ifsc, bank_name, bank_branch,
  proforma_validity_days, tax_prefix, tax_counter, proforma_prefix, proforma_counter)
VALUES (1, 'NikhilWorks', 'WEB DEVELOPMENT & SEO', 'Nikhil Gupta', '07DEUPG7632R1ZH', 'DEUPG7632R', 'A-42, B-58, Rama Road, New Delhi – 110015', 'Delhi',
  'contact@nikhilworks.com', '+91-8368552640', 'nikhilworks.com',
  'Nikhil Gupta', '188368552640', 'INDB0002234', 'IndusInd Bank', 'DLF Tower, Moti Nagar, Delhi',
  7, 'NW', 1, 'PF', 1)
ON DUPLICATE KEY UPDATE id = id;
