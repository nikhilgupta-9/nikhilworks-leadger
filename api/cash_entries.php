<?php
/** Monthly business income/expense entries, independent of project payments. */
require_once __DIR__ . '/../includes/session.php';
require_once __DIR__ . '/../includes/helpers.php';
require_login_api();
$pdo = db();

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
  $month = str_field($_GET, 'month');
  $sql = 'SELECT ce.*, c.name AS client_name FROM cash_entries ce LEFT JOIN clients c ON c.id=ce.client_id';
  $params = [];
  if ($month !== '') { $sql .= ' WHERE ce.month=?'; $params[] = $month; }
  $sql .= ' ORDER BY ce.entry_date DESC, ce.id DESC';
  $stmt = $pdo->prepare($sql);
  $stmt->execute($params);
  $rows = $stmt->fetchAll();
  foreach ($rows as &$row) { $row['id'] = (int)$row['id']; $row['client_id'] = $row['client_id'] !== null ? (int)$row['client_id'] : null; $row['amount'] = (float)$row['amount']; }
  json_out(['entries' => $rows]);
}

if ($method === 'POST') {
  require_csrf_api();
  $body = json_body();
  $op = str_field($body, 'op');

  if ($op === 'create') {
    $type = str_field($body, 'entry_type');
    $clientId = int_field($body, 'client_id') ?: null;
    $title = str_field($body, 'title');
    $category = str_field($body, 'category');
    $amount = num_field($body, 'amount');
    $date = str_field($body, 'entry_date');
    $planStatus = str_field($body, 'plan_status', 'planned');
    $note = str_field($body, 'note');
    if (!in_array($type, ['income', 'expense'], true)) json_error('Choose income or expense.');
    if ($title === '' || $amount <= 0 || $date === '') json_error('Title, amount and date are required.');
    if (!in_array($planStatus, ['planned', 'unplanned'], true)) $planStatus = 'planned';
    if ($clientId) {
      $check = $pdo->prepare('SELECT id FROM clients WHERE id=?');
      $check->execute([$clientId]);
      if (!$check->fetch()) json_error('Client not found.', 404);
    }
    $month = substr($date, 0, 7);
    if (!preg_match('/^\\d{4}-\\d{2}$/', $month)) json_error('Enter a valid date.');
    $stmt = $pdo->prepare('INSERT INTO cash_entries (client_id, entry_type, title, category, amount, entry_date, month, plan_status, note) VALUES (?,?,?,?,?,?,?,?,?)');
    $stmt->execute([$clientId, $type, $title, $category, $amount, $date, $month, $planStatus, $note]);
    json_out(['id' => (int)$pdo->lastInsertId()], 201);
  }

  if ($op === 'delete') {
    $id = int_field($body, 'id');
    if (!$id) json_error('Missing entry id.');
    $pdo->prepare('DELETE FROM cash_entries WHERE id=?')->execute([$id]);
    json_out(['ok' => true]);
  }

  json_error('Unknown operation.');
}

json_error('Method not allowed', 405, 'method_not_allowed');
