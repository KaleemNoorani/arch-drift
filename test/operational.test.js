import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { verifyOperationalSnapshot } from '../src/operational/verify.js';
import { resolveLocalSnapshot } from '../src/operational/localSnapshot.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, 'fixtures', 'demo-fulfillment');
const now = '2030-04-06T12:10:00.000Z';
const execFileAsync = promisify(execFile);

async function fixture(name = 'pass') {
  return JSON.parse(await readFile(path.join(fixtures, `${name}.json`), 'utf8'));
}
const verify = (snapshot) => verifyOperationalSnapshot(snapshot, { now });
const event = (id, kind, quantity, occurredAt, sequence, subjectId = 'parcel-line-aurora') =>
  ({ id, subjectId, kind, quantity, occurredAt, sequence });

test('partial shipment passes with outstanding quantity and provenance', async () => {
  const report = verify(await fixture());
  assert.equal(report.runStatus, 'PASS');
  assert.equal(report.results[0].status, 'PASS');
  assert.deepEqual(report.results[0].observed, { ordered: 8, shipped: 3, canceled: 0, outstanding: 5 });
  assert.deepEqual(report.results[0].evidence[1].recordIds, ['journal-aurora-1']);
  assert.equal(report.results[0].evidence[1].lineageRoot, 'storybook-parcel-origin');
});

test('overshipment fails', async () => {
  const report = verify(await fixture('fail'));
  assert.equal(report.runStatus, 'FAIL');
  assert.equal(report.results[0].reasonCode, 'OVERSHIPMENT');
});

test('cancellation of unshipped remainder passes, including later partial shipment', async () => {
  const snapshot = await fixture();
  snapshot.sources[1].records.push(event('journal-aurora-2', 'cancel', 2, '2030-04-06T10:05:00.000Z', 2));
  snapshot.sources[1].records.push(event('journal-aurora-3', 'ship', 3, '2030-04-06T10:10:00.000Z', 3));
  const row = verify(snapshot).results[0];
  assert.equal(row.status, 'PASS');
  assert.deepEqual(row.observed, { ordered: 8, shipped: 6, canceled: 2, outstanding: 0 });
});

test('cancellation exceeding unshipped remainder fails', async () => {
  const snapshot = await fixture();
  snapshot.sources[1].records.push(event('journal-aurora-2', 'cancel', 6, '2030-04-06T10:05:00.000Z', 2));
  assert.equal(verify(snapshot).results[0].reasonCode, 'INVALID_CANCELLATION');
});

test('identical event replay counts once', async () => {
  const snapshot = await fixture();
  snapshot.sources[1].records.push({ ...snapshot.sources[1].records[0] });
  assert.equal(verify(snapshot).results[0].observed.shipped, 3);
});

test('conflicting duplicate event ID is UNKNOWN', async () => {
  const snapshot = await fixture();
  snapshot.sources[1].records.push({ ...snapshot.sources[1].records[0], quantity: 4 });
  assert.equal(verify(snapshot).results[0].reasonCode, 'CONFLICTING_EVENT_ID');
});

test('missing evidence is UNKNOWN', async () => {
  const snapshot = await fixture();
  snapshot.sources.pop();
  assert.equal(verify(snapshot).results[0].reasonCode, 'MISSING_EVIDENCE');
});

test('stale evidence is UNKNOWN', async () => {
  const snapshot = await fixture('unknown');
  snapshot.sources[1].capturedAt = '2030-04-06T12:01:00.000Z';
  snapshot.policy.maxAgeSeconds = 60;
  assert.equal(verify(snapshot).results[0].reasonCode, 'STALE_EVIDENCE');
});

test('cutoff mismatch and incomplete coverage are UNKNOWN', async () => {
  const snapshot = await fixture();
  snapshot.sources[1].asOf = '2030-04-06T11:00:00.000Z';
  assert.equal(verify(snapshot).results[0].reasonCode, 'CUTOFF_MISMATCH');
  snapshot.sources[1].asOf = snapshot.asOf;
  snapshot.sources[1].completeThrough = '2030-04-06T11:00:00.000Z';
  assert.equal(verify(snapshot).results[0].reasonCode, 'INCOMPLETE_EVIDENCE');
});

test('shared upstream lineage is UNKNOWN only when policy requires independence', async () => {
  const snapshot = await fixture();
  snapshot.sources[1].lineageRoot = snapshot.sources[0].lineageRoot;
  assert.equal(verify(snapshot).results[0].reasonCode, 'SHARED_LINEAGE');
  snapshot.policy.requireIndependentSources = false;
  assert.equal(verify(snapshot).results[0].status, 'PASS');
});

test('ambiguous event ordering is UNKNOWN', async () => {
  const snapshot = await fixture();
  snapshot.sources[1].records.push(event('journal-aurora-2', 'cancel', 5, '2030-04-06T10:00:00.000Z', 1));
  assert.equal(verify(snapshot).results[0].reasonCode, 'AMBIGUOUS_ORDER');
});

test('confirmed FAIL remains visible beside unrelated UNKNOWN', async () => {
  const snapshot = await fixture('fail');
  snapshot.subjects.push('parcel-line-missing');
  const report = verify(snapshot);
  assert.equal(report.runStatus, 'UNKNOWN');
  assert.deepEqual(report.results.map((r) => r.status), ['FAIL', 'UNKNOWN']);
});

test('operational CLI exposes PASS, FAIL, UNKNOWN and distinct execution errors', async () => {
  const bin = path.join(here, '..', 'bin', 'operational-check.js');
  async function run(name) {
    try {
      const { stdout } = await execFileAsync(process.execPath, [bin, '--snapshot', path.join(fixtures, `${name}.json`), '--now', now, '--json']);
      return { code: 0, report: JSON.parse(stdout) };
    } catch (err) {
      return { code: err.code, report: JSON.parse(err.stdout) };
    }
  }
  for (const [name, code, status] of [['pass', 0, 'PASS'], ['fail', 1, 'FAIL'], ['unknown', 2, 'UNKNOWN']]) {
    const out = await run(name);
    assert.equal(out.code, code);
    assert.equal(out.report.exitCode, code);
    assert.equal(out.report.runStatus, status);
  }
  const error = await run('absent');
  assert.equal(error.code, 2);
  assert.equal(error.report.runStatus, 'ERROR');
  assert.equal(error.report.errors[0].code, 'EXECUTION_ERROR');
});

test('each required provenance identity is needed for PASS', async () => {
  for (const mutate of [
    (s) => { delete s.sources[0].artifactId; },
    (s) => { s.sources[0].artifactId = '  '; },
    (s) => { delete s.sources[0].lineageRoot; },
    (s) => { delete s.sources[0].asOf; },
    (s) => { delete s.sources[0].capturedAt; },
    (s) => { delete s.sources[0].completeThrough; },
    (s) => { delete s.sources[0].records[0].id; },
    (s) => { delete s.sources[1].records[0].id; },
  ]) {
    const snapshot = await fixture();
    mutate(snapshot);
    assert.equal(verify(snapshot).runStatus, 'UNKNOWN');
  }
});

test('scoped malformed evidence is UNKNOWN without hiding a different FAIL', async () => {
  const snapshot = await fixture('fail');
  snapshot.subjects.push('parcel-line-boreal');
  snapshot.sources[0].records.push({ id: 'card-boreal', subjectId: 'parcel-line-boreal', quantity: 3 });
  snapshot.sources[1].records.push({ id: 'journal-boreal', subjectId: 'parcel-line-boreal', kind: 'ship', quantity: -1,
    occurredAt: '2030-04-06T10:00:00.000Z', sequence: 1 });
  const report = verify(snapshot);
  assert.equal(report.runStatus, 'UNKNOWN');
  assert.equal(report.results.find((r) => r.subjectId === 'parcel-line-comet').status, 'FAIL');
  assert.equal(report.results.find((r) => r.subjectId === 'parcel-line-boreal').status, 'UNKNOWN');
});

test('unscoped malformed record remains visible and prevents unrelated PASS', async () => {
  const snapshot = await fixture();
  snapshot.sources[1].records.push(null);
  const report = verify(snapshot);
  assert.equal(report.runStatus, 'UNKNOWN');
  assert.equal(report.results.find((r) => r.subjectId === 'parcel-line-aurora').status, 'UNKNOWN');
  assert.equal(report.results.find((r) => r.subjectId === null).reasonCode, 'UNSCOPED_EVIDENCE');

  const failing = await fixture('fail');
  failing.sources[1].records.push(null);
  const mixed = verify(failing);
  assert.equal(mixed.runStatus, 'UNKNOWN');
  assert.equal(mixed.results.find((r) => r.subjectId === 'parcel-line-comet').status, 'FAIL');
  assert.equal(mixed.results.find((r) => r.subjectId === null).status, 'UNKNOWN');
});

test('FAIL evidence identifies the attempted event and valid prefix', async () => {
  const overshipment = verify(await fixture('fail')).results[0];
  assert.deepEqual(overshipment.observed.offendingEvent, {
    reasonCode: 'OVERSHIPMENT', eventId: 'journal-comet-1', kind: 'ship', attemptedQuantity: 5,
    priorValidCumulativeQuantity: 0, limit: 4,
  });
  assert.equal(overshipment.observed.acceptedShipped, 0);
  const cancellation = await fixture();
  cancellation.sources[1].records.push(event('journal-aurora-2', 'cancel', 6, '2030-04-06T10:05:00.000Z', 2));
  const row = verify(cancellation).results[0];
  assert.equal(row.observed.offendingEvent.attemptedQuantity, 6);
  assert.equal(row.observed.offendingEvent.limit, 5);
  assert.doesNotMatch(row.recovery.action, /correct the source evidence/i);
});

test('missing, duplicate, and conflicting order evidence have distinct reasons', async () => {
  const missing = await fixture();
  missing.sources[0].records = [];
  assert.equal(verify(missing).results[0].reasonCode, 'MISSING_EVIDENCE');
  const duplicate = await fixture();
  duplicate.sources[0].records.push({ ...duplicate.sources[0].records[0] });
  assert.equal(verify(duplicate).results[0].reasonCode, 'DUPLICATE_EVIDENCE');
  const conflicting = await fixture();
  conflicting.sources[0].records.push({ ...conflicting.sources[0].records[0], quantity: 7 });
  assert.equal(verify(conflicting).results[0].reasonCode, 'CONFLICTING_EVIDENCE');
});

test('results, record IDs, and semantic hashes are input-order independent', async () => {
  const snapshot = await fixture();
  snapshot.subjects.push('parcel-line-boreal');
  snapshot.sources[0].records.push({ id: 'card-boreal', subjectId: 'parcel-line-boreal', quantity: 5 });
  snapshot.sources[1].records.push(event('journal-boreal', 'ship', 2, '2030-04-06T10:01:00.000Z', 2, 'parcel-line-boreal'));
  const before = verify(snapshot);
  snapshot.subjects.reverse();
  snapshot.sources.forEach((source) => source.records.reverse());
  assert.deepEqual(verify(snapshot), before);
});

test('fixture path guard rejects UNC, device, traversal, and symlink escape before reading', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'arch-drift-path-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const allowed = path.join(root, 'allowed');
  await mkdir(allowed);
  const inside = path.join(allowed, 'inside.json');
  const outside = path.join(root, 'outside.json');
  await writeFile(inside, '{}');
  await writeFile(outside, '{}');
  assert.equal(await resolveLocalSnapshot(inside, allowed), inside);
  for (const bad of [
    String.raw`\\fictional-host\share\pass.json`,
    String.raw`\\?\C:\fictional\pass.json`,
    String.raw`\\.\pipe\fictional`,
    `${allowed}${path.sep}..${path.sep}outside.json`,
    `${allowed}${path.sep}..${path.sep}allowed${path.sep}inside.json`,
  ]) {
    await assert.rejects(resolveLocalSnapshot(bad, allowed));
  }
  const link = path.join(allowed, 'escape');
  await symlink(root, link, 'junction');
  await assert.rejects(resolveLocalSnapshot(path.join(link, 'outside.json'), allowed), /symlink|junction/);
});

test('--json parse errors use operational ERROR JSON and exit 2', async () => {
  const bin = path.join(here, '..', 'bin', 'operational-check.js');
  await assert.rejects(
    execFileAsync(process.execPath, [bin, '--json', '--bogus']),
    (err) => {
      assert.equal(err.code, 2);
      const report = JSON.parse(err.stdout);
      assert.equal(report.schemaVersion, 'operational/1');
      assert.equal(report.runStatus, 'ERROR');
      assert.equal(report.exitCode, 2);
      assert.equal(report.errors[0].code, 'EXECUTION_ERROR');
      return true;
    }
  );
});

test('operational CLI rejects unsafe snapshot paths as JSON ERROR before reading', async () => {
  const bin = path.join(here, '..', 'bin', 'operational-check.js');
  for (const unsafe of [
    String.raw`\\fictional-host\share\pass.json`,
    String.raw`\\?\C:\fictional\pass.json`,
    String.raw`\\.\pipe\fictional`,
    path.join(here, 'fixtures', 'architecture.json'),
  ]) {
    await assert.rejects(
      execFileAsync(process.execPath, [bin, '--snapshot', unsafe, '--now', now, '--json']),
      (err) => {
        assert.equal(err.code, 2);
        const report = JSON.parse(err.stdout);
        assert.equal(report.runStatus, 'ERROR');
        assert.equal(report.errors[0].code, 'EXECUTION_ERROR');
        return true;
      }
    );
  }
});
