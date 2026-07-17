#!/usr/bin/env node
/**
 * Schema parity check between production and the test Supabase project.
 * Parses supabase/migrations/*.sql for CREATE TABLE, ALTER TABLE ADD COLUMN,
 * and CREATE FUNCTION statements, then confirms every table/column those
 * statements introduce is actually reachable on BOTH projects.
 *
 * Why this exists: nothing keeps the test project's schema in sync with
 * production automatically (see CONVENTIONS.md, "Test project schema can
 * drift from production") — a migration applied to one and forgotten on the
 * other would let other tools (the integration suite, the seed script) run
 * against a schema the app doesn't actually run against. This catches that
 * before anything else proceeds.
 *
 * Deliberately uses only the anon/publishable keys already available (no
 * service-role key, no DB password) — see the "Coverage gap" this prints.
 * Table/column existence is checked via a `select <col>&limit=0` REST call
 * and reading the specific PostgREST error code (PGRST205 = table missing,
 * 42703 = column missing) — this works even when RLS blocks the anon role
 * from reading actual rows, since a permission-driven empty result is a
 * *different* response than a schema-cache miss. CREATE FUNCTION statements
 * CANNOT be verified this way: PostgREST's schema-introspection endpoint
 * (which used to allow checking whether an RPC exists without calling it)
 * now requires a secret/service-role key on this Supabase version, and
 * functions are deliberately never invoked here (some, like
 * dev_confirm_user_email, mutate auth.users — calling a function just to
 * check it exists would be a real, unwanted side effect on production).
 * Functions are reported as an explicit, named coverage gap instead of
 * silently skipped or falsely assumed to pass.
 *
 * Exports checkParity() for reuse by other scripts (e.g. scripts/seed.js,
 * which must confirm the test project's schema is current before writing
 * anything to it) as well as running standalone as the CI pre-check.
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

/**
 * Compares the production and test projects' schemas as derived from
 * supabase/migrations/*.sql. Returns { ok, filesChecked, mismatches, functions }
 * rather than printing/exiting — callers decide how to report and whether to
 * proceed. `ok` is only about tables/columns; `functions` is always returned
 * separately as a disclosed coverage gap, never treated as a failure.
 */
async function checkParity({ productionUrl, productionKey, testUrl, testKey }) {
  if (!productionUrl || !productionKey || !testUrl || !testKey) {
    throw new Error(
      'checkParity() needs productionUrl/productionKey/testUrl/testKey all set.'
    );
  }

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const parsed = files.map((f) => parseMigrationFile(path.join(MIGRATIONS_DIR, f)));

  const functions = [];
  const mismatches = []; // { file, description, production: ok|reason, test: ok|reason }

  for (const migration of parsed) {
    for (const table of migration.tables) {
      const [prodResult, testResult] = await Promise.all([
        checkTableColumns(productionUrl, productionKey, table.name, table.columns),
        checkTableColumns(testUrl, testKey, table.name, table.columns),
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
        checkTableColumns(productionUrl, productionKey, alter.table, alter.columns),
        checkTableColumns(testUrl, testKey, alter.table, alter.columns),
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
      functions.push({ file: migration.file, name: fn });
    }
  }

  return { ok: mismatches.length === 0, filesChecked: parsed.length, mismatches, functions };
}

function printReport({ filesChecked, mismatches, functions }) {
  console.log(`Checked ${filesChecked} migration file(s) against production and test projects.\n`);

  if (functions.length > 0) {
    console.log('Coverage gap — functions CANNOT be verified via anon key on this Supabase version');
    console.log('(schema introspection now requires a service-role key; functions are never invoked');
    console.log('here since some have side effects). Verify these manually if in doubt:');
    for (const { file, name } of functions) {
      console.log(`  - ${name}() (from ${file})`);
    }
    console.log('');
  }

  if (mismatches.length > 0) {
    console.error('Schema mismatch between production and test projects:\n');
    for (const mm of mismatches) {
      console.error(`  [${mm.file}] ${mm.description}`);
      console.error(`    production: ${mm.production}`);
      console.error(`    test:       ${mm.test}`);
    }
    console.error('\nApply the missing migration(s) to whichever project is behind, then re-run.');
  } else {
    console.log('All checkable tables/columns match on both projects.');
  }
}

module.exports = { checkParity, printReport, parseMigrationFile };

// CLI entry point — only runs when this file is executed directly (`node
// scripts/check-migrations-parity.js`), not when required by another script.
if (require.main === module) {
  (async () => {
    const config = {
      productionUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
      productionKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
      testUrl: process.env.TEST_SUPABASE_URL,
      testKey: process.env.TEST_SUPABASE_ANON_KEY,
    };
    if (!config.productionUrl || !config.productionKey || !config.testUrl || !config.testKey) {
      console.error(
        'Missing credentials. Need EXPO_PUBLIC_SUPABASE_URL/EXPO_PUBLIC_SUPABASE_ANON_KEY ' +
          '(production) and TEST_SUPABASE_URL/TEST_SUPABASE_ANON_KEY (test) all set — see ' +
          "CONVENTIONS.md's Testing section for the required CI secrets."
      );
      process.exit(1);
    }

    try {
      const result = await checkParity(config);
      printReport(result);
      process.exit(result.ok ? 0 : 1);
    } catch (err) {
      console.error('check-migrations-parity.js failed:', err);
      process.exit(1);
    }
  })();
}
