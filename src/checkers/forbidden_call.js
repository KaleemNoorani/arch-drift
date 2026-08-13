import path from 'node:path';
import { findFiles } from '../lib/walk.js';
import { readLines } from '../lib/text.js';
import { makeFinding } from '../lib/finding.js';
import { buildExceptGroups, partitionByExcept } from '../lib/exclusions.js';

export const type = 'forbidden_call';

/**
 * params: { patterns: string[], scope: string[], except?: Array<string | {paths, reason}> }
 * Flags any line containing one of the literal patterns.
 */
export async function check(params, invariant, ctx) {
  const { patterns, scope, except = [] } = params;
  const scoped = await findFiles(ctx.targetDir, scope, []);
  const { included: files, exclusions } = partitionByExcept(scoped, buildExceptGroups(except));
  ctx.recordExclusions?.(exclusions);
  const findings = [];

  for (const rel of files) {
    const lines = await readLines(path.join(ctx.targetDir, rel));
    lines.forEach((lineText, idx) => {
      for (const pattern of patterns) {
        if (lineText.includes(pattern)) {
          findings.push(
            makeFinding({ file: rel, line: idx + 1, matchedText: lineText.trim() })
          );
        }
      }
    });
  }
  return findings;
}
