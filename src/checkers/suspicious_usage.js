import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { findFiles } from '../lib/walk.js';
import { lineAt } from '../lib/text.js';
import { makeFinding } from '../lib/finding.js';
import { buildExceptGroups, partitionByExcept } from '../lib/exclusions.js';

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

// A "word character" is a Unicode letter, Unicode number, or underscore.
const WORD_CHAR = /^[\p{L}\p{N}_]$/u;

function isWordCodePoint(cp) {
  return cp !== undefined && WORD_CHAR.test(String.fromCodePoint(cp));
}

/** Code point that ends just before UTF-16 index i, or undefined at the start of the text. */
function codePointBefore(content, i) {
  if (i <= 0) return undefined;
  const lo = content.charCodeAt(i - 1);
  if (lo >= 0xdc00 && lo <= 0xdfff && i >= 2) {
    const hi = content.charCodeAt(i - 2);
    if (hi >= 0xd800 && hi <= 0xdbff) return content.codePointAt(i - 2);
  }
  return content.codePointAt(i - 1);
}

/** Last code point of a string (surrogate-pair aware). */
function lastCodePoint(str) {
  const chars = Array.from(str);
  return chars[chars.length - 1].codePointAt(0);
}

/**
 * True if the literal `pattern`, found at UTF-16 `index` in the FULL `content`,
 * sits on word boundaries. Each edge is judged independently, and only when the
 * pattern's own edge character is a word character. Neighbours are read from the
 * full source, never from a clipped proximity window.
 */
function hasBoundaries(content, index, pattern) {
  if (isWordCodePoint(pattern.codePointAt(0)) && isWordCodePoint(codePointBefore(content, index))) {
    return false;
  }
  if (isWordCodePoint(lastCodePoint(pattern))) {
    const end = index + pattern.length;
    if (end < content.length && isWordCodePoint(content.codePointAt(end))) return false;
  }
  return true;
}

function requireNonEmptyStrings(label, values) {
  for (const v of values) {
    if (typeof v !== 'string' || v.length === 0) {
      throw new Error(`suspicious_usage: ${label} must be a non-empty string`);
    }
  }
}

/**
 * params: { symbol, near: string[], window_chars, scope, word_boundary?: boolean,
 *           except?: Array<string | {paths, reason}> }
 *
 * word_boundary (default false = legacy substring matching) applies to both
 * `symbol` and `near`. When true, matching stays literal and case-sensitive but
 * a pattern whose first/last character is a word character must not be
 * adjacent to another word character in the source.
 */
export async function check(params, invariant, ctx) {
  const { symbol, near, window_chars, scope, except = [], word_boundary = false } = params;
  if (typeof word_boundary !== 'boolean') {
    throw new Error("suspicious_usage: 'word_boundary' must be a boolean if present");
  }
  requireNonEmptyStrings("'symbol'", [symbol]);
  requireNonEmptyStrings("'near' entries", near);

  const scoped = await findFiles(ctx.targetDir, scope, []);
  const { included: files, exclusions } = partitionByExcept(scoped, buildExceptGroups(except));
  ctx.recordExclusions?.(exclusions);
  ctx.recordMatchedCount?.(files.length);
  const findings = [];

  for (const rel of files) {
    const content = await readFile(path.join(ctx.targetDir, rel), 'utf8');
    let occurrences = findAllIndices(content, symbol);
    if (word_boundary) occurrences = occurrences.filter((i) => hasBoundaries(content, i, symbol));

    for (const idx of occurrences) {
      const windowStart = Math.max(0, idx - window_chars);
      const windowEnd = Math.min(content.length, idx + symbol.length + window_chars);
      const window = content.slice(windowStart, windowEnd);

      // Legacy: plain substring inside the window. word_boundary: any occurrence
      // fully inside the window whose boundaries hold in the full file; a later
      // valid occurrence still counts after an earlier invalid one.
      const nearMatch = word_boundary
        ? near.some((p) => findAllIndices(window, p).some((k) => hasBoundaries(content, windowStart + k, p)))
        : near.find((p) => window.includes(p));
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
