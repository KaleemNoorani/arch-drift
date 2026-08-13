import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');
const bin = path.join(repoRoot, 'bin', 'drift-check.js');
const target = path.join(here, 'fixtures', 'target');
const mainConfig = path.join(here, 'fixtures', 'architecture.json');
const errorConfig = path.join(here, 'fixtures', 'architecture-with-error.json');

/** Runs the documented binary and never throws on nonzero exit — resolves { stdout, stderr, code } instead. */
async function runCli(args) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [bin, ...args], { cwd: repoRoot });
    return { stdout, stderr, code: 0 };
  } catch (err) {
    return { stdout: err.stdout ?? '', stderr: err.stderr ?? '', code: err.code };
  }
}

test('CLI: no flags at all -> exit 2 with usage on stderr', async () => {
  const { code, stderr } = await runCli([]);
  assert.equal(code, 2);
  assert.match(stderr, /Usage: drift-check/);
});

test('CLI: --config without --target -> exit 2 with usage', async () => {
  const { code, stderr } = await runCli(['--config', mainConfig]);
  assert.equal(code, 2);
  assert.match(stderr, /Usage: drift-check/);
});

test('CLI: --target pointing at a nonexistent directory -> exit 2, clear message', async () => {
  const { code, stderr } = await runCli(['--config', mainConfig, '--target', path.join(target, 'does-not-exist')]);
  assert.equal(code, 2);
  assert.match(stderr, /does not exist/);
});

test('CLI: --config + --target, real fixture -> exit 1, human report has all six sections', async () => {
  const { code, stdout } = await runCli(['--config', mainConfig, '--target', target]);
  assert.equal(code, 1);
  for (const heading of ['Violations', 'Advisories', 'Active Exemptions', 'Exclusions', 'Errors', 'Knowledge']) {
    assert.match(stdout, new RegExp(`=== ${heading} ===`), `missing section: ${heading}`);
  }
  assert.match(stdout, /ingest-only-order-creation/);
});

test('CLI: --json produces valid, schema-shaped JSON on stdout matching the process exit code', async () => {
  const { code, stdout } = await runCli(['--config', mainConfig, '--target', target, '--json']);
  assert.equal(code, 1);

  const report = JSON.parse(stdout); // must not throw — output must be pure JSON, no stray text
  assert.equal(report.schemaVersion, '1');
  assert.equal(report.exitCode, code);
  assert.equal(report.phase, 'dev');
  assert.ok(Array.isArray(report.violations) && report.violations.length > 0);
  assert.ok(Array.isArray(report.advisories));
  assert.ok(Array.isArray(report.exclusions) && report.exclusions.length > 0);
  assert.ok(Array.isArray(report.exemptions.suppressed));
  assert.ok(Array.isArray(report.exemptions.rows));
  assert.ok(Array.isArray(report.knowledge));
  assert.deepEqual(report.summary, {
    violations: report.violations.length,
    advisories: report.advisories.length,
    suppressed: report.exemptions.suppressed.length,
    errors: report.errors.length,
    knowledge: report.knowledge.length,
    exclusions: report.exclusions.length,
  });
});

test('CLI: unknown checker type -> exit 2 via the real binary, Errors section populated', async () => {
  const { code, stdout } = await runCli(['--config', errorConfig, '--target', target]);
  assert.equal(code, 2);
  assert.match(stdout, /=== Errors ===/);
  assert.match(stdout, /Unknown checker type/);
});

test('CLI: unknown checker type with --json -> exitCode 2, errors array populated', async () => {
  const { code, stdout } = await runCli(['--config', errorConfig, '--target', target, '--json']);
  assert.equal(code, 2);
  const report = JSON.parse(stdout);
  assert.equal(report.exitCode, 2);
  assert.equal(report.errors.length, 1);
  assert.match(report.errors[0].message, /Unknown checker type/);
});

test('CLI: node src/cli.js (direct execution) behaves identically to bin/drift-check.js', async () => {
  const cliJs = path.join(repoRoot, 'src', 'cli.js');
  const viaBin = await execFileAsync(process.execPath, [bin, '--config', mainConfig, '--target', target]).catch((e) => e);
  const viaDirect = await execFileAsync(process.execPath, [cliJs, '--config', mainConfig, '--target', target]).catch((e) => e);
  assert.equal(viaDirect.stdout, viaBin.stdout);
  assert.equal(viaDirect.code ?? 0, viaBin.code ?? 0);
});
