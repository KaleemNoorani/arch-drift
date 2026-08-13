import { getCheckerRegistry } from './checkers/index.js';
import { isActiveForPhase } from './config.js';
import { applyExemptions } from './exemptions.js';

function buildKnowledgeRows(doc) {
  return (doc.knowledge ?? []).filter(
    (k) => isActiveForPhase(k.phases, doc.phase) && (!Array.isArray(k.checks) || k.status === 'unconfirmed')
  );
}

/**
 * Runs every active invariant's and knowledge entry's checks against targetDir.
 * Does not short-circuit: every check runs independently, errors are collected
 * rather than aborting the run.
 */
export async function runChecks(doc, targetDir) {
  const registry = await getCheckerRegistry();

  const findings = [];
  const errors = [];
  const exclusionRecords = []; // [{ invariantId, checkId, exclusions: [{reason, count}] }]

  const sources = [
    ...doc.invariants,
    ...(doc.knowledge ?? []).filter((k) => Array.isArray(k.checks)),
  ];

  for (const entry of sources) {
    if (!isActiveForPhase(entry.phases, doc.phase)) continue;

    const severity = entry.severity ?? 'violation';
    const rationale = entry.rationale ?? '';

    for (let index = 0; index < entry.checks.length; index++) {
      const check = entry.checks[index];
      const checkId = `${entry.id}#${index}:${check.type}`;
      const dispatch = registry.get(check.type);

      if (!dispatch) {
        errors.push({ invariantId: entry.id, checkId, message: `Unknown checker type '${check.type}'` });
        continue;
      }

      const exclusionsForThisCheck = [];
      const ctx = {
        targetDir,
        recordExclusions: (rows) => exclusionsForThisCheck.push(...rows),
      };

      try {
        const results = await dispatch(check, entry, ctx);
        if (exclusionsForThisCheck.length > 0) {
          exclusionRecords.push({ invariantId: entry.id, checkId, exclusions: exclusionsForThisCheck });
        }
        for (const r of results) {
          findings.push({
            invariantId: entry.id,
            checkId,
            severity,
            rationale,
            file: r.file,
            line: r.line,
            matchedText: r.matchedText,
          });
        }
      } catch (err) {
        errors.push({ invariantId: entry.id, checkId, message: err.message });
      }
    }
  }

  const { suppressed, unsuppressed, exemptionRows } = applyExemptions(findings, doc);
  const knowledgeRows = buildKnowledgeRows(doc);

  return { findings: unsuppressed, suppressed, exemptionRows, errors, knowledgeRows, exclusionRecords };
}
