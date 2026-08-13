import picomatch from 'picomatch';

/**
 * An except[] entry is either a bare glob string (no justification recorded)
 * or { paths: string|string[], reason: string } — a named exclusion.
 * Anonymous path globs are still supported so simple cases stay simple, but
 * a named reason is how an exclusion survives long enough to still make
 * sense a year later.
 */
export function buildExceptGroups(except = []) {
  return except.map((entry) => {
    if (typeof entry === 'string') {
      return { patterns: [entry], reason: null, isMatch: picomatch([entry]) };
    }
    const patterns = Array.isArray(entry.paths) ? entry.paths : [entry.paths];
    return { patterns, reason: entry.reason ?? null, isMatch: picomatch(patterns) };
  });
}

/**
 * Splits scoped `files` into { included, exclusions }. `exclusions` has one
 * row per except group that matched at least one file:
 * [{ reason, count }] (reason is null for anonymous glob groups).
 * The first matching group wins if groups overlap.
 */
export function partitionByExcept(files, exceptGroups) {
  const included = [];
  const counts = new Map();

  for (const file of files) {
    const group = exceptGroups.find((g) => g.isMatch(file));
    if (group) {
      counts.set(group, (counts.get(group) ?? 0) + 1);
    } else {
      included.push(file);
    }
  }

  const exclusions = exceptGroups
    .filter((g) => counts.has(g))
    .map((g) => ({ reason: g.reason, count: counts.get(g) }));

  return { included, exclusions };
}
