import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { findFiles } from '../lib/walk.js';
import { lineAt } from '../lib/text.js';
import { makeFinding } from '../lib/finding.js';

export const type = 'method_not_empty';

function stripComments(body) {
  return body
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .trim();
}

/** Brace-matched extraction of the named method's body. Returns null if not found. */
function extractMethodBody(content, method) {
  const declRe = new RegExp(`function\\s+${method}\\s*\\([^)]*\\)[^{]*\\{`);
  const m = content.match(declRe);
  if (!m) return null;

  const braceStart = m.index + m[0].length; // position after the opening '{'
  let depth = 1;
  let i = braceStart;
  for (; i < content.length && depth > 0; i++) {
    if (content[i] === '{') depth++;
    else if (content[i] === '}') depth--;
  }
  if (depth !== 0) return null; // unbalanced — bail out rather than guess

  return { body: content.slice(braceStart, i - 1), declIndex: m.index };
}

function isOnlyThrow(strippedBody) {
  if (!/^throw\b/.test(strippedBody)) return false;
  const statements = strippedBody.split(';').map((s) => s.trim()).filter(Boolean);
  return statements.length === 1;
}

/** params: { scope: string[], method: string, fails_if: string[] } */
export async function check(params, invariant, ctx) {
  const { scope, method, fails_if } = params;
  const files = await findFiles(ctx.targetDir, scope, []);
  const findings = [];

  for (const rel of files) {
    const absPath = path.join(ctx.targetDir, rel);
    const content = await readFile(absPath, 'utf8');
    const extracted = extractMethodBody(content, method);
    if (!extracted) continue; // method not present in this file — nothing to check

    const stripped = stripComments(extracted.body);
    const line = lineAt(content, extracted.declIndex);

    let failed = false;
    let reason = '';

    if (fails_if.includes('empty_body') && stripped === '' && extracted.body.trim() === '') {
      failed = true;
      reason = 'empty_body';
    } else if (fails_if.includes('only_comments') && stripped === '' && extracted.body.trim() !== '') {
      failed = true;
      reason = 'only_comments';
    } else if (fails_if.includes('throws') && isOnlyThrow(stripped)) {
      failed = true;
      reason = 'throws';
    }

    if (failed) {
      findings.push(
        makeFinding({
          file: rel,
          line,
          matchedText: `${method}() — ${reason}`,
        })
      );
    }
  }

  return findings;
}
