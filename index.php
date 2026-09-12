<?php
require_once __DIR__ . '/includes/session.php';
require_login_page();
$pdo = db();
$stmt = $pdo->prepare('SELECT username FROM admin_users WHERE id=?');
$stmt->execute([current_admin_id()]);
$admin = $stmt->fetch();
$username = $admin ? $admin['username'] : '';
?>
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>NikhilWorks Ledger</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Figtree:ital,wght@0,400;0,500;0,600;0,700;0,800;1,500&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="assets/style.css">
<link rel="icon" href="assets/img/logo-icon.png">
</head>
<body>
<?php include __DIR__ . '/partials/app-shell.html'; ?>
<script>window.__CSRF__ = <?= json_encode(csrf_token()) ?>; window.__ADMIN_USER__ = <?= json_encode($username) ?>;</script>
<script src="assets/app.js"></script>
</body>
</html>
