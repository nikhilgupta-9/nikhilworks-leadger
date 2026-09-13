<?php
/**
 * NikhilWorks Ledger — site configuration TEMPLATE.
 *
 * This file is tracked in git; config.php itself is NOT (it's in
 * .gitignore) so your real database password and secret key never get
 * committed or pushed anywhere. To set up:
 *   1. Copy this file to config.php (same folder).
 *   2. Fill in your real MySQL database details below (from your hosting
 *      cPanel, under "MySQL Databases").
 *   3. Import schema.sql into that database, then visit install/setup.php.
 */

// ---- Database ----
define('DB_HOST', 'localhost');       // usually "localhost" on shared hosting
define('DB_NAME', 'your_db_name');    // e.g. nikhilw1_ledger
define('DB_USER', 'your_db_user');    // e.g. nikhilw1_ledgeruser
define('DB_PASS', 'your_db_password');

// ---- Security ----
// Any long random string, used to sign session cookies. Change this to
// your own random value before going live (it does not need to be
// remembered — just keep it the same across deploys so sessions don't
// invalidate).
define('APP_SECRET', 'change-this-to-a-long-random-string-before-going-live');

// ---- App ----
define('APP_NAME', 'NikhilWorks Ledger');
// Session lifetime in seconds (default: 12 hours)
define('SESSION_LIFETIME', 12 * 60 * 60);
