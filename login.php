<?php
require_once __DIR__ . '/includes/session.php';

if (is_logged_in()) {
  header('Location: /index.php');
  exit;
}

// If no admin exists yet, send them to the one-time setup page.
$pdo = db();
try {
  $adminCount = (int)$pdo->query('SELECT COUNT(*) FROM admin_users')->fetchColumn();
  if ($adminCount === 0) {
    header('Location: /install/setup.php');
    exit;
  }
} catch (PDOException $e) {
  // table may not exist yet — guide them to import schema.sql
  $needsSchema = true;
}

$error = '';
$justCreated = isset($_GET['created']);

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
  if (!login_throttle_check()) {
    $error = 'Too many attempts. Please wait a minute and try again.';
  } else {
    $username = trim($_POST['username'] ?? '');
    $password = (string)($_POST['password'] ?? '');
    $stmt = $pdo->prepare('SELECT id, password_hash FROM admin_users WHERE username = ?');
    $stmt->execute([$username]);
    $row = $stmt->fetch();
    if ($row && password_verify($password, $row['password_hash'])) {
      login_throttle_reset();
      login_admin($row['id']);
      header('Location: /index.php');
      exit;
    } else {
      login_throttle_hit();
      $error = 'Incorrect username or password.';
    }
  }
}
?>
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Log in · NikhilWorks Ledger</title>
<link href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>
  body{font-family:"Figtree",system-ui,-apple-system,sans-serif; background:#f4f8f0; color:#0a2828; display:flex; min-height:100vh; align-items:center; justify-content:center; margin:0;}
  .box{background:#fff; border:1px solid #dde6da; border-radius:14px; padding:32px; width:100%; max-width:360px; box-shadow:0 8px 24px rgba(10,40,40,.08);}
  .brand{font-size:21px; font-weight:800; letter-spacing:-.02em; margin-bottom:2px;}
  .brand b{color:#173a05; background:#adff1c; padding:0 4px; border-radius:4px;}
  p.sub{color:#5c7370; font-size:13px; margin:0 0 22px;}
  label{display:block; font-size:12px; font-weight:700; color:#5c7370; margin:14px 0 6px;}
  input{width:100%; padding:10px 11px; border-radius:9px; border:1px solid #dde6da; font-size:14px; box-sizing:border-box;}
  button{width:100%; margin-top:22px; padding:11px; border:none; border-radius:10px; background:#104041; color:#fff; font-weight:800; font-size:14px; cursor:pointer;}
  .error{background:#faeaea; color:#c4433a; padding:10px 12px; border-radius:8px; font-size:13px; margin-top:14px;}
  .ok{background:#e5f5e6; color:#2f8f4e; padding:10px 12px; border-radius:8px; font-size:13px; margin-top:14px;}
</style>
</head>
<body>
  <div class="box">
    <div class="brand">Nikhil<b>Works</b></div>
    <p class="sub">Client &amp; Invoice Ledger</p>
    <?php if (!empty($needsSchema)): ?>
      <div class="error">Database tables not found. Import <code>schema.sql</code> into your MySQL database first.</div>
    <?php else: ?>
      <?php if ($justCreated): ?><div class="ok">Account created — log in below.</div><?php endif; ?>
      <form method="post">
        <label>Username</label>
        <input name="username" required autofocus>
        <label>Password</label>
        <input name="password" type="password" required>
        <?php if ($error): ?><div class="error"><?= htmlspecialchars($error) ?></div><?php endif; ?>
        <button type="submit">Log in</button>
      </form>
    <?php endif; ?>
  </div>
</body>
</html>
