#!/usr/bin/env node
/**
 * CI pre-check for the integration test job: parses supabase/migrations/*.sql
 * for CREATE TABLE, ALTER TABLE ADD COLUMN, and CREATE FUNCTION statements,
 * then confirms every table/column those statements introduce is actually
 * reachable on BOTH the production and test Supabase projects before the
 * integration suite is allowed to run against the test project.
 *
 * Why this exists: nothing keeps the test project's schema in sync with
 * production automatically (see CONVENTIONS.md, "Test project schema can
 * drift from production") — a migration applied to one and forgotten on the
 * other would let the integration suite pass/fail against a schema the app
 * doesn't actually run against. This catches that before tests run.
 *
 * Deliberately uses only the anon/publishable keys already available (no
 * service-role key, no DB password, no new CI secrets) — see the "Coverage
 * gap" section this script prints at the end. Table/column existence is
 * checked via a `select <col>&limit=0` REST call and reading the specific
 * PostgREST error code (PGRST205 = table missing, 42703 = column missing) —
 * this works even when RLS blocks the anon role from reading actual rows,
 * since a permission-driven empty result is a *different* response than a
 * schema-cache miss. CREATE FUNCTION statements CANNOT be verified this way:
 * PostgREST's schema-introspection endpoint (which used to allow checking
 * whether an RPC exists without calling it) now requires a secret/service-role
 * key on this Supabase version, and functions are deliberately never invoked
 * here (some, like dev_confirm_user_email, mutate auth.users — calling a
 * function just to check it exists would be a real, unwanted side effect on
 * production). Functions are reported as an explicit, named coverage gap
 * instead of silently skipped or falsely assumed to pass.
 */

const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'supabase', 'migrations');

const CONSTRAINT_KEYWORDS = new Set([
  'constraint',
  'unique',
  'primary',
  'check',
  'foreign',
  'references',
  'exclude',
]);

function parseMigrationFile(filePath) {
  const sql = fs.readFileSync(filePath, 'utf8');
  const file = path.basename(filePath);

  const tables = []; // { name, columns: string[] }
  const alteredColumns = []; // { table, columns: string[] }
  const functions = []; // string[]

  // CREATE TABLE name ( ...body... );
  const createTableRe = /create table\s+(\w+)\s*\(([\s\S]*?)\n\);/gi;
  let m;
  while ((m = createTableRe.exec(sql))) {
    const [, tableName, body] = m;
    const columns = [];
    for (const rawLine of body.split('\n')) {
      const line = rawLine.trim().replace(/,\s*$/, '');
      if (!line) continue;
      const firstToken = line.split(/\s+/)[0].toLowerCase();
      if (CONSTRAINT_KEYWORDS.has(firstToken)) continue;
      columns.push(firstToken);
    }
    tables.push({ name: tableName, columns });
  }

  // ALTER TABLE name  add column x ..., add column y ...;
  const alterTableRe = /alter table\s+(\w+)\s*([\s\S]*?);/gi;
  while ((m = alterTableRe.exec(sql))) {
    const [, tableName, body] = m;
    const addColumnRe = /add column\s+(\w+)/gi;
    const columns = [];
    let am;
    while ((am = addColumnRe.exec(body))) columns.push(am[1]);
    if (columns.length > 0) alteredColumns.push({ table: tableName, columns });
  }

  // CREATE [OR REPLACE] FUNCTION [schema.]name(
  const createFunctionRe = /create\s+(?:or replace\s+)?function\s+(?:\w+\.)?(\w+)\s*\(/gi;
  while ((m = createFunctionRe.exec(sql))) {
    functions.push(m[1]);
  }

  return { file, tables, alteredColumns, functions };
}

async function checkColumn(baseUrl, anonKey, table, column) {
  const url = `${baseUrl}/rest/v1/${table}?select=${encodeURIComponent(column)}&limit=0`;
  const res = await fetch(url, {
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
  });
  if (res.ok) return { ok: true };
  const body = await res.json().catch(() => ({}));
  if (body.code === 'PGRST205') return { ok: false, reason: 'table missing' };
  if (body.code === '42703') return { ok: false, reason: `column "${column}" missing` };
  return { ok: false, reason: body.message || `HTTP ${res.status}` };
}

async function checkTableColumns(baseUrl, anonKey, table, columns) {
  // One combined request first (cheap path); only probe column-by-column if
  // it fails, so we can report exactly which column(s) are missing.
  const combined = await checkColumn(baseUrl, anonKey, table, columns.join(','));
  if (combined.ok) return { ok: true };
  if (combined.reason === 'table missing') return { ok: false, reason: 'table missing' };

  const missing = [];
  for (const column of columns) {
    const single = await checkColumn(baseUrl, anonKey, table, column);
    if (!single.ok) missing.push(column);
  }
  return { ok: false, reason: `column(s) missing: ${missing.join(', ')}` };
}

async function main() {
  const projects = {
    production: {
      url: process.env.EXPO_PUBLIC_SUPABASE_URL,
      key: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    },
    test: {
      url: process.env.TEST_SUPABASE_URL,
      key: process.env.TEST_SUPABASE_ANON_KEY,
    },
  };

  for (const [name, cfg] of Object.entries(projects)) {
    if (!cfg.url || !cfg.key) {
      console.error(
        `Missing credentials for the ${name} project. Need EXPO_PUBLIC_SUPABASE_URL/` +
          `EXPO_PUBLIC_SUPABASE_ANON_KEY (production) and TEST_SUPABASE_URL/TEST_SUPABASE_ANON_KEY ` +
          `(test) all set — see CONVENTIONS.md's Testing section for the required CI secrets.`
      );
      process.exit(1);
    }
  }

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const parsed = files.map((f) => parseMigrationFile(path.join(MIGRATIONS_DIR, f)));

  const allFunctions = [];
  const mismatches = []; // { file, description, production: ok|reason, test: ok|reason }

  for (const migration of parsed) {
    for (const table of migration.tables) {
      const [prodResult, testResult] = await Promise.all([
        checkTableColumns(projects.production.url, projects.production.key, table.name, table.columns),
        checkTableColumns(projects.test.url, projects.test.key, table.name, table.columns),
      ]);
      if (!prodResult.ok || !testResult.ok) {
        mismatches.push({
          file: migration.file,
          description: `table "${table.name}"`,
          production: prodResult.ok ? 'OK' : prodResult.reason,
          test: testResult.ok ? 'OK' : testResult.reason,
        });
      }
    }

    for (const alter of migration.alteredColumns) {
      const [prodResult, testResult] = await Promise.all([
        checkTableColumns(projects.production.url, projects.production.key, alter.table, alter.columns),
        checkTableColumns(projects.test.url, projects.test.key, alter.table, alter.columns),
      ]);
      if (!prodResult.ok || !testResult.ok) {
        mismatches.push({
          file: migration.file,
          description: `columns added to "${alter.table}" (${alter.columns.join(', ')})`,
          production: prodResult.ok ? 'OK' : prodResult.reason,
          test: testResult.ok ? 'OK' : testResult.reason,
        });
      }
    }

    for (const fn of migration.functions) {
      allFunctions.push({ file: migration.file, name: fn });
    }
  }

  console.log(`Checked ${parsed.length} migration file(s) against production and test projects.\n`);

  if (allFunctions.length > 0) {
    console.log('Coverage gap — functions CANNOT be verified via anon key on this Supabase version');
    console.log('(schema introspection now requires a service-role key; functions are never invoked');
    console.log('here since some have side effects). Verify these manually if in doubt:');
    for (const { file, name } of allFunctions) {
      console.log(`  - ${name}() (from ${file})`);
    }
    console.log('');
  }

  if (mismatches.length > 0) {
    console.error('Schema mismatch between production and test projects — refusing to run the');
    console.error('integration suite against a schema the app doesn\'t actually run against:\n');
    for (const mm of mismatches) {
      console.error(`  [${mm.file}] ${mm.description}`);
      console.error(`    production: ${mm.production}`);
      console.error(`    test:       ${mm.test}`);
    }
    console.error('\nApply the missing migration(s) to whichever project is behind, then re-run.');
    process.exit(1);
  }

  console.log('All checkable tables/columns match on both projects.');
}

main().catch((err) => {
  console.error('check-migrations-parity.js failed:', err);
  process.exit(1);
});
