<?php
/**
 * One-time setup: creates the first (and only) admin account.
 * Refuses to run again once an admin exists — safe to leave on the
 * server, but you can delete the /install folder afterwards if you'd
 * rather not.
 */
require_once __DIR__ . '/../includes/db.php';

$pdo = db();
$existing = 0;
try {
  $existing = (int)$pdo->query('SELECT COUNT(*) FROM admin_users')->fetchColumn();
} catch (PDOException $e) {
  http_response_code(500);
  echo '<p style="font-family:sans-serif">Could not read the <code>admin_users</code> table. '
     . 'Make sure you imported <code>schema.sql</code> into your database first.</p>';
  echo '<pre>' . htmlspecialchars($e->getMessage()) . '</pre>';
  exit;
}

if ($existing > 0) {
  header('Location: /login.php');
  exit;
}

$error = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
  $username = trim($_POST['username'] ?? '');
  $password = (string)($_POST['password'] ?? '');
  $confirm  = (string)($_POST['confirm'] ?? '');
  if ($username === '' || strlen($username) < 3) {
    $error = 'Username must be at least 3 characters.';
  } elseif (strlen($password) < 8) {
    $error = 'Password must be at least 8 characters.';
  } elseif ($password !== $confirm) {
    $error = 'Passwords do not match.';
  } else {
    $stmt = $pdo->prepare('INSERT INTO admin_users (username, password_hash) VALUES (?, ?)');
    $stmt->execute([$username, password_hash($password, PASSWORD_DEFAULT)]);
    header('Location: /login.php?created=1');
    exit;
  }
}
?>
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Set up · NikhilWorks Ledger</title>
<style>
  body{font-family:"Figtree",system-ui,-apple-system,sans-serif; background:#f4f8f0; color:#0a2828; display:flex; min-height:100vh; align-items:center; justify-content:center; margin:0;}
  .box{background:#fff; border:1px solid #dde6da; border-radius:14px; padding:32px; width:100%; max-width:380px; box-shadow:0 8px 24px rgba(10,40,40,.08);}
  h1{font-size:19px; margin:0 0 4px;}
  p.sub{color:#5c7370; font-size:13px; margin:0 0 20px;}
  label{display:block; font-size:12px; font-weight:700; color:#5c7370; margin:14px 0 6px;}
  input{width:100%; padding:10px 11px; border-radius:9px; border:1px solid #dde6da; font-size:14px; box-sizing:border-box;}
  button{width:100%; margin-top:20px; padding:11px; border:none; border-radius:10px; background:#adff1c; color:#173a05; font-weight:800; font-size:14px; cursor:pointer;}
  .error{background:#faeaea; color:#c4433a; padding:10px 12px; border-radius:8px; font-size:13px; margin-top:14px;}
</style>
</head>
<body>
  <div class="box">
    <h1>Create your admin account</h1>
    <p class="sub">One-time setup for NikhilWorks Ledger. This runs only once.</p>
    <form method="post">
      <label>Username</label>
      <input name="username" required autofocus>
      <label>Password (min. 8 characters)</label>
      <input name="password" type="password" required minlength="8">
      <label>Confirm password</label>
      <input name="confirm" type="password" required minlength="8">
      <?php if ($error): ?><div class="error"><?= htmlspecialchars($error) ?></div><?php endif; ?>
      <button type="submit">Create account &amp; continue</button>
    </form>
  </div>
</body>
</html>
