<?php
/**
 * Payments YOU have made to an outsourced vendor for a project (advance +
 * further installments). Independent of what the client owes/has paid you.
 */
require_once __DIR__ . '/../includes/session.php';
require_once __DIR__ . '/../includes/helpers.php';
require_login_api();
$pdo = db();

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
  $projectId = int_field($_GET, 'project_id');
  if ($projectId) {
    $stmt = $pdo->prepare("SELECT * FROM vendor_payments WHERE project_id=? ORDER BY payment_date DESC, id DESC");
    $stmt->execute([$projectId]);
  } else {
    $stmt = $pdo->query("SELECT * FROM vendor_payments ORDER BY payment_date DESC, id DESC");
  }
  $rows = $stmt->fetchAll();
  foreach ($rows as &$r) { $r['id'] = (int)$r['id']; $r['project_id'] = (int)$r['project_id']; $r['amount'] = (float)$r['amount']; }
  json_out(['vendor_payments' => $rows]);
}

if ($method === 'POST') {
  require_csrf_api();
  $body = json_body();
  $op = str_field($body, 'op');

  if ($op === 'create') {
    $projectId = int_field($body, 'project_id');
    $amount = num_field($body, 'amount');
    $date = str_field($body, 'date');
    $mode = str_field($body, 'mode', 'Bank Transfer');
    $note = str_field($body, 'note');
    if (!$projectId || $amount <= 0 || $date === '') json_error('Project, amount and date are required.');

    $chk = $pdo->prepare("SELECT id FROM projects WHERE id=?");
    $chk->execute([$projectId]);
    if (!$chk->fetch()) json_error('Project not found.', 404);

    $stmt = $pdo->prepare("INSERT INTO vendor_payments (project_id, amount, payment_date, mode, note) VALUES (?,?,?,?,?)");
    $stmt->execute([$projectId, $amount, $date, $mode, $note]);
    json_out(['id' => (int)$pdo->lastInsertId()], 201);
  }

  if ($op === 'delete') {
    $id = int_field($body, 'id');
    if (!$id) json_error('Missing vendor payment id.');
    $stmt = $pdo->prepare("DELETE FROM vendor_payments WHERE id=?");
    $stmt->execute([$id]);
    json_out(['ok' => true]);
  }

  json_error('Unknown operation.');
}

json_error('Method not allowed', 405, 'method_not_allowed');
