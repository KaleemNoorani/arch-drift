import { getCheckerRegistry } from './checkers/index.js';
import { isActiveForPhase } from './config.js';
import { applyExemptions } from './exemptions.js';

function buildKnowledgeRows(doc) {
  return (doc.knowledge ?? []).filter(
    (k) => isActiveForPhase(k.phases, doc.phase) && (!Array.isArray(k.checks) || k.status === 'unconfirmed')
  );
}

// Worst-to-best ranking for rolling an invariant's per-check statuses up to
// one overall status. 'error' outranks everything (the check never ran to
// completion, worse than a confirmed violation); 'no_targets_matched'
// outranks 'clean' because it's the silent-failure case this whole feature
// exists to surface, not a pass.
const STATUS_RANK = {
  clean: 1,
  no_targets_matched: 2,
  advisory_only: 3,
  violated: 4,
  error: 5,
};

function worstStatus(statuses) {
  return statuses.reduce(
    (worst, s) => (STATUS_RANK[s] > STATUS_RANK[worst] ? s : worst),
    'clean'
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
  const checkStatusesByInvariant = new Map(); // invariantId -> [{ checkId, type, status, matchedFiles, findings }]
  const skippedByPhase = new Set(); // invariant ids filtered out before running

  const sources = [
    ...doc.invariants.map((entry) => ({ entry, isInvariant: true })),
    ...(doc.knowledge ?? [])
      .filter((k) => Array.isArray(k.checks))
      .map((entry) => ({ entry, isInvariant: false })),
  ];

  for (const { entry, isInvariant } of sources) {
    if (!isActiveForPhase(entry.phases, doc.phase)) {
      if (isInvariant) skippedByPhase.add(entry.id);
      continue;
    }

    const severity = entry.severity ?? 'violation';
    const rationale = entry.rationale ?? '';
    const checkStatuses = [];

    for (let index = 0; index < entry.checks.length; index++) {
      const check = entry.checks[index];
      const checkId = `${entry.id}#${index}:${check.type}`;
      const dispatch = registry.get(check.type);

      if (!dispatch) {
        errors.push({ invariantId: entry.id, checkId, message: `Unknown checker type '${check.type}'` });
        if (isInvariant) {
          checkStatuses.push({ checkId, type: check.type, status: 'error', matchedFiles: null, findings: null });
        }
        continue;
      }

      const exclusionsForThisCheck = [];
      let matchedCount = null;
      const ctx = {
        targetDir,
        recordExclusions: (rows) => exclusionsForThisCheck.push(...rows),
        recordMatchedCount: (n) => {
          matchedCount = n;
        },
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

        if (isInvariant) {
          let status;
          if (matchedCount === 0) status = 'no_targets_matched';
          else if (results.length === 0) status = 'clean';
          else status = severity === 'violation' ? 'violated' : 'advisory_only';
          checkStatuses.push({ checkId, type: check.type, status, matchedFiles: matchedCount, findings: results.length });
        }
      } catch (err) {
        errors.push({ invariantId: entry.id, checkId, message: err.message });
        if (isInvariant) {
          checkStatuses.push({ checkId, type: check.type, status: 'error', matchedFiles: null, findings: null });
        }
      }
    }

    if (isInvariant) checkStatusesByInvariant.set(entry.id, checkStatuses);
  }

  const invariantsReport = doc.invariants.map((inv) => {
    if (skippedByPhase.has(inv.id)) {
      return {
        id: inv.id,
        severity: inv.severity ?? 'violation',
        phases: inv.phases ?? null,
        status: 'skipped_by_phase',
        checks: inv.checks.map((c, index) => ({
          checkId: `${inv.id}#${index}:${c.type}`,
          type: c.type,
          status: 'skipped_by_phase',
          matchedFiles: null,
          findings: null,
        })),
      };
    }

    const checks = checkStatusesByInvariant.get(inv.id) ?? [];
    return {
      id: inv.id,
      severity: inv.severity ?? 'violation',
      phases: inv.phases ?? null,
      status: worstStatus(checks.map((c) => c.status)),
      checks,
    };
  });

  const { suppressed, unsuppressed, exemptionRows } = applyExemptions(findings, doc);
  const knowledgeRows = buildKnowledgeRows(doc);

  return {
    findings: unsuppressed,
    suppressed,
    exemptionRows,
    errors,
    knowledgeRows,
    exclusionRecords,
    invariantsReport,
  };
}
