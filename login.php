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
      $pdo->prepare('UPDATE admin_users SET last_login_at = NOW() WHERE id = ?')->execute([$row['id']]);
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
<link rel="manifest" href="manifest.webmanifest">
<meta name="theme-color" content="#0a2828">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="NW Ledger">
<meta name="apple-mobile-web-app-status-bar-style" content="black">
<link rel="apple-touch-icon" href="assets/img/apple-touch-icon.png">
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
  .bio{background:#adff1c; color:#173a05; margin-top:10px; display:none; align-items:center; justify-content:center; gap:8px;}
  .or{display:none; align-items:center; gap:10px; color:#93ab9f; font-size:12px; margin-top:18px;}
  .or::before,.or::after{content:""; flex:1; height:1px; background:#dde6da;}
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
      <div class="or" id="bioOr">or</div>
      <button type="button" class="bio" id="bioBtn">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 11v3a6 6 0 01-1 3.3M8 14a4 4 0 118 0c0 2-.4 3.6-1.3 5M5 12a7 7 0 0114 0c0 1.5-.1 3-.5 4.5M3.5 9A9 9 0 0120.5 9"/></svg>
        Log in with fingerprint / face
      </button>
      <div class="error" id="bioErr" style="display:none"></div>
    <?php endif; ?>
  </div>
<script>
(function(){
  var btn = document.getElementById("bioBtn"), or = document.getElementById("bioOr"), err = document.getElementById("bioErr");
  if(!btn || !window.PublicKeyCredential || !navigator.credentials) return;
  btn.style.display = "flex"; or.style.display = "flex";
  function b2u(buf){ var s=""; new Uint8Array(buf).forEach(function(c){ s+=String.fromCharCode(c); }); return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,""); }
  function u2b(str){ str=str.replace(/-/g,"+").replace(/_/g,"/"); while(str.length%4) str+="="; var bin=atob(str), a=new Uint8Array(bin.length); for(var i=0;i<bin.length;i++) a[i]=bin.charCodeAt(i); return a.buffer; }
  function post(body){ return fetch("api/passkey.php",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)})
    .then(function(r){ return r.json().catch(function(){return {};}).then(function(d){ if(!r.ok) throw new Error(d.message||"Request failed"); return d; }); }); }
  function fail(m){ err.textContent = m; err.style.display = "block"; btn.disabled = false; }
  btn.addEventListener("click", function(){
    err.style.display = "none"; btn.disabled = true;
    post({op:"login_options"}).then(function(o){
      var pk = o.publicKey; pk.challenge = u2b(pk.challenge);
      return navigator.credentials.get({publicKey: pk});
    }).then(function(c){
      return post({op:"login_verify", credential:{ id:c.id, response:{
        clientDataJSON:b2u(c.response.clientDataJSON), authenticatorData:b2u(c.response.authenticatorData), signature:b2u(c.response.signature) } }});
    }).then(function(d){ location.href = d.redirect || "index.php"; })
    .catch(function(e){
      if(e && (e.name==="NotAllowedError" || e.name==="AbortError")) return fail("Cancelled. Try again, or log in with your password.");
      fail((e && e.message) || "Biometric login failed.");
    });
  });
})();
</script>
<script>if("serviceWorker" in navigator){ window.addEventListener("load", function(){ navigator.serviceWorker.register("sw.js").catch(function(){}); }); }</script>
</body>
</html>
