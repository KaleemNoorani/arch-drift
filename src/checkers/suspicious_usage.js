import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { findFiles } from '../lib/walk.js';
import { lineAt } from '../lib/text.js';
import { makeFinding } from '../lib/finding.js';

export const type = 'suspicious_usage';

function findAllIndices(content, needle) {
  const indices = [];
  let from = 0;
  let i;
  while ((i = content.indexOf(needle, from)) !== -1) {
    indices.push(i);
    from = i + needle.length;
  }
  return indices;
}

/** params: { symbol, near: string[], window_chars, scope, except? } */
export async function check(params, invariant, ctx) {
  const { symbol, near, window_chars, scope, except = [] } = params;
  const files = await findFiles(ctx.targetDir, scope, except);
  const findings = [];

  for (const rel of files) {
    const content = await readFile(path.join(ctx.targetDir, rel), 'utf8');
    const occurrences = findAllIndices(content, symbol);

    for (const idx of occurrences) {
      const windowStart = Math.max(0, idx - window_chars);
      const windowEnd = Math.min(content.length, idx + symbol.length + window_chars);
      const window = content.slice(windowStart, windowEnd);

      const nearMatch = near.find((p) => window.includes(p));
      if (nearMatch) {
        findings.push(
          makeFinding({
            file: rel,
            line: lineAt(content, idx),
            matchedText: window.replace(/\s+/g, ' ').trim(),
          })
        );
      }
    }
  }

  return findings;
}
