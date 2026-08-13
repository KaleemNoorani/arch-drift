import path from 'node:path';
import { findFiles } from '../lib/walk.js';
import { readLines } from '../lib/text.js';
import { makeFinding } from '../lib/finding.js';

export const type = 'handler_present';

/** params: { scope: string[], requires_any: string[], flags?: string[] } */
export async function check(params, invariant, ctx) {
  const { scope, requires_any, flags = [] } = params;
  const files = await findFiles(ctx.targetDir, scope, []);
  const findings = [];

  for (const rel of files) {
    const lines = await readLines(path.join(ctx.targetDir, rel));
    const hasHandler = lines.some((l) => requires_any.some((p) => l.includes(p)));

    if (!hasHandler) {
      findings.push(
        makeFinding({
          file: rel,
          line: 1,
          matchedText: `no handler pattern found (expected one of: ${requires_any.join(', ')})`,
        })
      );
    }

    lines.forEach((lineText, idx) => {
      for (const flag of flags) {
        if (lineText.includes(flag)) {
          findings.push(
            makeFinding({ file: rel, line: idx + 1, matchedText: lineText.trim() })
          );
        }
      }
    });
  }

  return findings;
}
