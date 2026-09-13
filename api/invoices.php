<?php
require_once __DIR__ . '/../includes/session.php';
require_once __DIR__ . '/../includes/helpers.php';
require_login_api();
$pdo = db();

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
  $rows = $pdo->query("SELECT * FROM invoices ORDER BY invoice_date DESC, id DESC")->fetchAll();
  foreach ($rows as &$r) {
    $r['id'] = (int)$r['id'];
    $r['client_id'] = (int)$r['client_id'];
    $r['project_id'] = $r['project_id'] !== null ? (int)$r['project_id'] : null;
    $r['items'] = json_decode($r['items'], true) ?: [];
    $r['is_imported'] = !empty($r['is_imported']);
    foreach (['subtotal','gst_rate','cgst','sgst','igst','total','advance_percent','advance_amount','balance_amount'] as $f) $r[$f] = (float)$r[$f];
  }
  json_out(['invoices' => $rows]);
}

if ($method === 'POST') {
  require_csrf_api();
  $body = json_body();
  $op = str_field($body, 'op');

  if ($op === 'delete') {
    $id = int_field($body, 'id');
    if (!$id) json_error('Missing invoice id.');
    $stmt = $pdo->prepare("DELETE FROM invoices WHERE id=?");
    $stmt->execute([$id]);
    json_out(['ok' => true]);
  }

  if ($op !== 'create' && $op !== 'import') json_error('Unknown operation.');
  $isImport = ($op === 'import');

  $clientId = int_field($body, 'client_id');
  $projectId = int_field($body, 'project_id') ?: null;
  $type = str_field($body, 'type');
  if (!in_array($type, ['proforma','tax'], true)) json_error('Invalid invoice type.');
  $date = str_field($body, 'date') ?: date('Y-m-d');
  $dueDate = str_field($body, 'due_date') ?: null;
  $items = isset($body['items']) && is_array($body['items']) ? $body['items'] : [];
  $gstRate = num_field($body, 'gst_rate', 18);
  $advancePercent = num_field($body, 'advance_percent', 0);
  $notes = str_field($body, 'notes');

  if (!$clientId) json_error('Pick a client first.');
  $stmt = $pdo->prepare("SELECT * FROM clients WHERE id=?");
  $stmt->execute([$clientId]);
  $client = $stmt->fetch();
  if (!$client) json_error('Client not found.', 404);

  $settingsRow = $pdo->query("SELECT * FROM settings WHERE id=1")->fetch();
  if (!$settingsRow) json_error('Settings row missing — re-import schema.sql.', 500);

  $projectTitle = '';
  if ($projectId) {
    $stmt = $pdo->prepare("SELECT * FROM projects WHERE id=? AND client_id=?");
    $stmt->execute([$projectId, $clientId]);
    $project = $stmt->fetch();
    if (!$project) json_error('Project not found for this client.', 404);
    $projectTitle = $project['title'];
  }

  $cleanItems = [];
  $subtotal = 0;
  foreach ($items as $it) {
    $desc = trim((string)($it['description'] ?? ''));
    if ($desc === '') continue;
    $qty = is_numeric($it['qty'] ?? null) ? (float)$it['qty'] : 1;
    $rate = is_numeric($it['rate'] ?? null) ? (float)$it['rate'] : 0;
    $amount = $qty * $rate;
    $cleanItems[] = ['description' => $desc, 'hsn' => trim((string)($it['hsn'] ?? '')), 'qty' => $qty, 'rate' => $rate, 'amount' => $amount];
    $subtotal += $amount;
  }
  if (!count($cleanItems)) json_error('Add at least one line item.');

  $cgst = 0; $sgst = 0; $igst = 0;
  // GST is calculated on both Proforma and Tax invoices in this business —
  // a Proforma still needs to show the client the GST-inclusive total
  // they'll actually pay; "proforma vs tax" only changes the legal status
  // of the document, not whether tax is shown.
  $businessState = $settingsRow['state'] ?: 'Delhi';
  $sameState = ($client['state'] === $businessState);
  if ($sameState) {
    $cgst = round($subtotal * $gstRate / 200, 2);
    $sgst = round($subtotal * $gstRate / 200, 2);
    $total = $subtotal + $cgst + $sgst;
  } else {
    $igst = round($subtotal * $gstRate / 100, 2);
    $total = $subtotal + $igst;
  }

  $advanceAmount = 0; $balanceAmount = 0;
  if ($advancePercent > 0) {
    $advanceAmount = round($total * $advancePercent / 100, 2);
    $balanceAmount = round($total - $advanceAmount, 2);
  }

  $validTill = null;
  if ($type === 'proforma') {
    $days = (int)($settingsRow['proforma_validity_days'] ?: 7);
    $validTill = date('Y-m-d', strtotime($date . " +{$days} days"));
  }

  if ($isImport) {
    // Logging an invoice that was already issued outside the app (e.g. one
    // sent before the ledger existed, or numbered by hand). The number is
    // whatever the person actually issued — we don't touch the
    // auto-numbering counters at all, so future generated invoices keep
    // their own sequence untouched.
    $number = str_field($body, 'number');
    if ($number === '') json_error('Enter the invoice number exactly as it was issued.');

    $dup = $pdo->prepare("SELECT id FROM invoices WHERE number=?");
    $dup->execute([$number]);
    if ($dup->fetch()) json_error('An invoice with that number already exists.');

    $ins = $pdo->prepare("INSERT INTO invoices
      (client_id, project_id, client_name, project_title, type, number, invoice_date, due_date, valid_till, items, subtotal, gst_rate, cgst, sgst, igst, total, advance_percent, advance_amount, balance_amount, notes, place_of_supply, is_imported)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)");
    $ins->execute([
      $clientId, $projectId, $client['name'], $projectTitle, $type, $number, $date, $dueDate, $validTill,
      json_encode($cleanItems), $subtotal, $gstRate, $cgst, $sgst, $igst, $total, $advancePercent, $advanceAmount, $balanceAmount, $notes, $client['state']
    ]);
    json_out(['id' => (int)$pdo->lastInsertId(), 'number' => $number], 201);
  }

  // Allocate the invoice number atomically so two invoices generated at the
  // exact same moment never collide.
  $pdo->exec("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
  $pdo->beginTransaction();
  try {
    $row = $pdo->query("SELECT tax_prefix, tax_counter, proforma_prefix, proforma_counter FROM settings WHERE id=1 FOR UPDATE")->fetch();
    if (!$row) throw new Exception('Settings row missing — re-import schema.sql.');
    $year = date('Y');
    if ($type === 'tax') {
      $number = $row['tax_prefix'] . '/' . $year . '/' . str_pad((string)$row['tax_counter'], 3, '0', STR_PAD_LEFT);
      $pdo->prepare("UPDATE settings SET tax_counter = tax_counter + 1 WHERE id=1")->execute();
    } else {
      $number = $row['proforma_prefix'] . '/' . $year . '/' . str_pad((string)$row['proforma_counter'], 3, '0', STR_PAD_LEFT);
      $pdo->prepare("UPDATE settings SET proforma_counter = proforma_counter + 1 WHERE id=1")->execute();
    }

    $ins = $pdo->prepare("INSERT INTO invoices
      (client_id, project_id, client_name, project_title, type, number, invoice_date, due_date, valid_till, items, subtotal, gst_rate, cgst, sgst, igst, total, advance_percent, advance_amount, balance_amount, notes, place_of_supply)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
    $ins->execute([
      $clientId, $projectId, $client['name'], $projectTitle, $type, $number, $date, $dueDate, $validTill,
      json_encode($cleanItems), $subtotal, $gstRate, $cgst, $sgst, $igst, $total, $advancePercent, $advanceAmount, $balanceAmount, $notes, $client['state']
    ]);
    $newId = (int)$pdo->lastInsertId();
    $pdo->commit();
  } catch (Exception $e) {
    $pdo->rollBack();
    json_error('Could not generate invoice: ' . $e->getMessage(), 500);
  }

  json_out(['id' => $newId, 'number' => $number], 201);
}

json_error('Method not allowed', 405, 'method_not_allowed');
