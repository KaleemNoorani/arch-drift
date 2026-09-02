import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { findFiles } from '../../lib/walk.js';
import { lineAt } from '../../lib/text.js';
import { makeFinding } from '../../lib/finding.js';
import { maskOpaqueRegions, findMethodBodyRange } from '../../lib/phpMask.js';

export const type = 'method_body_forbids';

/**
 * PHP only. This checker type is inherently per-language: correctly scoping
 * a method's body means recognizing that language's string/comment literal
 * shapes (see src/lib/phpMask.js), and there is no shared implementation
 * across languages here by construction. A second language (e.g.
 * method_scope/js.js for JS/TS) would need its own sibling file with its
 * own opaque-region scanner -- there is nothing to generalize, because a
 * JS template literal, a Python triple-quoted string, and a PHP heredoc are
 * different lexical problems that happen to rhyme.
 *
 * params: { method: string, class?: string, patterns: string[], scope: string[] }
 *
 * `class` (optional) disambiguates when more than one class/trait/interface
 * in the same file defines a same-named method -- method-to-class
 * attribution is by innermost enclosing scope, so a class conditionally
 * declared inside a function is its own scope, not its outer class's, even
 * though its text falls inside the outer class's braces. If `class` is
 * given but no class with that name exists in the file, that's config
 * drift (a typo, a rename) and is unresolvable, not a silent no-op --
 * matching the fail-safe below. Anonymous classes (`new class { ... }`,
 * e.g. every Laravel migration) are their own scope but have no name, so
 * they can never be targeted by `class`, and two anonymous classes in one
 * file both defining the same method name can never be disambiguated by
 * any config -- see the fixture for exactly this case.
 *
 * Fail-safe: if the target method's body can't be confidently bounded --
 * an unterminated string/comment/heredoc anywhere in the file, more than
 * one method with the given name resolving to the same scope, unbalanced
 * braces before EOF, or a named `class` that doesn't exist in the file --
 * the file is never scanned for a violation. It's reported via
 * ctx.recordUnresolvable and skipped. This checker never guesses a
 * boundary; a coverage hole is the acceptable failure mode, a false
 * violation is not.
 */
export async function check(params, invariant, ctx) {
  const { method, class: className, patterns, scope } = params;
  const files = await findFiles(ctx.targetDir, scope, []);
  ctx.recordMatchedCount?.(files.length);

  const findings = [];

  for (const rel of files) {
    const absPath = path.join(ctx.targetDir, rel);
    const content = await readFile(absPath, 'utf8');

    const { masked, unresolvable: maskUnresolvable, kind: maskUnresolvableKind } = maskOpaqueRegions(content);
    if (maskUnresolvable) {
      ctx.recordUnresolvable?.(rel, maskUnresolvable, maskUnresolvableKind);
      continue;
    }

    const boundary = findMethodBodyRange(masked, method, className ?? null);

    if (boundary.status === 'not_found') continue; // method not in this file (or not in the named class) -- nothing to check here

    if (boundary.status === 'ambiguous' || boundary.status === 'unresolvable') {
      ctx.recordUnresolvable?.(rel, boundary.reason, boundary.kind);
      continue;
    }

    // boundary.status === 'ok'
    const { bodyStart, bodyEnd } = boundary;
    const declLineNum = lineAt(content, bodyStart);
    const realLines = content.slice(bodyStart, bodyEnd).split(/\r\n|\r|\n/);
    const maskedLines = masked.slice(bodyStart, bodyEnd).split(/\r\n|\r|\n/);

    realLines.forEach((realLine, idx) => {
      const maskedLine = maskedLines[idx];
      for (const pattern of patterns) {
        if (maskedLine.includes(pattern)) {
          findings.push(
            makeFinding({
              file: rel,
              line: declLineNum + idx,
              matchedText: realLine.trim(),
            })
          );
        }
      }
    });
  }

  return findings;
}
