<?php
require_once __DIR__ . '/../includes/session.php';
require_once __DIR__ . '/../includes/helpers.php';

if (!is_logged_in()) {
  json_out(['loggedIn' => false], 200);
}
json_out(['loggedIn' => true, 'csrf' => csrf_token()]);
