import path from 'node:path';
import { existsSync } from 'node:fs';
import { readLines } from '../lib/text.js';
import { makeFinding } from '../lib/finding.js';

export const type = 'forbidden_dependency';

/**
 * params: { manifests: string[], packages: string[] }
 * Checks manifest files at the target root (not recursive) for any forbidden
 * package name appearing as a quoted string (dependency-declaration shape).
 */
export async function check(params, invariant, ctx) {
  const { manifests, packages } = params;
  const findings = [];
  let matchedManifests = 0;

  for (const manifestName of manifests) {
    const absPath = path.join(ctx.targetDir, manifestName);
    if (!existsSync(absPath)) continue;
    matchedManifests++;

    const lines = await readLines(absPath);
    lines.forEach((lineText, idx) => {
      for (const pkg of packages) {
        if (lineText.includes(`"${pkg}"`)) {
          findings.push(
            makeFinding({ file: manifestName, line: idx + 1, matchedText: lineText.trim() })
          );
        }
      }
    });
  }

  ctx.recordMatchedCount?.(matchedManifests);
  return findings;
}
