<?php
/**
 * "My Profile": the logged-in user's own account details.
 *   GET                      -> username, display name, email, created/last login
 *   POST op=update_profile   -> change display name / username / email
 *   POST op=change_password  -> needs the current password
 */
require_once __DIR__ . '/../includes/session.php';
require_once __DIR__ . '/../includes/helpers.php';
require_login_api();
$pdo = db();
$id = current_admin_id();

function profile_row($pdo, $id) {
  $st = $pdo->prepare("SELECT username, display_name, email, created_at, last_login_at FROM admin_users WHERE id=?");
  $st->execute([$id]);
  return $st->fetch();
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
  json_out(['profile' => profile_row($pdo, $id)]);
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_error('Method not allowed', 405, 'method_not_allowed');
require_csrf_api();
$body = json_body();
$op = str_field($body, 'op');

if ($op === 'update_profile') {
  $username = str_field($body, 'username');
  $display = substr(str_field($body, 'display_name'), 0, 120);
  $email = substr(str_field($body, 'email'), 0, 190);
  if (!preg_match('/^[A-Za-z0-9._-]{3,60}$/', $username)) json_error('Username must be 3–60 characters: letters, numbers, dot, dash or underscore.');
  if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) json_error('That email address doesn\'t look right.');
  $dup = $pdo->prepare("SELECT COUNT(*) FROM admin_users WHERE username=? AND id<>?");
  $dup->execute([$username, $id]);
  if ((int)$dup->fetchColumn() > 0) json_error('That username is already taken.', 409, 'duplicate');
  $pdo->prepare("UPDATE admin_users SET username=?, display_name=?, email=? WHERE id=?")->execute([$username, $display, $email, $id]);
  json_out(['ok' => true, 'profile' => profile_row($pdo, $id)]);
}

if ($op === 'change_password') {
  if (!login_throttle_check()) json_error('Too many attempts. Please wait a minute and try again.', 429, 'throttled');
  $cur = (string)($body['current'] ?? '');
  $new = (string)($body['new'] ?? '');
  $st = $pdo->prepare("SELECT password_hash FROM admin_users WHERE id=?");
  $st->execute([$id]);
  if (!password_verify($cur, (string)$st->fetchColumn())) {
    login_throttle_hit();
    json_error('Current password is incorrect.', 403, 'bad_password');
  }
  if (strlen($new) < 8) json_error('New password must be at least 8 characters.');
  if ($new === $cur) json_error('Choose a password different from the current one.');
  login_throttle_reset();
  $pdo->prepare("UPDATE admin_users SET password_hash=? WHERE id=?")->execute([password_hash($new, PASSWORD_DEFAULT), $id]);
  session_regenerate_id(true);                     // fresh session id after a credential change
  json_out(['ok' => true]);
}

json_error('Unknown operation.');
