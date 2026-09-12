<?php
require_once __DIR__ . '/includes/session.php';
logout_admin();
header('Location: /login.php');
exit;
