<?php
require_once __DIR__ . '/../includes/session.php';
require_once __DIR__ . '/../includes/helpers.php';
require_login_api();
$pdo = db();

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
  // One row per client, with project/payment totals rolled up so the
  // clients list and dashboard don't need N+1 queries.
  $sql = "SELECT c.*,
            COALESCE(pr.project_count, 0) AS project_count,
            COALESCE(pr.total_amount, 0) AS total_amount,
            COALESCE(pay.paid, 0) AS paid
          FROM clients c
          LEFT JOIN (
            SELECT client_id, COUNT(*) AS project_count, SUM(total_amount) AS total_amount
            FROM projects GROUP BY client_id
          ) pr ON pr.client_id = c.id
          LEFT JOIN (
            SELECT client_id, SUM(amount) AS paid FROM payments GROUP BY client_id
          ) pay ON pay.client_id = c.id
          ORDER BY c.created_at DESC";
  $rows = $pdo->query($sql)->fetchAll();
  foreach ($rows as &$r) {
    $r['id'] = (int)$r['id'];
    $r['project_count'] = (int)$r['project_count'];
    $r['total_amount'] = (float)$r['total_amount'];
    $r['paid'] = (float)$r['paid'];
  }
  json_out(['clients' => $rows]);
}

if ($method === 'POST') {
  require_csrf_api();
  $body = json_body();
  $op = str_field($body, 'op');

  if ($op === 'create' || $op === 'update') {
    $name = str_field($body, 'name');
    if ($name === '') json_error('Client name is required.');
    $phone = str_field($body, 'phone');
    $email = str_field($body, 'email');
    $gstin = str_field($body, 'gstin');
    $address = str_field($body, 'address');
    $state = str_field($body, 'state', 'Delhi');
    $notes = str_field($body, 'notes');

    if ($op === 'create') {
      $stmt = $pdo->prepare("INSERT INTO clients (name, phone, email, gstin, address, state, notes)
                              VALUES (?,?,?,?,?,?,?)");
      $stmt->execute([$name, $phone, $email, $gstin, $address, $state, $notes]);
      json_out(['id' => (int)$pdo->lastInsertId()], 201);
    } else {
      $id = int_field($body, 'id');
      if (!$id) json_error('Missing client id.');
      $stmt = $pdo->prepare("UPDATE clients SET name=?, phone=?, email=?, gstin=?, address=?, state=?, notes=? WHERE id=?");
      $stmt->execute([$name, $phone, $email, $gstin, $address, $state, $notes, $id]);
      json_out(['ok' => true]);
    }
  }

  if ($op === 'delete') {
    $id = int_field($body, 'id');
    if (!$id) json_error('Missing client id.');
    $stmt = $pdo->prepare("DELETE FROM clients WHERE id=?");
    $stmt->execute([$id]);
    json_out(['ok' => true]);
  }

  json_error('Unknown operation.');
}

json_error('Method not allowed', 405, 'method_not_allowed');
