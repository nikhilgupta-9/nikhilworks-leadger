<?php
/**
 * NikhilWorks Ledger — site configuration.
 *
 * Fill in your MySQL database details below (from your hosting cPanel,
 * under "MySQL Databases"). Then import schema.sql into that database
 * before visiting install/setup.php.
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
