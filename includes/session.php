<?php
/**
 * Session bootstrap + auth helpers, shared by every page and API endpoint.
 */
require_once __DIR__ . '/db.php';

if (session_status() !== PHP_SESSION_ACTIVE) {
  $secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off');
  session_set_cookie_params([
    'lifetime' => SESSION_LIFETIME,
    'path' => '/',
    'httponly' => true,
    'samesite' => 'Lax',
    'secure' => $secure,
  ]);
  session_name('nwledger_sid');
  session_start();
}

function current_admin_id() {
  return isset($_SESSION['admin_id']) ? (int)$_SESSION['admin_id'] : null;
}

function is_logged_in() {
  return current_admin_id() !== null;
}

/** Call at the top of any page (not API) that requires login. */
function require_login_page() {
  if (!is_logged_in()) {
    header('Location: /login.php');
    exit;
  }
}

/** Call at the top of any api/*.php endpoint. Sends a JSON 401 and exits if not logged in. */
function require_login_api() {
  if (!is_logged_in()) {
    http_response_code(401);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'not_authenticated', 'message' => 'Please log in again.']);
    exit;
  }
}

function login_admin($adminId) {
  session_regenerate_id(true);
  $_SESSION['admin_id'] = $adminId;
  $_SESSION['csrf'] = bin2hex(random_bytes(32));
}

function logout_admin() {
  $_SESSION = [];
  if (ini_get('session.use_cookies')) {
    $params = session_get_cookie_params();
    setcookie(session_name(), '', time() - 42000, $params['path'], $params['domain'], $params['secure'], $params['httponly']);
  }
  session_destroy();
}

function csrf_token() {
  if (empty($_SESSION['csrf'])) {
    $_SESSION['csrf'] = bin2hex(random_bytes(32));
  }
  return $_SESSION['csrf'];
}

/** Verify the X-CSRF-Token header on state-changing API requests. */
function require_csrf_api() {
  $sent = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
  if (empty($_SESSION['csrf']) || !hash_equals($_SESSION['csrf'], $sent)) {
    http_response_code(403);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'bad_csrf', 'message' => 'Session expired, please refresh the page and try again.']);
    exit;
  }
}

/** Simple in-session throttle for login attempts. */
function login_throttle_check() {
  $fails = $_SESSION['login_fails'] ?? 0;
  $lastFail = $_SESSION['login_last_fail'] ?? 0;
  if ($fails >= 6 && (time() - $lastFail) < 60) {
    return false;
  }
  return true;
}
function login_throttle_hit() {
  $_SESSION['login_fails'] = ($_SESSION['login_fails'] ?? 0) + 1;
  $_SESSION['login_last_fail'] = time();
}
function login_throttle_reset() {
  unset($_SESSION['login_fails'], $_SESSION['login_last_fail']);
}
