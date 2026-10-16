<?php
/**
 * Minimal WebAuthn (passkey / biometric) support — no Composer needed.
 * Handles the two things this app needs: registering a device credential and
 * verifying a login assertion. Supports ES256 (-7) and RS256 (-257), which
 * covers Android, iOS/macOS and Windows Hello.
 */

function wa_b64u_enc($bin) { return rtrim(strtr(base64_encode($bin), '+/', '-_'), '='); }
function wa_b64u_dec($s) {
  $s = strtr((string)$s, '-_', '+/');
  $pad = strlen($s) % 4;
  if ($pad) $s .= str_repeat('=', 4 - $pad);
  $out = base64_decode($s, true);
  return $out === false ? '' : $out;
}

/** The relying-party id is the site's host name (no port). */
function wa_rp_id() {
  $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
  return strtolower(preg_replace('/:\d+$/', '', $host));
}
function wa_expected_origin() {
  $host = strtolower($_SERVER['HTTP_HOST'] ?? 'localhost');
  $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
  return ($https ? 'https://' : 'http://') . $host;
}

/** Store a fresh single-use challenge for the given purpose. */
function wa_new_challenge($purpose) {
  $c = random_bytes(32);
  $_SESSION['wa_chal'][$purpose] = ['v' => wa_b64u_enc($c), 't' => time()];
  return wa_b64u_enc($c);
}
function wa_take_challenge($purpose) {
  $row = $_SESSION['wa_chal'][$purpose] ?? null;
  unset($_SESSION['wa_chal'][$purpose]);
  if (!$row || (time() - $row['t']) > 300) return null;
  return $row['v'];
}

/* ---------------- CBOR (only what WebAuthn uses) ---------------- */
function wa_cbor_decode($data, &$o = 0) {
  if ($o >= strlen($data)) throw new Exception('CBOR: truncated');
  $b = ord($data[$o++]);
  $major = $b >> 5; $info = $b & 31;
  if ($info < 24) $len = $info;
  elseif ($info === 24) { $len = ord($data[$o]); $o += 1; }
  elseif ($info === 25) { $len = unpack('n', substr($data, $o, 2))[1]; $o += 2; }
  elseif ($info === 26) { $len = unpack('N', substr($data, $o, 4))[1]; $o += 4; }
  elseif ($info === 27) { $len = unpack('J', substr($data, $o, 8))[1]; $o += 8; }
  else throw new Exception('CBOR: unsupported length');
  switch ($major) {
    case 0: return $len;
    case 1: return -1 - $len;
    case 2: case 3:
      if ($o + $len > strlen($data)) throw new Exception('CBOR: truncated string');
      $s = substr($data, $o, $len); $o += $len; return $s;
    case 4:
      $a = []; for ($i = 0; $i < $len; $i++) $a[] = wa_cbor_decode($data, $o); return $a;
    case 5:
      $m = []; for ($i = 0; $i < $len; $i++) { $k = wa_cbor_decode($data, $o); $m[$k] = wa_cbor_decode($data, $o); } return $m;
    case 6: return wa_cbor_decode($data, $o);
    case 7: return $info === 20 ? false : ($info === 21 ? true : null);
  }
  throw new Exception('CBOR: unsupported type');
}

/* ---------------- COSE key -> PEM ---------------- */
function wa_der_len($n) {
  if ($n < 128) return chr($n);
  $b = ltrim(pack('N', $n), "\0");
  return chr(0x80 | strlen($b)) . $b;
}
function wa_der($tag, $content) { return chr($tag) . wa_der_len(strlen($content)) . $content; }
function wa_der_int($bin) {
  $bin = ltrim($bin, "\0");
  if ($bin === '' || (ord($bin[0]) & 0x80)) $bin = "\0" . $bin;
  return wa_der(0x02, $bin);
}
function wa_pem($der) {
  return "-----BEGIN PUBLIC KEY-----\n" . chunk_split(base64_encode($der), 64, "\n") . "-----END PUBLIC KEY-----\n";
}
/** Returns [pem, alg] for a COSE_Key map, or throws. */
function wa_cose_to_pem($k) {
  $kty = $k[1] ?? null; $alg = $k[3] ?? null;
  if ($kty === 2 && $alg === -7 && ($k[-1] ?? null) === 1) {                 // EC2 / P-256 / ES256
    $x = $k[-2] ?? ''; $y = $k[-3] ?? '';
    if (strlen($x) !== 32 || strlen($y) !== 32) throw new Exception('Bad EC key');
    $spki = hex2bin('3059301306072a8648ce3d020106082a8648ce3d030107034200') . "\x04" . $x . $y;
    return [wa_pem($spki), -7];
  }
  if ($kty === 3 && $alg === -257) {                                          // RSA / RS256
    $n = $k[-1] ?? ''; $e = $k[-2] ?? '';
    if ($n === '' || $e === '') throw new Exception('Bad RSA key');
    $rsaKey = wa_der(0x30, wa_der_int($n) . wa_der_int($e));
    $algId = wa_der(0x30, hex2bin('06092a864886f70d010101') . "\x05\x00");
    return [wa_pem(wa_der(0x30, $algId . wa_der(0x03, "\x00" . $rsaKey))), -257];
  }
  throw new Exception('Unsupported key type (need ES256 or RS256).');
}

/* ---------------- Shared checks ---------------- */
function wa_check_client_data($json, $type, $challenge) {
  $cd = json_decode($json, true);
  if (!is_array($cd)) throw new Exception('Bad clientDataJSON');
  if (($cd['type'] ?? '') !== $type) throw new Exception('Wrong ceremony type');
  if (!$challenge || !hash_equals($challenge, (string)($cd['challenge'] ?? ''))) throw new Exception('Challenge expired — try again');
  if (($cd['origin'] ?? '') !== wa_expected_origin()) throw new Exception('Origin mismatch');
}
/** Parses the fixed part of authenticatorData and checks rpIdHash, UP and UV. */
function wa_parse_auth_data($auth) {
  if (strlen($auth) < 37) throw new Exception('Bad authenticatorData');
  if (!hash_equals(hash('sha256', wa_rp_id(), true), substr($auth, 0, 32))) throw new Exception('Wrong site (rpId)');
  $flags = ord($auth[32]);
  if (!($flags & 0x01)) throw new Exception('User presence missing');
  if (!($flags & 0x04)) throw new Exception('Biometric/PIN verification missing');
  return ['flags' => $flags, 'count' => unpack('N', substr($auth, 33, 4))[1]];
}

/** Verifies a registration response. Returns [credentialId(b64u), pem, alg, signCount]. */
function wa_verify_registration($resp, $challenge) {
  wa_check_client_data(wa_b64u_dec($resp['clientDataJSON'] ?? ''), 'webauthn.create', $challenge);
  $att = wa_cbor_decode(wa_b64u_dec($resp['attestationObject'] ?? ''));
  $auth = $att['authData'] ?? '';
  $p = wa_parse_auth_data($auth);
  if (!($p['flags'] & 0x40)) throw new Exception('No credential data');
  $o = 37 + 16;                                                  // skip rpIdHash/flags/counter + AAGUID
  $idLen = unpack('n', substr($auth, $o, 2))[1]; $o += 2;
  if ($idLen < 16 || $idLen > 255) throw new Exception('Unsupported credential id');
  $credId = substr($auth, $o, $idLen); $o += $idLen;
  $cose = wa_cbor_decode($auth, $o);
  list($pem, $alg) = wa_cose_to_pem($cose);
  return [wa_b64u_enc($credId), $pem, $alg, $p['count']];
}

/** Verifies a login assertion against a stored credential row. Returns the new sign count. */
function wa_verify_assertion($resp, $challenge, $row) {
  $cdj = wa_b64u_dec($resp['clientDataJSON'] ?? '');
  wa_check_client_data($cdj, 'webauthn.get', $challenge);
  $auth = wa_b64u_dec($resp['authenticatorData'] ?? '');
  $p = wa_parse_auth_data($auth);
  $sig = wa_b64u_dec($resp['signature'] ?? '');
  $ok = openssl_verify($auth . hash('sha256', $cdj, true), $sig, $row['public_key'], OPENSSL_ALGO_SHA256);
  if ($ok !== 1) throw new Exception('Signature check failed');
  $old = (int)$row['sign_count'];
  if (($p['count'] !== 0 || $old !== 0) && $p['count'] <= $old) throw new Exception('Possible cloned credential');
  return $p['count'];
}
