import picomatch from 'picomatch';
import { phaseIndex } from './config.js';

/** Strictly-past semantics: valid through valid_through, expires on the next phase. */
export function isExemptionExpired(exemption, doc) {
  const currentIdx = phaseIndex(doc.phases, doc.phase);
  const validIdx = phaseIndex(doc.phases, exemption.valid_through);
  return currentIdx > validIdx;
}

function pathMatches(exemption, file) {
  if (!exemption.paths) return true;
  return picomatch(exemption.paths)(file);
}

/**
 * findings: [{ invariantId, file, line, matchedText, rationale, severity, checkId }]
 *
 * Returns:
 *   unsuppressed:  findings not covered by any active, path-matching exemption
 *   suppressed:    [{ finding, exemption }] covered by an active exemption
 *   exemptionRows: one row per registered exemption (always present, per spec),
 *                  with its ACTIVE/EXPIRED status and how many findings it suppressed
 */
export function applyExemptions(findings, doc) {
  const exemptions = doc.exemptions ?? [];
  const suppressed = [];
  const unsuppressed = [];
  const suppressedCounts = new Map();

  for (const finding of findings) {
    const applicable = exemptions.find(
      (ex) =>
        ex.invariant === finding.invariantId &&
        !isExemptionExpired(ex, doc) &&
        pathMatches(ex, finding.file)
    );
    if (applicable) {
      suppressed.push({ finding, exemption: applicable });
      suppressedCounts.set(applicable, (suppressedCounts.get(applicable) ?? 0) + 1);
    } else {
      unsuppressed.push(finding);
    }
  }

  const exemptionRows = exemptions.map((exemption) => ({
    exemption,
    status: isExemptionExpired(exemption, doc) ? 'EXPIRED' : 'ACTIVE',
    suppressedCount: suppressedCounts.get(exemption) ?? 0,
  }));

  return { suppressed, unsuppressed, exemptionRows };
}
