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
    foreach (['subtotal','gst_rate','cgst','sgst','igst','total'] as $f) $r[$f] = (float)$r[$f];
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

  if ($op !== 'create') json_error('Unknown operation.');

  $clientId = int_field($body, 'client_id');
  $projectId = int_field($body, 'project_id') ?: null;
  $type = str_field($body, 'type');
  if (!in_array($type, ['proforma','tax'], true)) json_error('Invalid invoice type.');
  $date = str_field($body, 'date') ?: date('Y-m-d');
  $dueDate = str_field($body, 'due_date') ?: null;
  $items = isset($body['items']) && is_array($body['items']) ? $body['items'] : [];
  $gstRate = num_field($body, 'gst_rate', 18);
  $notes = str_field($body, 'notes');

  if (!$clientId) json_error('Pick a client first.');
  $stmt = $pdo->prepare("SELECT * FROM clients WHERE id=?");
  $stmt->execute([$clientId]);
  $client = $stmt->fetch();
  if (!$client) json_error('Client not found.', 404);

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
    $qty = is_numeric($it['qty'] ?? null) ? (float)$it['qty'] : 0;
    $rate = is_numeric($it['rate'] ?? null) ? (float)$it['rate'] : 0;
    $amount = $qty * $rate;
    $cleanItems[] = ['description' => $desc, 'hsn' => trim((string)($it['hsn'] ?? '')), 'qty' => $qty, 'rate' => $rate, 'amount' => $amount];
    $subtotal += $amount;
  }
  if (!count($cleanItems)) json_error('Add at least one line item.');

  $cgst = 0; $sgst = 0; $igst = 0; $total = $subtotal;
  if ($type === 'tax') {
    $settingsRow = $pdo->query("SELECT state FROM settings WHERE id=1")->fetch();
    $businessState = $settingsRow ? $settingsRow['state'] : 'Delhi';
    $sameState = ($client['state'] === $businessState);
    if ($sameState) {
      $cgst = round($subtotal * $gstRate / 200, 2);
      $sgst = round($subtotal * $gstRate / 200, 2);
      $total = $subtotal + $cgst + $sgst;
    } else {
      $igst = round($subtotal * $gstRate / 100, 2);
      $total = $subtotal + $igst;
    }
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
      (client_id, project_id, client_name, project_title, type, number, invoice_date, due_date, items, subtotal, gst_rate, cgst, sgst, igst, total, notes, place_of_supply)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
    $ins->execute([
      $clientId, $projectId, $client['name'], $projectTitle, $type, $number, $date, $dueDate,
      json_encode($cleanItems), $subtotal, $gstRate, $cgst, $sgst, $igst, $total, $notes, $client['state']
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
