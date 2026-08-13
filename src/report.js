function findingLine({ invariantId, file, line, matchedText, rationale }) {
  return [
    `  [${invariantId}] ${file}:${line}`,
    `    matched: ${matchedText}`,
    `    rationale: ${rationale}`,
  ].join('\n');
}

function section(title, lines) {
  const header = `\n=== ${title} ===`;
  if (lines.length === 0) return `${header}\n  (none)`;
  return `${header}\n${lines.join('\n\n')}`;
}

function renderExemptions({ suppressed, exemptionRows }) {
  const lines = [];

  for (const { finding, exemption } of suppressed) {
    lines.push(
      `${findingLine(finding)}\n    exempted by: ${exemption.invariant} (valid_through: ${exemption.valid_through})\n    reason: ${exemption.reason}`
    );
  }

  for (const row of exemptionRows) {
    if (row.status === 'EXPIRED') {
      lines.push(
        `  [EXPIRED] invariant: ${row.exemption.invariant}\n    paths: ${(row.exemption.paths ?? ['*']).join(', ')}\n    reason: ${row.exemption.reason}\n    valid_through: ${row.exemption.valid_through} (granted: ${row.exemption.granted})\n    no longer suppressing findings`
      );
    } else if (row.suppressedCount === 0) {
      lines.push(
        `  [ACTIVE, unused] invariant: ${row.exemption.invariant}\n    paths: ${(row.exemption.paths ?? ['*']).join(', ')}\n    reason: ${row.exemption.reason}\n    valid_through: ${row.exemption.valid_through}\n    no matching findings currently`
      );
    }
  }

  return lines;
}

function renderKnowledge(knowledgeRows) {
  return knowledgeRows.map((k) => {
    const marker = k.status === 'unconfirmed' ? '[UNCONFIRMED] ' : '';
    return [
      `  ${marker}${k.id} (${k.kind})`,
      `    claim: ${k.claim}`,
      `    rationale: ${k.rationale}`,
      `    status: ${k.status}`,
    ].join('\n');
  });
}

function renderExclusions(exclusionRecords) {
  const lines = [];
  for (const record of exclusionRecords) {
    for (const { reason, count } of record.exclusions) {
      lines.push(
        `  [${record.invariantId}] ${record.checkId}\n    excluded: ${count} file(s)\n    reason: ${reason ?? '(unspecified)'}`
      );
    }
  }
  return lines;
}

function renderInvariantStatus(invariantsReport) {
  return invariantsReport.map((inv) => {
    const checkLines = inv.checks.map((c) => {
      if (c.status === 'skipped_by_phase') return `    ${c.checkId} — skipped_by_phase`;
      if (c.status === 'error') return `    ${c.checkId} — error`;
      return `    ${c.checkId} — matched ${c.matchedFiles} file(s), ${c.findings} finding(s)`;
    });
    return [`  ${inv.id}: ${inv.status}`, ...checkLines].join('\n');
  });
}

function renderErrors(errors) {
  return errors.map(
    (e) => `  [${e.invariantId}] ${e.checkId}\n    error: ${e.message}`
  );
}

/** Errors dominate violations: an incomplete run outranks a completed one that found problems. */
export function computeExitCode({ findings, errors }) {
  const hasViolation = findings.some((f) => f.severity === 'violation');
  if (errors.length > 0) return 2;
  if (hasViolation) return 1;
  return 0;
}

/**
 * result: { findings, suppressed, exemptionRows, errors, knowledgeRows, exclusionRecords }
 * Returns { text, exitCode }.
 */
export function renderReport(result) {
  const violations = result.findings.filter((f) => f.severity === 'violation');
  const advisories = result.findings.filter((f) => f.severity === 'advisory');

  const parts = [
    section('Violations', violations.map(findingLine)),
    section('Advisories', advisories.map(findingLine)),
    section('Active Exemptions', renderExemptions(result)),
    section('Exclusions', renderExclusions(result.exclusionRecords)),
    section('Errors', renderErrors(result.errors)),
    section('Knowledge', renderKnowledge(result.knowledgeRows)),
    section('Invariant Status', renderInvariantStatus(result.invariantsReport)),
  ];

  return { text: parts.join('\n'), exitCode: computeExitCode(result) };
}
