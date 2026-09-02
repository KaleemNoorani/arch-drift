/**
 * A hand-written PHP lexical scanner — not a parser. It understands exactly
 * five opaque-region shapes (single/double-quoted strings, // and # line
 * comments, /* block comments, heredoc/nowdoc bodies) well enough to blank
 * their contents out, so that downstream brace-counting and pattern
 * matching never sees a brace, or a forbidden-call pattern, that only
 * exists inside a string or a comment.
 *
 * It does not understand PHP semantics, expressions, or control flow — it
 * has no notion of what a closure, a match arm, or a function even is.
 * That's deliberate: recognizing these five opaque shapes is a bounded,
 * checkable problem; parsing PHP is not, and this file must not grow into
 * one. Anything it can't confidently resolve (an unterminated string,
 * comment, or heredoc) is reported as unresolvable rather than guessed —
 * see the `known_gap` on the method_body_forbids checker.
 */

function scanSingleQuoted(content, start) {
  let i = start + 1;
  while (i < content.length) {
    if (content[i] === '\\') { i += 2; continue; }
    if (content[i] === "'") return i + 1;
    i++;
  }
  return -1;
}

function scanDoubleQuoted(content, start) {
  let i = start + 1;
  while (i < content.length) {
    if (content[i] === '\\') { i += 2; continue; }
    if (content[i] === '"') return i + 1;
    i++;
  }
  return -1;
}

function scanLineComment(content, start) {
  let i = start;
  while (i < content.length && content[i] !== '\n') i++;
  return i;
}

function scanBlockComment(content, start) {
  const end = content.indexOf('*/', start + 2);
  return end === -1 ? -1 : end + 2;
}

const HEREDOC_OPEN_RE = /^<<<[ \t]*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1[ \t]*\r?\n/;

/** Returns the index just after the closing identifier, or -1 if unresolvable. */
function scanHeredoc(content, start) {
  const m = content.slice(start).match(HEREDOC_OPEN_RE);
  if (!m) return -1;

  const identifier = m[2];
  const afterOpenLine = start + m[0].length;
  const closeRe = new RegExp(`^[ \\t]*${identifier}\\b`, 'm');
  const rest = content.slice(afterOpenLine);
  const closeMatch = rest.match(closeRe);
  if (!closeMatch) return -1;

  return afterOpenLine + closeMatch.index + closeMatch[0].length;
}

/**
 * Returns { masked } — a same-length, same-line-structure copy of `content`
 * with every string/comment/heredoc/nowdoc region replaced by spaces
 * (newlines preserved, so line numbers computed from either string agree) —
 * or { unresolvable: reason, kind: 'scanner_limitation' } if an opaque
 * region never closes before EOF. Every unresolvable case this function can
 * produce is the scanner failing to keep up with real PHP, never a config
 * problem, so `kind` is always 'scanner_limitation' here.
 */
export function maskOpaqueRegions(content) {
  const n = content.length;
  const out = content.split('');

  const blank = (from, to) => {
    for (let k = from; k < to; k++) {
      if (out[k] !== '\n') out[k] = ' ';
    }
  };

  let i = 0;
  while (i < n) {
    const ch = content[i];

    if (ch === "'") {
      const end = scanSingleQuoted(content, i);
      if (end === -1) return { unresolvable: `unterminated single-quoted string at offset ${i}`, kind: 'scanner_limitation' };
      blank(i, end);
      i = end;
      continue;
    }
    if (ch === '"') {
      const end = scanDoubleQuoted(content, i);
      if (end === -1) return { unresolvable: `unterminated double-quoted string at offset ${i}`, kind: 'scanner_limitation' };
      blank(i, end);
      i = end;
      continue;
    }
    // '#[' is a PHP 8 attribute, not a comment -- must not be treated as one.
    if (ch === '#' && content[i + 1] !== '[') {
      const end = scanLineComment(content, i);
      blank(i, end);
      i = end;
      continue;
    }
    if (ch === '/' && content[i + 1] === '/') {
      const end = scanLineComment(content, i);
      blank(i, end);
      i = end;
      continue;
    }
    if (ch === '/' && content[i + 1] === '*') {
      const end = scanBlockComment(content, i);
      if (end === -1) return { unresolvable: `unterminated block comment at offset ${i}`, kind: 'scanner_limitation' };
      blank(i, end);
      i = end;
      continue;
    }
    if (ch === '<' && content.slice(i, i + 3) === '<<<') {
      const end = scanHeredoc(content, i);
      if (end === -1) return { unresolvable: `unterminated or unrecognized heredoc/nowdoc at offset ${i}`, kind: 'scanner_limitation' };
      blank(i, end);
      i = end;
      continue;
    }

    i++;
  }

  return { masked: out.join('') };
}

// Matches: `class Foo ... {`, `trait Foo ... {`, `interface Foo ... {`, or
// anonymous `new class ... {` (with optional constructor args — a closure or
// any other brace inside those args is not handled; see known_gap). Requires
// "class"/"trait"/"interface" to be immediately followed by whitespace and an
// identifier (named form) or literal "new class" (anonymous form), which is
// enough to never match `Foo::class` — that's followed by `;`, `,`, `)`,
// whitespace-then-non-identifier, never whitespace-then-identifier-then-`{`.
const CLASS_OPEN_RE =
  /\bclass\s+([A-Za-z_][A-Za-z0-9_]*)[^{]*\{|\b(?:trait|interface)\s+([A-Za-z_][A-Za-z0-9_]*)[^{]*\{|\bnew\s+class\b\s*(?:\([^{}]*\))?[^{]*\{/g;

function closeBraceFrom(masked, braceStart) {
  let depth = 1;
  let i = braceStart;
  while (i < masked.length && depth > 0) {
    if (masked[i] === '{') depth++;
    else if (masked[i] === '}') depth--;
    i++;
  }
  return depth === 0 ? i : -1; // -1 = unresolvable (never closes)
}

/**
 * Finds every class/trait/interface/anonymous-class body in already-masked
 * text. Named ranges carry their identifier; anonymous ranges carry
 * `name: null` — they exist as distinct scopes but can never be targeted by
 * name. Ranges nest freely (a class defined inside a function, an anonymous
 * class instantiated inside a method body).  Returns
 * `{ ranges, unresolvable, kind }` — `unresolvable` is set if any class-like
 * body never closes before EOF (always `kind: 'scanner_limitation'` — the
 * scanner failing to bound a brace pair, never a config problem), in which
 * case `ranges` should not be trusted.
 */
export function findClassRanges(masked) {
  const ranges = [];
  let m;
  CLASS_OPEN_RE.lastIndex = 0;
  while ((m = CLASS_OPEN_RE.exec(masked)) !== null) {
    const name = m[1] ?? m[2] ?? null;
    const braceStart = m.index + m[0].length;
    const bodyEnd = closeBraceFrom(masked, braceStart);
    if (bodyEnd === -1) {
      return {
        ranges: null,
        unresolvable: 'a class/trait/interface/anonymous-class body never closes before end of file',
        kind: 'scanner_limitation',
      };
    }
    ranges.push({ name, declIndex: m.index, bodyStart: braceStart, bodyEnd });
  }
  return { ranges, unresolvable: null, kind: null };
}

/** The smallest (innermost) range in `ranges` that contains `index`, or null. */
function innermostOwner(ranges, index) {
  let best = null;
  for (const r of ranges) {
    if (index >= r.bodyStart && index < r.bodyEnd) {
      if (!best || r.bodyEnd - r.bodyStart < best.bodyEnd - best.bodyStart) best = r;
    }
  }
  return best;
}

/**
 * Finds one named method's body on already-masked text, optionally scoped
 * to a specific class/trait/interface name. Returns one of:
 *   { status: 'not_found' }
 *   { status: 'ambiguous', reason, kind: 'ambiguous' }
 *     -- can't tell which method is meant; refuse to guess. Covers: two+
 *        classes each defining the method with no 'class' param to pick
 *        one (including when one or more is anonymous); two+ methods of
 *        the same name inside one target scope; and two+ classes sharing
 *        the literal name given in 'class'.
 *   { status: 'unresolvable', reason, kind: 'config_drift' }
 *     -- 'class' names a class that doesn't exist anywhere in this file.
 *        The one case that's about the config being stale, not the code
 *        being ambiguous or the scanner falling short.
 *   { status: 'unresolvable', reason, kind: 'scanner_limitation' }
 *     -- a brace (method's own, or an enclosing class's) never closes
 *        before EOF.
 *   { status: 'ok', declIndex, bodyStart, bodyEnd }
 *
 * Method-to-class attribution is by innermost enclosing range, not by "is
 * textually within class X's span" — a class conditionally declared inside a
 * function, itself inside another class's method, is its own scope, not the
 * outer class's, even though its text falls inside the outer class's braces.
 */
export function findMethodBodyRange(masked, methodName, className = null) {
  const declRe = new RegExp(`function\\s+${methodName}\\s*\\([^)]*\\)[^{;]*\\{`, 'g');
  const matches = [...masked.matchAll(declRe)];
  if (matches.length === 0) return { status: 'not_found' };

  const { ranges: classRanges, unresolvable: classUnresolvable, kind: classUnresolvableKind } = findClassRanges(masked);
  if (classUnresolvable) return { status: 'unresolvable', reason: classUnresolvable, kind: classUnresolvableKind };

  const candidates = matches.map((m) => ({ m, owner: innermostOwner(classRanges, m.index) }));

  let selected;

  if (className) {
    const namedRanges = classRanges.filter((r) => r.name === className);
    if (namedRanges.length === 0) {
      return {
        status: 'unresolvable',
        reason: `no class named '${className}' found in this file`,
        kind: 'config_drift',
      };
    }
    if (namedRanges.length > 1) {
      return {
        status: 'ambiguous',
        reason: `${namedRanges.length} classes named '${className}' found in this file -- refusing to guess which one`,
        kind: 'ambiguous',
      };
    }
    const target = namedRanges[0];
    selected = candidates.filter((c) => c.owner === target);
    if (selected.length === 0) return { status: 'not_found' };
    if (selected.length > 1) {
      return {
        status: 'ambiguous',
        reason: `${selected.length} methods named '${methodName}' found inside class '${className}' -- refusing to guess which one`,
        kind: 'ambiguous',
      };
    }
  } else {
    const groups = new Map();
    for (const c of candidates) {
      const key = c.owner ?? '__no_enclosing_class__';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(c);
    }

    if (groups.size > 1) {
      const hasAnonymous = candidates.some((c) => c.owner && c.owner.name === null);
      const reason = hasAnonymous
        ? `${matches.length} methods named '${methodName}' found across ${groups.size} different classes in this file, at least one of them anonymous -- anonymous classes have no name and can never be disambiguated by 'class'`
        : `${matches.length} methods named '${methodName}' found across ${groups.size} different classes in this file -- specify 'class' to disambiguate`;
      return { status: 'ambiguous', reason, kind: 'ambiguous' };
    }

    const onlyGroup = [...groups.values()][0];
    if (onlyGroup.length > 1) {
      return {
        status: 'ambiguous',
        reason: `${onlyGroup.length} methods named '${methodName}' found in the same class -- refusing to guess which one`,
        kind: 'ambiguous',
      };
    }
    selected = onlyGroup;
  }

  const m = selected[0].m;
  const braceStart = m.index + m[0].length;
  const bodyEnd = closeBraceFrom(masked, braceStart);
  if (bodyEnd === -1) {
    return { status: 'unresolvable', reason: 'unbalanced braces before end of file', kind: 'scanner_limitation' };
  }

  return { status: 'ok', declIndex: m.index, bodyStart: braceStart, bodyEnd };
}
