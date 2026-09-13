<?php
require_once __DIR__ . '/../includes/session.php';
require_once __DIR__ . '/../includes/helpers.php';
require_login_api();
$pdo = db();

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
  $row = $pdo->query("SELECT * FROM settings WHERE id=1")->fetch();
  if (!$row) json_error('Settings row missing — re-import schema.sql.', 500);
  foreach (['tax_counter','proforma_counter','proforma_validity_days'] as $f) $row[$f] = (int)$row[$f];
  json_out(['settings' => $row]);
}

if ($method === 'POST') {
  require_csrf_api();
  $body = json_body();
  $fields = [
    'legal_name' => str_field($body, 'legal_name'),
    'tagline' => str_field($body, 'tagline', 'WEB DEVELOPMENT & SEO'),
    'owner_name' => str_field($body, 'owner_name'),
    'gstin' => str_field($body, 'gstin'),
    'pan' => str_field($body, 'pan'),
    'address' => str_field($body, 'address'),
    'state' => str_field($body, 'state', 'Delhi'),
    'email' => str_field($body, 'email'),
    'phone' => str_field($body, 'phone'),
    'website' => str_field($body, 'website'),
    'bank_account_name' => str_field($body, 'bank_account_name'),
    'bank_account_number' => str_field($body, 'bank_account_number'),
    'bank_ifsc' => str_field($body, 'bank_ifsc'),
    'bank_name' => str_field($body, 'bank_name'),
    'bank_branch' => str_field($body, 'bank_branch'),
    'proforma_validity_days' => int_field($body, 'proforma_validity_days', 7),
    'tax_prefix' => str_field($body, 'tax_prefix', 'NW'),
    'tax_counter' => int_field($body, 'tax_counter', 1),
    'proforma_prefix' => str_field($body, 'proforma_prefix', 'PF'),
    'proforma_counter' => int_field($body, 'proforma_counter', 1),
  ];
  // Counters only ever move forward here: a save that (accidentally or via a
  // stale form) submits a lower number than what's already stored must not
  // roll the sequence back, or the next invoice generated would collide with
  // one already issued. Deliberately jumping the sequence ahead still works
  // since GREATEST() keeps whichever value is higher.
  $stmt = $pdo->prepare("UPDATE settings SET
    legal_name=:legal_name, tagline=:tagline, owner_name=:owner_name, gstin=:gstin, pan=:pan, address=:address, state=:state,
    email=:email, phone=:phone, website=:website,
    bank_account_name=:bank_account_name, bank_account_number=:bank_account_number,
    bank_ifsc=:bank_ifsc, bank_name=:bank_name, bank_branch=:bank_branch,
    proforma_validity_days=:proforma_validity_days,
    tax_prefix=:tax_prefix, tax_counter=GREATEST(tax_counter, :tax_counter),
    proforma_prefix=:proforma_prefix, proforma_counter=GREATEST(proforma_counter, :proforma_counter)
    WHERE id=1");
  $stmt->execute($fields);
  json_out(['ok' => true]);
}

json_error('Method not allowed', 405, 'method_not_allowed');
