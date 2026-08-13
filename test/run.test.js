import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.js';
import { runChecks } from '../src/run.js';
import { renderReport } from '../src/report.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(here, 'fixtures', 'target');

test('main fixture: expected violations, advisories, exemption states, exit 1', async () => {
  const doc = await loadConfig(path.join(here, 'fixtures', 'architecture.json'));
  const result = await runChecks(doc, target);
  const { exitCode } = renderReport(result);

  assert.equal(exitCode, 1, 'a violation-severity finding must exit 1');
  assert.equal(result.errors.length, 0);

  const violationIds = result.findings
    .filter((f) => f.severity === 'violation')
    .map((f) => f.invariantId);
  assert.ok(violationIds.includes('ingest-only-order-creation'));
  assert.ok(violationIds.includes('search-against-own-data'));
  assert.ok(violationIds.includes('reversible-migrations'));

  // The ingest-boundary except pattern must exclude the real ingest file.
  assert.ok(
    !result.findings.some((f) => f.file.includes('IngestOrders.php') && f.invariantId === 'ingest-only-order-creation')
  );

  // OrderBackfill.php is suppressed by an active exemption, not a raw violation.
  assert.ok(!result.findings.some((f) => f.file.includes('OrderBackfill.php')));
  assert.ok(result.suppressed.some((s) => s.finding.file.includes('OrderBackfill.php')));

  const rows = result.exemptionRows;
  assert.equal(rows.find((r) => r.exemption.invariant === 'ingest-only-order-creation').status, 'ACTIVE');
  assert.equal(rows.find((r) => r.exemption.invariant === 'integrations-degrade').status, 'EXPIRED');
  const unused = rows.find((r) => r.exemption.invariant === 'reversible-migrations');
  assert.equal(unused.status, 'ACTIVE');
  assert.equal(unused.suppressedCount, 0);

  // Expired exemption's underlying finding surfaces normally (advisory severity here).
  assert.ok(
    result.findings.some(
      (f) => f.file.includes('PartnerX/Client.php') && f.invariantId === 'integrations-degrade'
    )
  );

  // A down() marked @architecturally-irreversible passes even though its body is comment-only;
  // an unmarked empty down() still fires.
  assert.ok(
    !result.findings.some((f) => f.file.includes('merge_legacy_warehouse_data.php')),
    'marked migration must not be flagged'
  );
  assert.ok(
    result.findings.some(
      (f) => f.file.includes('create_orders_table.php') && f.invariantId === 'reversible-migrations'
    ),
    'unmarked empty down() must still be flagged'
  );

  // Named except reason (object form) is tracked and reported alongside bare-glob except entries.
  const ingestExclusions = result.exclusionRecords.find((r) => r.invariantId === 'ingest-only-order-creation');
  assert.ok(ingestExclusions, 'expected an exclusion record for the named except entry');
  assert.deepEqual(ingestExclusions.exclusions, [
    { reason: 'Ingest boundary implementations are the designated legitimate write path.', count: 1 },
  ]);

  // invariants[] status rollup: every one of the five documented statuses, plus rollup-to-worst.
  const byId = Object.fromEntries(result.invariantsReport.map((inv) => [inv.id, inv]));

  assert.equal(byId['ingest-only-order-creation'].status, 'violated');
  assert.equal(byId['integrations-degrade'].status, 'advisory_only');

  assert.equal(byId['no-deprecated-helper-usage'].status, 'clean');
  assert.equal(byId['no-deprecated-helper-usage'].checks[0].findings, 0);
  assert.ok(byId['no-deprecated-helper-usage'].checks[0].matchedFiles > 0);

  assert.equal(byId['no-legacy-queue-jobs'].status, 'no_targets_matched');
  assert.equal(byId['no-legacy-queue-jobs'].checks[0].matchedFiles, 0);

  assert.equal(byId['production-only-check'].status, 'skipped_by_phase');
  assert.equal(byId['production-only-check'].checks[0].status, 'skipped_by_phase');
  assert.equal(byId['production-only-check'].checks[0].matchedFiles, null);

  // Rollup: one clean check + one no_targets_matched check -> invariant reports the worse of the two.
  const rollup = byId['dual-check-rollup-demo'];
  assert.equal(rollup.status, 'no_targets_matched');
  assert.equal(rollup.checks.find((c) => c.checkId.endsWith('#0:forbidden_call')).status, 'clean');
  assert.equal(rollup.checks.find((c) => c.checkId.endsWith('#1:forbidden_call')).status, 'no_targets_matched');

  const knowledgeIds = result.knowledgeRows.map((k) => k.id);
  assert.ok(knowledgeIds.includes('carton-catalog-ownership'));
  assert.ok(knowledgeIds.includes('upstream-wave-semantics'));
  assert.ok(knowledgeIds.includes('partner-timeout-budget-unverified'));
  // Decided knowledge entry with checks does not itself appear in the knowledge section.
  assert.ok(!knowledgeIds.includes('order-number-vs-upstream-id'));
});

test('unknown checker type produces an error and exit 2, not a silent skip', async () => {
  const doc = await loadConfig(path.join(here, 'fixtures', 'architecture-with-error.json'));
  const result = await runChecks(doc, target);
  const { exitCode } = renderReport(result);

  assert.equal(exitCode, 2);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].message, /Unknown checker type/);

  assert.equal(result.invariantsReport.length, 1);
  assert.equal(result.invariantsReport[0].status, 'error');
  assert.equal(result.invariantsReport[0].checks[0].status, 'error');
  assert.equal(result.invariantsReport[0].checks[0].matchedFiles, null);
});
