<?php
/**
 * CRUD for projects — a client can have many of these, each with its own
 * cost, GST rate, status, and (optionally) outsourced-vendor cost tracking.
 */
require_once __DIR__ . '/../includes/session.php';
require_once __DIR__ . '/../includes/helpers.php';
require_login_api();
$pdo = db();

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
  $clientId = int_field($_GET, 'client_id');
  $sql = "SELECT p.*, c.name AS client_name,
            COALESCE(pay.paid, 0) AS paid,
            COALESCE(vpay.vendor_paid, 0) AS vendor_paid
          FROM projects p
          JOIN clients c ON c.id = p.client_id
          LEFT JOIN (SELECT project_id, SUM(amount) AS paid FROM payments GROUP BY project_id) pay ON pay.project_id = p.id
          LEFT JOIN (SELECT project_id, SUM(amount) AS vendor_paid FROM vendor_payments GROUP BY project_id) vpay ON vpay.project_id = p.id";
  $params = [];
  if ($clientId) { $sql .= " WHERE p.client_id = ?"; $params[] = $clientId; }
  $sql .= " ORDER BY p.created_at DESC";
  $stmt = $pdo->prepare($sql);
  $stmt->execute($params);
  $rows = $stmt->fetchAll();
  foreach ($rows as &$r) {
    $r['id'] = (int)$r['id'];
    $r['client_id'] = (int)$r['client_id'];
    $r['is_outsourced'] = (bool)$r['is_outsourced'];
    foreach (['total_amount','gst_rate','vendor_cost','paid','vendor_paid'] as $f) $r[$f] = (float)$r[$f];
  }
  json_out(['projects' => $rows]);
}

if ($method === 'POST') {
  require_csrf_api();
  $body = json_body();
  $op = str_field($body, 'op');

  if ($op === 'create' || $op === 'update') {
    $clientId = int_field($body, 'client_id');
    $title = str_field($body, 'title');
    if (!$clientId) json_error('Pick a client first.');
    if ($title === '') json_error('Project / service title is required.');
    $description = str_field($body, 'description');
    $totalAmount = num_field($body, 'total_amount');
    $gstRate = num_field($body, 'gst_rate', 18);
    $startDate = str_field($body, 'start_date') ?: null;
    $status = str_field($body, 'status', 'active');
    if (!in_array($status, ['active','on-hold','completed'], true)) $status = 'active';
    $isOutsourced = !empty($body['is_outsourced']) ? 1 : 0;
    $vendorName = str_field($body, 'vendor_name');
    $vendorPhone = str_field($body, 'vendor_phone');
    $vendorCost = num_field($body, 'vendor_cost');
    $vendorNotes = str_field($body, 'vendor_notes');
    $notes = str_field($body, 'notes');

    $chk = $pdo->prepare("SELECT id FROM clients WHERE id=?");
    $chk->execute([$clientId]);
    if (!$chk->fetch()) json_error('Client not found.', 404);

    if ($op === 'create') {
      $stmt = $pdo->prepare("INSERT INTO projects
        (client_id, title, description, total_amount, gst_rate, start_date, status, is_outsourced, vendor_name, vendor_phone, vendor_cost, vendor_notes, notes)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)");
      $stmt->execute([$clientId, $title, $description, $totalAmount, $gstRate, $startDate, $status, $isOutsourced, $vendorName, $vendorPhone, $vendorCost, $vendorNotes, $notes]);
      json_out(['id' => (int)$pdo->lastInsertId()], 201);
    } else {
      $id = int_field($body, 'id');
      if (!$id) json_error('Missing project id.');
      $stmt = $pdo->prepare("UPDATE projects SET client_id=?, title=?, description=?, total_amount=?, gst_rate=?, start_date=?, status=?,
        is_outsourced=?, vendor_name=?, vendor_phone=?, vendor_cost=?, vendor_notes=?, notes=? WHERE id=?");
      $stmt->execute([$clientId, $title, $description, $totalAmount, $gstRate, $startDate, $status, $isOutsourced, $vendorName, $vendorPhone, $vendorCost, $vendorNotes, $notes, $id]);
      json_out(['ok' => true]);
    }
  }

  if ($op === 'delete') {
    $id = int_field($body, 'id');
    if (!$id) json_error('Missing project id.');
    $stmt = $pdo->prepare("DELETE FROM projects WHERE id=?");
    $stmt->execute([$id]);
    json_out(['ok' => true]);
  }

  json_error('Unknown operation.');
}

json_error('Method not allowed', 405, 'method_not_allowed');
