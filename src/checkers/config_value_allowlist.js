import path from 'node:path';
import { existsSync } from 'node:fs';
import { readLines } from '../lib/text.js';
import { makeFinding } from '../lib/finding.js';

export const type = 'config_value_allowlist';

// Matches   'key' => <rhs>,   or  "key" => <rhs>,   (trailing comment/comma optional)
function extractRhs(lineText, key) {
  const re = new RegExp(`['"]${key}['"]\\s*=>\\s*(.+?)\\s*,?\\s*(?://.*)?$`);
  const m = lineText.match(re);
  return m ? m[1].trim() : null;
}

/**
 * Resolves the literal value a config line's RHS represents.
 * Returns { value } if determinable, or null if the value can only be
 * known at runtime (e.g. bare env('VAR') with no default) — a documented gap.
 */
function resolveLiteral(rhs) {
  const quoted = rhs.match(/^['"]([^'"]*)['"]$/);
  if (quoted) return { value: quoted[1] };

  if (rhs === 'null') return { value: 'null' };

  const envWithDefault = rhs.match(/^env\(\s*['"][^'"]+['"]\s*,\s*(.+)\s*\)$/);
  if (envWithDefault) return resolveLiteral(envWithDefault[1].trim());

  const bareEnv = rhs.match(/^env\(\s*['"][^'"]+['"]\s*\)$/);
  if (bareEnv) return null; // no static default — documented gap

  return null; // unrecognized shape — out of scope for lexical resolution
}

/** params: { file: string, key: string, allowed: string[] } */
export async function check(params, invariant, ctx) {
  const { file, key, allowed } = params;
  const absPath = path.join(ctx.targetDir, file);
  if (!existsSync(absPath)) {
    ctx.recordMatchedCount?.(0);
    return [];
  }
  ctx.recordMatchedCount?.(1);

  const lines = await readLines(absPath);
  const findings = [];

  lines.forEach((lineText, idx) => {
    const rhs = extractRhs(lineText, key);
    if (rhs === null) return;

    const resolved = resolveLiteral(rhs);
    if (!resolved) return; // undeterminable — documented gap, not a finding

    if (!allowed.includes(resolved.value)) {
      findings.push(
        makeFinding({ file, line: idx + 1, matchedText: lineText.trim() })
      );
    }
  });

  return findings;
}
