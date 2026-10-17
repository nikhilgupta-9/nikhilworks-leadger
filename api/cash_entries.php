<?php
/**
 * Monthly business income/expense entries.
 *
 * Money coming in for a PROJECT is not stored here: choosing a project on an
 * income entry records it as that project's payment (the `payments` table), so
 * the project's received/pending, the client's totals and the Cash Flow page
 * all read from one place and nothing is counted twice. Entries without a
 * project (rent, subscriptions, general income…) live in `cash_entries`.
 */
require_once __DIR__ . '/../includes/session.php';
require_once __DIR__ . '/../includes/helpers.php';
require_login_api();
$pdo = db();

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
  $month = str_field($_GET, 'month');
  $sql = 'SELECT ce.*, c.name AS client_name, pr.title AS project_title FROM cash_entries ce LEFT JOIN clients c ON c.id=ce.client_id LEFT JOIN projects pr ON pr.id=ce.project_id';
  $params = [];
  if ($month !== '') { $sql .= ' WHERE ce.month=?'; $params[] = $month; }
  $sql .= ' ORDER BY ce.entry_date DESC, ce.id DESC';
  $stmt = $pdo->prepare($sql);
  $stmt->execute($params);
  $rows = $stmt->fetchAll();
  foreach ($rows as &$row) { $row['id'] = (int)$row['id']; $row['client_id'] = $row['client_id'] !== null ? (int)$row['client_id'] : null; $row['project_id'] = $row['project_id'] !== null ? (int)$row['project_id'] : null; $row['amount'] = (float)$row['amount']; }
  json_out(['entries' => $rows]);
}

if ($method === 'POST') {
  require_csrf_api();
  $body = json_body();
  $op = str_field($body, 'op');

  if ($op === 'create' || $op === 'update') {
    $id = int_field($body, 'id');
    $type = str_field($body, 'entry_type');
    $clientId = int_field($body, 'client_id') ?: null;
    $projectId = int_field($body, 'project_id') ?: null;
    $mode = substr(str_field($body, 'mode', 'Bank Transfer'), 0, 40) ?: 'Bank Transfer';
    $title = str_field($body, 'title');
    $category = str_field($body, 'category');
    $amount = num_field($body, 'amount');
    $date = str_field($body, 'entry_date');
    $planStatus = str_field($body, 'plan_status', 'planned');
    $note = str_field($body, 'note');
    if (!in_array($type, ['income', 'expense'], true)) json_error('Choose income or expense.');
    if ($op === 'update' && !$id) json_error('Missing entry id.');
    if ($title === '' || $amount <= 0 || $date === '') json_error('Title, amount and date are required.');
    if (!in_array($planStatus, ['planned', 'unplanned'], true)) $planStatus = 'planned';
    if ($clientId) {
      $check = $pdo->prepare('SELECT id FROM clients WHERE id=?');
      $check->execute([$clientId]);
      if (!$check->fetch()) json_error('Client not found.', 404);
    }
    $month = substr($date, 0, 7);
    if (!preg_match('/^\\d{4}-\\d{2}$/', $month)) json_error('Enter a valid date.');

    // A project pins the entry to that project's client.
    if ($projectId) {
      $pc = $pdo->prepare('SELECT client_id FROM projects WHERE id=?');
      $pc->execute([$projectId]);
      $proj = $pc->fetch();
      if (!$proj) json_error('Project not found.', 404);
      if ($clientId && (int)$proj['client_id'] !== $clientId) json_error('That project belongs to a different client.');
      $clientId = (int)$proj['client_id'];
    }

    // Income for a project  ->  becomes that project's payment (single source of truth).
    if ($type === 'income' && $projectId) {
      $payNote = $title . ($note !== '' ? ' — ' . $note : '');
      $pdo->beginTransaction();
      try {
        $pdo->prepare('INSERT INTO payments (project_id, client_id, amount, payment_date, month, mode, note) VALUES (?,?,?,?,?,?,?)')
            ->execute([$projectId, $clientId, $amount, $date, $month, $mode, substr($payNote, 0, 255)]);
        $paymentId = (int)$pdo->lastInsertId();
        if ($op === 'update') $pdo->prepare('DELETE FROM cash_entries WHERE id=?')->execute([$id]);   // it moved into the project's payments
        $pdo->commit();
      } catch (Exception $e) {
        $pdo->rollBack();
        json_error('Could not record the payment: ' . $e->getMessage(), 500);
      }
      json_out(['payment_id' => $paymentId, 'as_payment' => true, 'converted' => $op === 'update'], 201);
    }

    if ($op === 'create') {
      $stmt = $pdo->prepare('INSERT INTO cash_entries (client_id, project_id, entry_type, title, category, amount, entry_date, month, plan_status, note) VALUES (?,?,?,?,?,?,?,?,?,?)');
      $stmt->execute([$clientId, $projectId, $type, $title, $category, $amount, $date, $month, $planStatus, $note]);
      json_out(['id' => (int)$pdo->lastInsertId()], 201);
    }
    $stmt = $pdo->prepare('UPDATE cash_entries SET client_id=?, project_id=?, entry_type=?, title=?, category=?, amount=?, entry_date=?, month=?, plan_status=?, note=? WHERE id=?');
    $stmt->execute([$clientId, $projectId, $type, $title, $category, $amount, $date, $month, $planStatus, $note, $id]);
    json_out(['ok' => true]);
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
