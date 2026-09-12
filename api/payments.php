<?php
/**
 * Payments the CLIENT has made against a specific project. Supports many
 * rows per project over time (e.g. one per month of an ongoing retainer).
 */
require_once __DIR__ . '/../includes/session.php';
require_once __DIR__ . '/../includes/helpers.php';
require_login_api();
$pdo = db();

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
  $projectId = int_field($_GET, 'project_id');
  $clientId = int_field($_GET, 'client_id');
  $sql = "SELECT * FROM payments";
  $where = []; $params = [];
  if ($projectId) { $where[] = "project_id = ?"; $params[] = $projectId; }
  if ($clientId) { $where[] = "client_id = ?"; $params[] = $clientId; }
  if ($where) $sql .= " WHERE " . implode(' AND ', $where);
  $sql .= " ORDER BY payment_date DESC, id DESC";
  $stmt = $pdo->prepare($sql);
  $stmt->execute($params);
  $rows = $stmt->fetchAll();
  foreach ($rows as &$r) { $r['id'] = (int)$r['id']; $r['project_id'] = (int)$r['project_id']; $r['client_id'] = (int)$r['client_id']; $r['amount'] = (float)$r['amount']; }
  json_out(['payments' => $rows]);
}

if ($method === 'POST') {
  require_csrf_api();
  $body = json_body();
  $op = str_field($body, 'op');

  if ($op === 'create') {
    $projectId = int_field($body, 'project_id');
    $amount = num_field($body, 'amount');
    $date = str_field($body, 'date');
    $month = str_field($body, 'month') ?: substr($date, 0, 7);
    $mode = str_field($body, 'mode', 'Bank Transfer');
    $note = str_field($body, 'note');
    if (!$projectId || $amount <= 0 || $date === '') json_error('Project, amount and date are required.');

    $chk = $pdo->prepare("SELECT client_id FROM projects WHERE id=?");
    $chk->execute([$projectId]);
    $proj = $chk->fetch();
    if (!$proj) json_error('Project not found.', 404);

    $stmt = $pdo->prepare("INSERT INTO payments (project_id, client_id, amount, payment_date, month, mode, note) VALUES (?,?,?,?,?,?,?)");
    $stmt->execute([$projectId, $proj['client_id'], $amount, $date, $month, $mode, $note]);
    json_out(['id' => (int)$pdo->lastInsertId()], 201);
  }

  if ($op === 'delete') {
    $id = int_field($body, 'id');
    if (!$id) json_error('Missing payment id.');
    $stmt = $pdo->prepare("DELETE FROM payments WHERE id=?");
    $stmt->execute([$id]);
    json_out(['ok' => true]);
  }

  json_error('Unknown operation.');
}

json_error('Method not allowed', 405, 'method_not_allowed');
