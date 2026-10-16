<?php
/**
 * Biometric login (WebAuthn passkeys).
 *
 *   Public (used by the login page):
 *     POST op=login_options   -> challenge for the browser's fingerprint/face prompt
 *     POST op=login_verify    -> checks the signed answer and starts the session
 *   Logged-in (used by Settings):
 *     GET                     -> list this account's registered devices
 *     POST op=register_options / register_verify / delete
 */
require_once __DIR__ . '/../includes/session.php';
require_once __DIR__ . '/../includes/helpers.php';
require_once __DIR__ . '/../includes/webauthn.php';
$pdo = db();
$method = $_SERVER['REQUEST_METHOD'];

try {
  $pdo->query("SELECT 1 FROM passkeys LIMIT 0");
} catch (PDOException $e) {
  json_error('Biometric login is not set up in this database yet. In phpMyAdmin, import migrations/v6_to_v7.sql, then reload.', 503, 'passkeys_not_migrated');
}

if ($method === 'GET') {
  require_login_api();
  $st = $pdo->prepare("SELECT id, label, created_at, last_used_at FROM passkeys WHERE admin_id=? ORDER BY id");
  $st->execute([current_admin_id()]);
  json_out(['passkeys' => $st->fetchAll()]);
}
if ($method !== 'POST') json_error('Method not allowed', 405, 'method_not_allowed');

$body = json_body();
$op = str_field($body, 'op');

/* ---------- public: login ---------- */
if ($op === 'login_options') {
  json_out(['publicKey' => [
    'challenge' => wa_new_challenge('login'),
    'rpId' => wa_rp_id(),
    'timeout' => 60000,
    'userVerification' => 'required',
    'allowCredentials' => [],          // discoverable: the device offers the saved login itself
  ]]);
}

if ($op === 'login_verify') {
  if (!login_throttle_check()) json_error('Too many attempts. Please wait a minute and try again.', 429, 'throttled');
  $cred = is_array($body['credential'] ?? null) ? $body['credential'] : [];
  $resp = is_array($cred['response'] ?? null) ? $cred['response'] : [];
  $id = (string)($cred['id'] ?? '');
  $challenge = wa_take_challenge('login');
  try {
    $st = $pdo->prepare("SELECT * FROM passkeys WHERE credential_id=?");
    $st->execute([$id]);
    $row = $st->fetch();
    if (!$row) throw new Exception('This device is not registered for biometric login.');
    $count = wa_verify_assertion($resp, $challenge, $row);
    $pdo->prepare("UPDATE passkeys SET sign_count=?, last_used_at=NOW() WHERE id=?")->execute([$count, $row['id']]);
  } catch (Exception $e) {
    login_throttle_hit();
    json_error($e->getMessage(), 401, 'passkey_failed');
  }
  login_throttle_reset();
  login_admin((int)$row['admin_id']);
  $pdo->prepare('UPDATE admin_users SET last_login_at = NOW() WHERE id = ?')->execute([$row['admin_id']]);
  json_out(['ok' => true, 'redirect' => 'index.php']);
}

/* ---------- logged-in: manage devices ---------- */
require_login_api();
require_csrf_api();
$adminId = current_admin_id();

if ($op === 'register_options') {
  $u = $pdo->prepare("SELECT username FROM admin_users WHERE id=?");
  $u->execute([$adminId]);
  $username = (string)$u->fetchColumn();
  $ex = $pdo->prepare("SELECT credential_id FROM passkeys WHERE admin_id=?");
  $ex->execute([$adminId]);
  $exclude = array_map(function ($r) { return ['type' => 'public-key', 'id' => $r['credential_id']]; }, $ex->fetchAll());
  json_out(['publicKey' => [
    'challenge' => wa_new_challenge('register'),
    'rp' => ['name' => APP_NAME, 'id' => wa_rp_id()],
    'user' => ['id' => wa_b64u_enc('nwadmin-' . $adminId), 'name' => $username, 'displayName' => $username],
    'pubKeyCredParams' => [['type' => 'public-key', 'alg' => -7], ['type' => 'public-key', 'alg' => -257]],
    'timeout' => 60000,
    'attestation' => 'none',
    'excludeCredentials' => $exclude,
    'authenticatorSelection' => ['residentKey' => 'required', 'requireResidentKey' => true, 'userVerification' => 'required'],
  ]]);
}

if ($op === 'register_verify') {
  $cred = is_array($body['credential'] ?? null) ? $body['credential'] : [];
  $resp = is_array($cred['response'] ?? null) ? $cred['response'] : [];
  $label = substr(str_field($body, 'label'), 0, 100);
  if ($label === '') $label = 'My device';
  try {
    list($credId, $pem, $alg, $count) = wa_verify_registration($resp, wa_take_challenge('register'));
    $pdo->prepare("INSERT INTO passkeys (admin_id, credential_id, public_key, alg, sign_count, label) VALUES (?,?,?,?,?,?)")
        ->execute([$adminId, $credId, $pem, $alg, $count, $label]);
  } catch (PDOException $e) {
    json_error('This device is already registered.', 409, 'duplicate');
  } catch (Exception $e) {
    json_error($e->getMessage(), 400, 'passkey_failed');
  }
  json_out(['ok' => true], 201);
}

if ($op === 'delete') {
  $id = int_field($body, 'id');
  $pdo->prepare("DELETE FROM passkeys WHERE id=? AND admin_id=?")->execute([$id, $adminId]);
  json_out(['ok' => true]);
}

json_error('Unknown operation.');
