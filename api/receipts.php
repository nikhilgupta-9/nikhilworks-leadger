<?php
/**
 * Payment receipts — a plain acknowledgement of money received, safe to
 * share with a client. There is intentionally no GST anywhere in this
 * resource: no rate, no CGST/SGST/IGST, no SAC code, no GSTIN.
 *
 *   GET                       list every receipt
 *   POST op=create            make a receipt (standalone, or from a payment)
 *   POST op=delete            remove a receipt
 *
 * Creating with `payment_id` builds the receipt from that recorded project
 * payment (amount, date and mode are taken from the payment itself) and is
 * idempotent: asking again for the same payment returns the receipt that
 * already exists instead of burning another number.
 */
require_once __DIR__ . '/../includes/session.php';
require_once __DIR__ . '/../includes/helpers.php';
require_login_api();
$pdo = db();

$method = $_SERVER['REQUEST_METHOD'];

// If the code was deployed before migrations/v5_to_v6.sql was imported, say so
// plainly (the app shows this message) instead of failing with a raw 500.
try {
  $pdo->query("SELECT 1 FROM receipts LIMIT 0");
  $pdo->query("SELECT receipt_prefix, receipt_counter FROM settings LIMIT 0");
} catch (PDOException $e) {
  json_error('Receipts are not set up in this database yet. In phpMyAdmin, import migrations/v5_to_v6.sql into your ledger database, then reload.', 503, 'receipts_not_migrated');
}

function clip($s, $max) { return function_exists('mb_substr') ? mb_substr($s, 0, $max) : substr($s, 0, $max); }

if ($method === 'GET') {
  $rows = $pdo->query("SELECT * FROM receipts ORDER BY receipt_date DESC, id DESC")->fetchAll();
  foreach ($rows as &$r) {
    $r['id'] = (int)$r['id'];
    $r['client_id'] = (int)$r['client_id'];
    $r['project_id'] = $r['project_id'] !== null ? (int)$r['project_id'] : null;
    $r['payment_id'] = $r['payment_id'] !== null ? (int)$r['payment_id'] : null;
    $r['amount'] = (float)$r['amount'];
  }
  json_out(['receipts' => $rows]);
}

if ($method === 'POST') {
  require_csrf_api();
  $body = json_body();
  $op = str_field($body, 'op');

  if ($op === 'delete') {
    $id = int_field($body, 'id');
    if (!$id) json_error('Missing receipt id.');
    $pdo->prepare("DELETE FROM receipts WHERE id=?")->execute([$id]);
    json_out(['ok' => true]);
  }

  if ($op !== 'create') json_error('Unknown operation.');

  $paymentId = int_field($body, 'payment_id') ?: null;
  $clientId = int_field($body, 'client_id');
  $projectId = int_field($body, 'project_id') ?: null;
  $amount = num_field($body, 'amount');
  $date = str_field($body, 'date');
  $mode = str_field($body, 'mode', 'Bank Transfer');
  $reference = str_field($body, 'reference');
  $description = str_field($body, 'description');
  $notes = str_field($body, 'notes');

  if ($paymentId) {
    // Receipt for an already-recorded payment: the payment is the source of
    // truth for who/what/how much, so nothing the browser sends can disagree
    // with the ledger.
    $existing = $pdo->prepare("SELECT id, number FROM receipts WHERE payment_id=?");
    $existing->execute([$paymentId]);
    if ($row = $existing->fetch()) {
      json_out(['id' => (int)$row['id'], 'number' => $row['number'], 'existing' => true]);
    }
    $st = $pdo->prepare("SELECT p.*, pr.title AS project_title FROM payments p JOIN projects pr ON pr.id = p.project_id WHERE p.id=?");
    $st->execute([$paymentId]);
    $pay = $st->fetch();
    if (!$pay) json_error('Payment not found.', 404);
    $clientId = (int)$pay['client_id'];
    $projectId = (int)$pay['project_id'];
    $amount = (float)$pay['amount'];
    $date = $pay['payment_date'];
    $mode = $pay['mode'] !== '' ? $pay['mode'] : 'Bank Transfer';
    if ($description === '') {
      $description = 'Payment towards ' . $pay['project_title'];
      if (!empty($pay['month']) && preg_match('/^\d{4}-\d{2}$/', $pay['month'])) {
        $description .= ' (' . date('M Y', strtotime($pay['month'] . '-01')) . ')';
      }
    }
  }

  if (!$clientId) json_error('Pick a client first.');
  if ($amount <= 0) json_error('Enter the amount received.');
  if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) $date = date('Y-m-d');

  $stmt = $pdo->prepare("SELECT name FROM clients WHERE id=?");
  $stmt->execute([$clientId]);
  $client = $stmt->fetch();
  if (!$client) json_error('Client not found.', 404);

  $projectTitle = '';
  if ($projectId) {
    $stmt = $pdo->prepare("SELECT title FROM projects WHERE id=? AND client_id=?");
    $stmt->execute([$projectId, $clientId]);
    $project = $stmt->fetch();
    if (!$project) json_error('Project not found for this client.', 404);
    $projectTitle = $project['title'];
  }
  if ($description === '') {
    $description = $projectTitle !== '' ? 'Payment towards ' . $projectTitle : 'Payment received';
  }

  $mode = clip($mode, 40);
  $reference = clip($reference, 120);
  $description = clip($description, 255);

  // Allocate the receipt number atomically (the settings row is locked until
  // commit), so two receipts created at the same moment can never collide.
  $pdo->beginTransaction();
  try {
    $row = $pdo->query("SELECT receipt_prefix, receipt_counter FROM settings WHERE id=1 FOR UPDATE")->fetch();
    if (!$row) throw new Exception('Settings row missing — re-import schema.sql.');
    $number = $row['receipt_prefix'] . '/' . date('Y') . '/' . str_pad((string)$row['receipt_counter'], 3, '0', STR_PAD_LEFT);
    $pdo->prepare("UPDATE settings SET receipt_counter = receipt_counter + 1 WHERE id=1")->execute();

    $ins = $pdo->prepare("INSERT INTO receipts
      (client_id, project_id, payment_id, client_name, project_title, number, receipt_date, amount, mode, reference, description, notes)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)");
    $ins->execute([$clientId, $projectId, $paymentId, $client['name'], $projectTitle, $number, $date, $amount, $mode, $reference, $description, $notes]);
    $newId = (int)$pdo->lastInsertId();
    $pdo->commit();
  } catch (Exception $e) {
    $pdo->rollBack();
    if ($paymentId) {
      // Lost a race with another request creating the receipt for this payment.
      $again = $pdo->prepare("SELECT id, number FROM receipts WHERE payment_id=?");
      $again->execute([$paymentId]);
      if ($row = $again->fetch()) json_out(['id' => (int)$row['id'], 'number' => $row['number'], 'existing' => true]);
    }
    json_error('Could not create receipt: ' . $e->getMessage(), 500);
  }

  json_out(['id' => $newId, 'number' => $number], 201);
}

json_error('Method not allowed', 405, 'method_not_allowed');
