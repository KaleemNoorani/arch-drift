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
  assert.ok(violationIds.includes('scheduled-theme-activation'));
  assert.ok(violationIds.includes('built-in-exhibit-renderer'));
  assert.ok(violationIds.includes('preview-migrations-reversible'));

  const rendererFindings = result.findings.filter((f) => f.invariantId === 'built-in-exhibit-renderer');
  assert.ok(rendererFindings.some((f) => f.checkId.endsWith(':forbidden_dependency')));
  assert.ok(rendererFindings.some((f) => f.checkId.endsWith(':config_value_allowlist')));

  const themeFindings = result.findings.filter((f) => f.invariantId === 'scheduled-theme-activation');
  assert.equal(themeFindings.length, 2, 'both forbidden theme calls must be reported');
  assert.ok(themeFindings.some((f) => f.matchedText.includes('MuseumTheme::activate(')));
  assert.ok(themeFindings.some((f) => f.matchedText.includes('MuseumTheme::forceActivate(')));

  // The theme-activation exclusion must omit the synthetic theme scheduler.
  assert.ok(
    !result.findings.some((f) => f.file.includes('ApplyTheme.php') && f.invariantId === 'scheduled-theme-activation')
  );

  // DemoThemeSeeder.php is suppressed by an active exemption, not a raw violation.
  assert.ok(!result.findings.some((f) => f.file.includes('DemoThemeSeeder.php')));
  assert.ok(result.suppressed.some((s) => s.finding.file.includes('DemoThemeSeeder.php')));

  const rows = result.exemptionRows;
  assert.equal(rows.find((r) => r.exemption.invariant === 'scheduled-theme-activation').status, 'ACTIVE');
  assert.equal(rows.find((r) => r.exemption.invariant === 'optional-thumbnail-degrades').status, 'EXPIRED');
  const unused = rows.find((r) => r.exemption.invariant === 'preview-migrations-reversible');
  assert.equal(unused.status, 'ACTIVE');
  assert.equal(unused.suppressedCount, 0);

  // Expired exemption's underlying finding surfaces normally (advisory severity here).
  assert.ok(
    result.findings.some(
      (f) => f.file.includes('Thumbnails/Unfinished/Client.php') && f.invariantId === 'optional-thumbnail-degrades'
    )
  );

  // A down() marked @architecturally-irreversible passes even though its body is comment-only;
  // an unmarked empty down() still fires.
  assert.ok(
    !result.findings.some((f) => f.file.includes('normalize_display_slugs.php')),
    'marked migration must not be flagged'
  );
  assert.ok(
    result.findings.some(
      (f) => f.file.includes('create_exhibit_pages_table.php') && f.invariantId === 'preview-migrations-reversible'
    ),
    'unmarked empty down() must still be flagged'
  );

  // Named except reason (object form) is tracked and reported alongside bare-glob except entries.
  const themeExclusions = result.exclusionRecords.find((r) => r.invariantId === 'scheduled-theme-activation');
  assert.ok(themeExclusions, 'expected an exclusion record for the named except entry');
  assert.deepEqual(themeExclusions.exclusions, [
    { reason: 'The fictional scheduler is the designated theme activation entrypoint.', count: 1 },
  ]);

  // invariants[] status rollup: every one of the five documented statuses, plus rollup-to-worst.
  const byId = Object.fromEntries(result.invariantsReport.map((inv) => [inv.id, inv]));

  assert.equal(byId['scheduled-theme-activation'].status, 'violated');
  assert.equal(byId['optional-thumbnail-degrades'].status, 'advisory_only');

  assert.equal(byId['no-deprecated-helper-usage'].status, 'clean');
  assert.equal(byId['no-deprecated-helper-usage'].checks[0].findings, 0);
  assert.ok(byId['no-deprecated-helper-usage'].checks[0].matchedFiles > 0);

  assert.equal(byId['no-legacy-queue-jobs'].status, 'no_targets_matched');
  assert.equal(byId['no-legacy-queue-jobs'].checks[0].matchedFiles, 0);

  assert.equal(byId['public-only-check'].status, 'skipped_by_phase');
  assert.equal(byId['public-only-check'].checks[0].status, 'skipped_by_phase');
  assert.equal(byId['public-only-check'].checks[0].matchedFiles, null);

  // Rollup: one clean check + one no_targets_matched check -> invariant reports the worse of the two.
  const rollup = byId['dual-check-rollup-demo'];
  assert.equal(rollup.status, 'no_targets_matched');
  assert.equal(rollup.checks.find((c) => c.checkId.endsWith('#0:forbidden_call')).status, 'clean');
  assert.equal(rollup.checks.find((c) => c.checkId.endsWith('#1:forbidden_call')).status, 'no_targets_matched');

  const knowledgeIds = result.knowledgeRows.map((k) => k.id);
  assert.ok(knowledgeIds.includes('exhibit-label-ownership'));
  assert.ok(knowledgeIds.includes('thumbnail-delay-unverified'));
  assert.ok(knowledgeIds.includes('image-budget-unverified'));
  // Decided knowledge entry with checks does not itself appear in the knowledge section.
  assert.ok(!knowledgeIds.includes('exhibit-slug-vs-uuid'));
});

test('method_body_forbids: every documented case, asserted against synthetic output', async () => {
  const doc = await loadConfig(path.join(here, 'fixtures', 'architecture.json'));
  const result = await runChecks(doc, target);

  const cacheFindings = result.findings.filter((f) => f.invariantId === 'preview-cache-safety');
  const goodFile = cacheFindings.filter((f) => f.file.endsWith('PreviewCacheService.php'));
  const brokenFile = cacheFindings.filter((f) => f.file.endsWith('PreviewCacheServiceBroken.php'));

  // 1: direct forbidden call inside the forbidden method (renderPreview) -> violation.
  assert.ok(goodFile.some((f) => f.line === 40 && f.matchedText === 'PreviewCache::flush($pageId);'));

  // 3: forbidden call inside a closure nested in the forbidden method -> violation.
  assert.ok(goodFile.some((f) => f.line === 20 && f.matchedText.includes('->flush()')));

  // Exactly these two - nothing else in the file produced a finding. In particular:
  // 2 & 4: the identical call, direct and closure-nested, inside the ALLOWED method
  //        (resetPreviewCache) never even gets examined - clean by construction.
  // 5: the literal pattern text inside a string literal.
  // 6: the literal pattern text inside a //, a #, and a /* */ comment.
  // 7: inside a heredoc body (including its own stray, non-PHP brace).
  // 8: inside a nowdoc body.
  // 9: an unrelated stray brace inside a string earlier in the method did not
  //    desync the scanner - the executable calls after it were still found.
  assert.equal(goodFile.length, 2, 'no other line in the file should have produced a finding');

  // 10: a file whose method boundary is genuinely unresolvable (unterminated
  // heredoc) must never produce a violation, even though the forbidden call
  // is textually present in it.
  assert.equal(brokenFile.length, 0, 'an unresolvable file must never produce a violation');

  const unresolvable = result.unresolvableRecords.find(
    (u) => u.invariantId === 'preview-cache-safety' && u.file.endsWith('PreviewCacheServiceBroken.php')
  );
  assert.ok(unresolvable, 'the broken file must be reported in unresolvableRecords');
  assert.match(unresolvable.reason, /heredoc/);
  assert.equal(unresolvable.kind, 'scanner_limitation');

  // Status accounting: a confirmed violation still outranks 'unresolvable' as
  // the invariant's overall status, but the unresolvable count must ride on
  // the SAME check line as matchedFiles/findings -- never only visible in the
  // separate Unresolvable section.
  const cacheInvariant = result.invariantsReport.find((inv) => inv.id === 'preview-cache-safety');
  assert.equal(cacheInvariant.status, 'violated');
  assert.equal(cacheInvariant.checks[0].findings, 2);
  assert.equal(cacheInvariant.checks[0].unresolvable, 1);
});

test('method_body_forbids: class-awareness, asserted against synthetic output', async () => {
  const doc = await loadConfig(path.join(here, 'fixtures', 'architecture.json'));
  const result = await runChecks(doc, target);

  const byInvariant = (id) => result.findings.filter((f) => f.invariantId === id);
  const unresolvedFor = (id) => result.unresolvableRecords.find((u) => u.invariantId === id);

  const byId = Object.fromEntries(result.invariantsReport.map((inv) => [inv.id, inv]));

  // Two different classes, same file, same method name, no class param -> ambiguous
  // (neither class is doing anything wrong; the config just doesn't say which one).
  // Status must be 'unresolvable', never 'clean' -- a check that scanned nothing
  // real is not the same thing as a check that scanned everything and passed.
  assert.equal(byInvariant('multi-class-no-disambiguation').length, 0);
  const noDisambig = unresolvedFor('multi-class-no-disambiguation');
  assert.ok(noDisambig);
  assert.match(noDisambig.reason, /2 different classes/);
  assert.doesNotMatch(noDisambig.reason, /anonymous/);
  assert.equal(noDisambig.kind, 'ambiguous');
  assert.equal(byId['multi-class-no-disambiguation'].status, 'unresolvable');
  assert.equal(byId['multi-class-no-disambiguation'].checks[0].unresolvable, 1);

  // Same file, class param names PrimaryProcessor -> resolves to exactly that one violation.
  const disambiguated = byInvariant('multi-class-with-disambiguation');
  assert.equal(disambiguated.length, 1);
  assert.equal(disambiguated[0].file, 'app/Services/MultiClassAmbiguous.php');
  assert.equal(disambiguated[0].line, 18);

  // class param names a class that doesn't exist in the file -> unresolvable
  // (config drift), never silently clean.
  assert.equal(byInvariant('multi-class-config-drift').length, 0);
  const configDrift = unresolvedFor('multi-class-config-drift');
  assert.ok(configDrift);
  assert.match(configDrift.reason, /no class named 'TypoProcessorDoesNotExist'/);
  assert.equal(configDrift.kind, 'config_drift');

  // ::class references, the word "class" inside a comment/string, and a
  // function-nested class with its own same-named method all coexist in one
  // file -- class param picks exactly OuterProcessor's own method, not
  // LocalHelper's nested one.
  const edgeCases = byInvariant('class-keyword-edge-cases');
  assert.equal(edgeCases.length, 1);
  assert.equal(edgeCases[0].line, 28);

  // Two anonymous classes, same file, same method name -> permanently
  // ambiguous; no class param could ever fix this, and the reason says so.
  assert.equal(byInvariant('anonymous-class-collision').length, 0);
  const anonCollision = unresolvedFor('anonymous-class-collision');
  assert.ok(anonCollision);
  assert.match(anonCollision.reason, /anonymous classes have no name/);
  assert.equal(anonCollision.kind, 'ambiguous');
  assert.equal(byId['anonymous-class-collision'].status, 'unresolvable');

  // class param names a nonexistent class -> also 'unresolvable', not 'clean'.
  assert.equal(byId['multi-class-config-drift'].status, 'unresolvable');
});

test('method_body_forbids: ambiguous method name (two methods, same name, same file) is unresolvable, never guessed', async () => {
  const { maskOpaqueRegions, findMethodBodyRange } = await import('../src/lib/phpMask.js');
  const src = `<?php
class Dup {
    public function renderPreview($id) { PreviewCache::flush($id); }
    public function renderPreview($id, $x) { PreviewCache::flush($id); }
}
`;
  const { masked } = maskOpaqueRegions(src);
  const result = findMethodBodyRange(masked, 'renderPreview');
  assert.equal(result.status, 'ambiguous');
  assert.match(result.reason, /2 methods named 'renderPreview' found in the same class/);
  assert.equal(result.kind, 'ambiguous');
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
