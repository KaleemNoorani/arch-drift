import { computeExitCode } from './report.js';

// Bump on any change to this shape, breaking or additive — external tooling
// (e.g. a Claude Code plugin) depends on it being stable, not a debug dump,
// and needs to be able to tell when the contract has moved.
export const JSON_SCHEMA_VERSION = '3';

function exemptionSummary(exemption) {
  return {
    invariant: exemption.invariant,
    paths: exemption.paths ?? null,
    reason: exemption.reason,
    validThrough: exemption.valid_through,
    granted: exemption.granted,
  };
}

/**
 * result: { findings, suppressed, exemptionRows, errors, knowledgeRows, exclusionRecords }
 * doc: the loaded architecture.json
 *
 * Returns a stable, versioned JSON object — this is a contract, not an
 * ad hoc dump of internal state.
 */
export function buildJsonReport(result, doc) {
  const violations = result.findings.filter((f) => f.severity === 'violation');
  const advisories = result.findings.filter((f) => f.severity === 'advisory');

  const exclusions = result.exclusionRecords.flatMap((record) =>
    record.exclusions.map(({ reason, count }) => ({
      invariantId: record.invariantId,
      checkId: record.checkId,
      reason,
      count,
    }))
  );

  return {
    schemaVersion: JSON_SCHEMA_VERSION,
    exitCode: computeExitCode(result),
    phase: doc.phase,
    summary: {
      violations: violations.length,
      advisories: advisories.length,
      suppressed: result.suppressed.length,
      errors: result.errors.length,
      knowledge: result.knowledgeRows.length,
      exclusions: exclusions.length,
      unresolvable: result.unresolvableRecords.length,
    },
    violations,
    advisories,
    exemptions: {
      suppressed: result.suppressed.map(({ finding, exemption }) => ({
        ...finding,
        exemption: exemptionSummary(exemption),
      })),
      rows: result.exemptionRows.map((row) => ({
        ...exemptionSummary(row.exemption),
        status: row.status,
        suppressedCount: row.suppressedCount,
      })),
    },
    exclusions,
    unresolvable: result.unresolvableRecords,
    errors: result.errors,
    knowledge: result.knowledgeRows,
    invariants: result.invariantsReport,
  };
}
