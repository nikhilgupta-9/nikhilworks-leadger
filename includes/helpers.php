<?php
/** Small shared helpers for the JSON API endpoints. */

function json_out($data, $code = 200) {
  http_response_code($code);
  header('Content-Type: application/json; charset=utf-8');
  echo json_encode($data);
  exit;
}

function json_error($message, $code = 400, $errCode = 'error') {
  json_out(['error' => $errCode, 'message' => $message], $code);
}

/** Reads and JSON-decodes the request body; empty array if missing/invalid. */
function json_body() {
  $raw = file_get_contents('php://input');
  if (!$raw) return [];
  $data = json_decode($raw, true);
  return is_array($data) ? $data : [];
}

function require_method($method) {
  if ($_SERVER['REQUEST_METHOD'] !== $method) {
    json_error('Method not allowed', 405, 'method_not_allowed');
  }
}

function str_field($arr, $key, $default = '') {
  return isset($arr[$key]) ? trim((string)$arr[$key]) : $default;
}
function num_field($arr, $key, $default = 0) {
  return isset($arr[$key]) && is_numeric($arr[$key]) ? (float)$arr[$key] : $default;
}
function int_field($arr, $key, $default = 0) {
  return isset($arr[$key]) && is_numeric($arr[$key]) ? (int)$arr[$key] : $default;
}
