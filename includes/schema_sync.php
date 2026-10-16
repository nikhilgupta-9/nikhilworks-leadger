<?php
/**
 * Automatic database migration.
 *
 * schema.sql is the single source of truth. On a page load, if the file has
 * changed since the database was last synced, this brings the database in line
 * with it — ADDITIVELY ONLY:
 *   - creates tables that are missing
 *   - adds columns that are missing
 *   - adds missing indexes / unique keys / foreign keys (best effort)
 * It never drops, renames or rewrites anything, so existing data is safe.
 *
 * Cost when nothing changed: zero queries (the result is remembered in the
 * session); on a new session, one tiny SELECT.
 */

const NW_SYNC_VERSION = 1;   // bump only if this sync logic itself changes

function nw_schema_autosync() {
  $file = __DIR__ . '/../schema.sql';
  if (!is_readable($file)) return;
  $sig = md5_file($file) . ':' . NW_SYNC_VERSION;

  if (($_SESSION['nw_schema_sig'] ?? '') === $sig) return;
  if (!empty($_SESSION['nw_schema_fail']) && (time() - $_SESSION['nw_schema_fail']) < 60) return;

  $pdo = db();
  try {
    // Only one request at a time performs the sync.
    $got = (int)$pdo->query("SELECT GET_LOCK('nw_schema_sync', 15)")->fetchColumn();
    try {
      $pdo->exec("CREATE TABLE IF NOT EXISTS app_meta (k VARCHAR(60) NOT NULL PRIMARY KEY, v VARCHAR(255) NOT NULL DEFAULT '') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
      $st = $pdo->prepare("SELECT v FROM app_meta WHERE k='schema_sig'");
      $st->execute();
      if ($st->fetchColumn() !== $sig) {
        $failed = nw_schema_apply($pdo, file_get_contents($file));
        if ($failed === 0) {
          $pdo->prepare("INSERT INTO app_meta (k, v) VALUES ('schema_sig', ?) ON DUPLICATE KEY UPDATE v = VALUES(v)")->execute([$sig]);
        } else {
          $_SESSION['nw_schema_fail'] = time();     // retry in a minute, don't hammer the DB
          return;
        }
      }
    } finally {
      if ($got) $pdo->query("SELECT RELEASE_LOCK('nw_schema_sync')");
    }
    $_SESSION['nw_schema_sig'] = $sig;
    unset($_SESSION['nw_schema_fail']);
  } catch (Throwable $e) {
    error_log('[nw schema sync] ' . $e->getMessage());
    $_SESSION['nw_schema_fail'] = time();
  }
}

/** Splits SQL text into statements on ';' (ignoring ';' inside quotes) and drops -- comments. */
function nw_sql_statements($sql) {
  $out = []; $buf = ''; $q = ''; $n = strlen($sql);
  for ($i = 0; $i < $n; $i++) {
    $c = $sql[$i];
    if ($q === '' && $c === '-' && ($sql[$i + 1] ?? '') === '-') {           // line comment
      while ($i < $n && $sql[$i] !== "\n") $i++;
      continue;
    }
    if ($q !== '') { if ($c === $q) $q = ''; }
    elseif ($c === "'" || $c === '"' || $c === '`') $q = $c;
    elseif ($c === ';') { if (trim($buf) !== '') $out[] = trim($buf); $buf = ''; continue; }
    $buf .= $c;
  }
  if (trim($buf) !== '') $out[] = trim($buf);
  return $out;
}

/** Splits a CREATE TABLE body on top-level commas. */
function nw_split_top_level($body) {
  $parts = []; $buf = ''; $depth = 0; $q = '';
  for ($i = 0, $n = strlen($body); $i < $n; $i++) {
    $c = $body[$i];
    if ($q !== '') { if ($c === $q) $q = ''; }
    elseif ($c === "'" || $c === '"' || $c === '`') $q = $c;
    elseif ($c === '(') $depth++;
    elseif ($c === ')') $depth--;
    elseif ($c === ',' && $depth === 0) { $parts[] = trim($buf); $buf = ''; continue; }
    $buf .= $c;
  }
  if (trim($buf) !== '') $parts[] = trim($buf);
  return $parts;
}

/** Applies the schema. Returns the number of steps that failed (0 = fully in sync). */
function nw_schema_apply(PDO $pdo, $sql) {
  $failed = 0;
  $dbName = $pdo->query('SELECT DATABASE()')->fetchColumn();

  // A database still on the very first layout needs the one-off data conversion in
  // migrations/v1_to_v2.sql; adding columns blindly to it would only make things worse.
  $legacy = $pdo->prepare("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=? AND table_name='clients' AND column_name='service'");
  $legacy->execute([$dbName]);
  if ((int)$legacy->fetchColumn() > 0) {
    error_log('[nw schema sync] legacy v1 database: run migrations/v1_to_v2.sql by hand first.');
    return 1;
  }

  $exists = function ($sqlText, $params) use ($pdo) {
    $s = $pdo->prepare($sqlText); $s->execute($params); return (int)$s->fetchColumn() > 0;
  };

  foreach (nw_sql_statements($sql) as $stmt) {
    try {
      if (preg_match('/^\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?(\w+)`?\s*\(/i', $stmt, $m)) {
        $table = $m[1];
        $tableExists = $exists("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=? AND table_name=?", [$dbName, $table]);
        if (!$tableExists) { $pdo->exec($stmt); continue; }

        // Existing table: add whatever the definition has that the database lacks.
        $open = strpos($stmt, '('); $close = strrpos($stmt, ')');
        // the table-option tail ("ENGINE=...") follows the final ')' of the body
        $body = substr($stmt, $open + 1, $close - $open - 1);
        foreach (nw_split_top_level($body) as $item) {
          if (preg_match('/^(?:CONSTRAINT\s+`?(\w+)`?\s+)?FOREIGN\s+KEY/i', $item, $fk)) {
            $name = $fk[1] ?? '';
            if ($name === '' || $exists("SELECT COUNT(*) FROM information_schema.table_constraints WHERE table_schema=? AND table_name=? AND constraint_name=?", [$dbName, $table, $name])) continue;
            nw_try($pdo, "ALTER TABLE `$table` ADD $item", $failed, false);
          } elseif (preg_match('/^(UNIQUE\s+(?:KEY|INDEX)|UNIQUE|KEY|INDEX)\s+`?(\w+)`?\s*\(/i', $item, $ix)) {
            if ($exists("SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema=? AND table_name=? AND index_name=?", [$dbName, $table, $ix[2]])) continue;
            nw_try($pdo, "ALTER TABLE `$table` ADD $item", $failed, false);
          } elseif (preg_match('/^PRIMARY\s+KEY/i', $item)) {
            continue;
          } elseif (preg_match('/^`?(\w+)`?\s+/', $item, $col)) {
            if ($exists("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=? AND table_name=? AND column_name=?", [$dbName, $table, $col[1]])) continue;
            $def = preg_replace('/\s+(UNIQUE|PRIMARY\s+KEY)\b/i', '', $item);
            nw_try($pdo, "ALTER TABLE `$table` ADD COLUMN $def", $failed, true);
          }
        }
      } elseif (preg_match('/^\s*INSERT\s/i', $stmt)) {
        $pdo->exec($stmt);                                   // seed rows are written with ON DUPLICATE KEY, so this is a no-op once seeded
      } elseif (preg_match('/^\s*SET\s/i', $stmt)) {
        $pdo->exec($stmt);
      }
    } catch (Throwable $e) {
      error_log('[nw schema sync] ' . $e->getMessage());
      $failed++;
    }
  }
  return $failed;
}

/** Runs one ALTER. A missing column is a real failure; a missing index/FK that can't be added
 *  (e.g. old rows violate it) is only logged, so it doesn't block the app. */
function nw_try(PDO $pdo, $sql, &$failed, $critical) {
  try { $pdo->exec($sql); }
  catch (Throwable $e) {
    error_log('[nw schema sync] ' . $sql . ' -> ' . $e->getMessage());
    if ($critical) $failed++;
  }
}
