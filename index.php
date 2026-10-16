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
<meta name="color-scheme" content="light">
<link rel="stylesheet" href="assets/style.css?v=<?= filemtime(__DIR__ . '/assets/style.css') ?>">
<link rel="icon" href="assets/img/logo-icon.png">
<link rel="manifest" href="manifest.webmanifest">
<meta name="theme-color" content="#0a2828">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="NW Ledger">
<meta name="apple-mobile-web-app-status-bar-style" content="black">
<link rel="apple-touch-icon" href="assets/img/apple-touch-icon.png">

</head>
<body>
<?php include __DIR__ . '/partials/app-shell.html'; ?>
<script>window.__CSRF__ = <?= json_encode(csrf_token()) ?>; window.__ADMIN_USER__ = <?= json_encode($username) ?>;</script>
<script>if("serviceWorker" in navigator){ window.addEventListener("load", function(){ navigator.serviceWorker.register("sw.js").catch(function(){}); }); }</script>
<script src="assets/app.js?v=<?= filemtime(__DIR__ . '/assets/app.js') ?>"></script>
</body>
</html>
