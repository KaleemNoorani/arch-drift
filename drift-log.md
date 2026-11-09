# Drift Log

This log records Arch-Drift's own defects and design decisions. The simulated
cases at the end are new, independently designed fixtures; they are not
historical findings from another system. A finding may be a confirmed defect,
a false positive, a deliberate exception, or a justified exclusion. Those
dispositions must be based on evidence rather than the desire for a quiet run.

## Direct CLI invocation returned without running

**Source:** Arch-Drift review round 1. **Disposition:** confirmed defect,
fixed.

`src/cli.js` exported `main()` but did not invoke it when run directly.
`node src/cli.js --config ... --target ...` therefore returned with no report
and exit code 0. The package binary worked. An invocation guard and a CLI
test now cover both entrypoints. This was a project-internal delivery defect.

## The documented JSON flag was absent

**Source:** Arch-Drift review round 1. **Disposition:** confirmed defect,
fixed.

The initial CLI did not accept `--json`, despite the intended interface.
Executing the binary with that flag would have failed argument parsing. The
fix added a versioned JSON report and a CLI test that invokes the actual
binary. Public documentation should be checked with executable examples.

## A historical README claim exceeded its evidence

**Source:** Arch-Drift's own documentation review. **Disposition:**
documentation defect, corrected in later drafts and removed from current
public examples.

An early case-study paragraph stated a precise result without checking its
underlying run artifact. A subsequent correction also needed verification.
That is a project-internal reporting error, but the old result describes an
external codebase and is intentionally not repeated here. The replacement
walkthrough makes no real-system measurement claim. Any future synthetic
count should be generated from the committed fixture, not carried by memory.

## A substring was mistaken for a lookup pattern

**Source:** Arch-Drift's static fixture suite. **Disposition:** known false
positive; addressed by an opt-in option (see the resolution below), with the
default behavior deliberately unchanged.

The `suspicious_usage` checker uses substring proximity. In a synthetic
fixture, the word `nowhere` contains the pattern `where`; a nearby display
field can therefore be reported even without a lookup call. Word-boundary
matching could address this specific case, but changing the matching rule
requires separate behavior tests. This remains a checker limitation, not an
observation about an external system.

**Resolution:** `suspicious_usage` accepts an optional boolean
`word_boundary`. Absent or `false`, matching is exactly the legacy
case-sensitive substring behavior, so existing configs are unaffected and the
false positive still occurs for them. With `true`, `symbol` and `near` are
matched as literals with Unicode word boundaries (`[\p{L}\p{N}_]`, read by code
point); each pattern edge is constrained only if its own edge character is a
word character, and neighbours come from the full file rather than the
`window_chars` slice, so a clipped token cannot become a whole-word match. The
same change fixed a separate defect: an empty `symbol` or `near` string made
the occurrence scan loop forever. Empty and non-string patterns are now a
reported check error (exit 2) in both modes, as is a non-boolean
`word_boundary`. Report schema 3 and `matchedText` are unchanged.

**Remaining limitations:** boundaries are judged only at a pattern's two outer
edges, so a compound pattern such as `where find` is not checked word by word
inside. A combining mark (Unicode category `M`) next to a pattern is not a
word character, so `where` followed by a combining accent still matches. This
is still lexical matching, not parsing, and cannot tell a lookup call from a
word that merely appears near the symbol.

## Method-scoped checking uses a PHP lexical scanner

**Source:** Arch-Drift's `method_body_forbids` design review. **Disposition:**
design decision, not a finding.

A method-level rule needs a reliable body boundary. The implementation masks
PHP strings, comments, heredocs, and nowdocs before locating the named
method. It does not parse PHP expressions or control flow. If it cannot
resolve a boundary or class attribution, it reports `unresolvable` and skips
that file. A future parser-backed design would have to be evaluated against
the same explicit coverage and failure contract; the current public checker
remains PHP-specific and dependency-light.

## Schema 3 records unresolvable kind

**Source:** Arch-Drift's report-shape review. **Disposition:** design
decision, not a finding.

The project added `unresolvable[].kind` with `config_drift`, `ambiguous`,
and `scanner_limitation` alongside the human-readable reason. A consumer can
branch on the versioned enum without parsing prose. The check-level
`unresolvable` count stays visible even when the same check has confirmed
findings. The review did not add speculative fields for contextual notes or
resolved class names. Schema 3 remains unchanged in this remediation.

## New synthetic disposition exercise

**Source:** Newly designed community-museum fixture in `test/fixtures/`.
**Disposition:** simulation only.

The fictional preview-cache rule allows an administrator's cache reset but
reports cache invalidation inside a preview-rendering method. The fixture
also places matching text in comments, strings, heredoc, and nowdoc bodies;
those are not executable calls and must not create findings. A separate
deliberately malformed file demonstrates `unresolvable` without a false
violation. These outcomes are test expectations, not measurements of a real
deployment. The README walkthrough can be reproduced against the committed
synthetic fixture.
