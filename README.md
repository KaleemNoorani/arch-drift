# arch-drift

A lexical architecture-drift checker. It reads a declarative `architecture.json`
describing a codebase's architectural invariants, runs checks against a target
codebase, and reports violations. It never modifies the target and never
modifies `architecture.json` — a human owns that file; the tool only verifies
reality against it.

## Usage

```
node bin/drift-check.js --config <path-to-architecture.json> --target <path-to-codebase>
```

Both flags are required; there is no default target (it never falls back to
the current directory). `bin/drift-check.js` is the entrypoint declared in
`package.json`'s `bin` field and is canonical; `node src/cli.js` (same flags)
works identically since it's the same module with an invocation guard, not a
second, different entrypoint.

Exit codes:

- `0` — clean, no unsuppressed violations
- `1` — at least one unsuppressed violation-severity finding
- `2` — tool/config error (malformed invariant, unreadable target, unknown
  checker type). Errors dominate violations because they mean the run was
  incomplete, not merely that it found problems.

### `--json`

Pass `--json` for a stable, versioned JSON contract instead of the human
report, meant for external tooling (e.g. a Claude Code plugin) to consume:

```
{
  "schemaVersion": "2",
  "exitCode": 0 | 1 | 2,
  "phase": "...",
  "summary": { "violations", "advisories", "suppressed", "errors", "knowledge", "exclusions" },
  "violations": [ { invariantId, checkId, severity, rationale, file, line, matchedText } ],
  "advisories": [ ...same shape... ],
  "exemptions": {
    "suppressed": [ { ...finding, exemption: { invariant, paths, reason, validThrough, granted } } ],
    "rows": [ { invariant, paths, reason, validThrough, granted, status, suppressedCount } ]
  },
  "exclusions": [ { invariantId, checkId, reason, count } ],
  "errors": [ { invariantId, checkId, message } ],
  "knowledge": [ { id, kind, claim, rationale, status, ... } ],
  "invariants": [
    {
      id, severity, phases,
      "status": "violated" | "advisory_only" | "clean" | "no_targets_matched" | "skipped_by_phase",
      "checks": [ { checkId, type, status, matchedFiles, findings } ]
    }
  ]
}
```

`schemaVersion` bumps on any change to this shape, breaking or additive, so
a consumer can tell when it's moved. Exit code is duplicated at the top
level and as the process exit code, so a consumer can read either.
`invariants[].checks[].status` can also be `error` (the check didn't
complete) in addition to the invariant-level five; `matchedFiles`/`findings`
are `null` for `skipped_by_phase` and `error` checks, since neither ran to
produce a real count.

## v1 scope

Checks are **lexical only** — reading files as text, regexing, and globbing.
No AST parser, no language-parsing dependency. Where a check can't reliably
express an invariant without one, that's a documented `known_gap`, not
something v1 tries to solve.

Dependencies: [`picomatch`](https://github.com/micromatch/picomatch) for glob
matching. No ripgrep, no other external binaries — file walking uses Node's
built-in `fs.readdir(..., { recursive: true })`.

## Checker types

Each checker lives in its own file under `src/checkers/`; adding a new type
means adding a file there, not editing a dispatch switch (see
`src/checkers/index.js`, which auto-discovers modules in its own directory).

| type | what it does |
| --- | --- |
| `forbidden_call` | flags scoped files containing any of a list of literal call patterns |
| `forbidden_dependency` | flags forbidden package names appearing in root-level manifest files |
| `config_value_allowlist` | extracts a key's literal value from a PHP config file and checks it against an allowlist |
| `method_not_empty` | brace-matched extraction of a named method body; flags empty/comment-only/throws-only bodies, unless the body carries an `escape_marker` annotation |
| `handler_present` | flags files missing any of a set of handling patterns, and separately flags occurrences of specific risky patterns |
| `suspicious_usage` | proximity heuristic: flags a symbol appearing within N characters of any of a set of patterns |

Each checker exports `type` (string) and `async check(checkParams, invariant, ctx)`,
returning an array of `{ file, line, matchedText }`. `ctx` also carries
`recordExclusions(rows)`, which `forbidden_call` and `suspicious_usage` call
to report which `except` entries suppressed files and how many (see
`except` below) — this doesn't affect their return value.

### `except`: named exclusions

`forbidden_call` and `suspicious_usage` both take an `except` list. Each
entry is either a bare glob string (no justification recorded) or
`{ "paths": [...], "reason": "..." }` (a named exclusion). Both forms can be
mixed in the same list. Named exclusions and their per-run match counts
print in the report's **Exclusions** section — the point is that an
exclusion's reason should survive as long as the exclusion does; an opaque
path glob doesn't carry its own justification forward the way a `reason`
string does.

### `method_not_empty`'s `escape_marker`

An optional literal annotation string (e.g. `"@architecturally-irreversible"`).
If it appears anywhere in the method's raw body, the check passes
regardless of `fails_if` — a human-declared, on-the-record exception to the
rule itself, distinct from an `exemptions[]` entry (which suppresses a
violation after the fact). The marker is trusted on presence only: the
checker has no way to verify the claim behind it is true.

## architecture.json shape

- `phase` / `phases`: the document's current phase, and the ordered list of
  all phases. An invariant's own `phases` array (if present) filters when it's
  active; absent means always active.
- `invariants[]`: each has `id`, `severity` (`violation` | `advisory`,
  defaults to `violation`), `rationale`, and a `checks[]` array — one or more
  independent detection strategies for the *same* atomic invariant (not a way
  to bundle unrelated assertions; those get separate invariant ids). Each
  check may carry its own `known_gap`; if absent, the invariant-level
  `known_gap` applies to all its checks.
- `exemptions[]`: `{ invariant, paths?, reason, valid_through, granted }`.
  Matches by invariant id (required) and optional path globs (absent means
  all findings for that invariant). `valid_through` names a phase; the
  exemption is valid through that phase and expires once the current phase
  moves *strictly past* it — not at it. An expired exemption still prints in
  the exemptions section marked `EXPIRED`; its finding is evaluated normally
  from then on, so it drives exit code 1 exactly when its invariant is
  violation-severity.
- `knowledge[]`: documented architectural claims that aren't necessarily
  machine-checkable. An entry with a `checks[]` array runs through the same
  pipeline as an invariant. An entry with `status: "unconfirmed"` always
  prints in the report's Knowledge section (marked `UNCONFIRMED`), whether or
  not it has checks — that's the surface meant to stop an unverified
  assumption from quietly becoming load-bearing. Entries without `checks` are
  documentary only and always print there too.

See [`examples/architecture.json`](examples/architecture.json) for a full
worked example.

## Report format

Seven sections: **Violations**, **Advisories**, **Active Exemptions**,
**Exclusions**, **Errors**, **Knowledge**, **Invariant Status**. Every
finding shows its invariant id, `file:line`, the matched text, and the
invariant's `rationale` verbatim. Advisories never affect the exit code.
Pass `--json` for the same data as a stable, versioned JSON contract (see
`--json` above) instead of this text report.

**Invariant Status** exists because an invariant that produced zero findings
is otherwise invisible in the report — and "ran clean" and "never actually
ran" look identical without it. Each invariant gets one line with its
overall status, and one line per check with how many files it matched and
how many findings came out:

- `violated` / `advisory_only` — produced findings, matching its severity
- `clean` — ran, matched files, found nothing
- `no_targets_matched` — ran, but its `scope` matched zero files (a typo'd
  pattern or an exhausted convention look identical to this on their own —
  that's the case this status exists to catch)
- `skipped_by_phase` — filtered out before running by the current `phase`
- `error` — the check didn't complete (e.g. an unknown checker `type`)

An invariant with multiple `checks[]` rolls up to the worst status across
them (worst-to-best: `error` > `violated` > `advisory_only` >
`no_targets_matched` > `clean`), so one silently-broken check doesn't hide
behind a sibling that matched real files.

## Case study: translating a real codebase's constraints

This tool was validated once against a real, unrelated production-track
codebase's own plain-English architecture constraints (not the illustrative
`examples/architecture.json` above). The translation pass classified every
prose rule into one of three buckets before writing a single check:

1. **Agent behavioral policy** — process rules that leave no artifact in a
   file tree ("pause before destructive ops," "don't claim done without a
   real run," "ask before guessing at a physical fact"). These are not
   drift-checkable by construction; a tool that inspects source files has
   nothing to look at. Out of scope, not a v1 gap.
2. **Codebase invariant** — provable from the file tree. These become
   `checks[]`.
3. **Declared knowledge** — source-of-truth decisions, identifier hazards,
   name collisions, unconfirmed assumptions. These go in `knowledge[]`, with
   a `checks[]` block only where a genuine lexical shadow exists to check
   against; otherwise documentary only.

**Measured ratio from that pass**: of the rules that were candidate codebase
invariants, 6 translated cleanly into one or more of the six checker types;
3 were explicitly refused rather than approximated, each for a distinct,
generalizable reason:

- **A creation-boundary invariant** (only one designated path may create a
  given kind of row) failed because the target codebase's real business
  logic lives inside one large shared service class rather than being
  file-separable — the one legitimate write site and everything else share
  a file, so no glob-based `except` can carve out "this one method" from
  "the rest of this file." **Lesson: `forbidden_call`'s scoping is
  file-granular, not method-granular — an invariant that depends on a
  method boundary inside a shared file cannot be expressed in v1, and
  approximating it (excepting the whole file) would silently stop checking
  the exact thing the invariant cares about.**
- **A cross-surface parity invariant** (two symbol sets defined in separate
  files, in separate languages, must agree) had no home in any of the six
  checker types, because every checker evaluates a single file or a single
  scope against a pattern — none diff two independently-discovered sets
  against each other. **Lesson: v1 has no set-comparison primitive; this is
  the strongest signal for what a v2 checker type would need to add.**
- **A UI-correctness invariant** ("every displayed reference to another
  entity must be a real link, never static text") required knowing what a
  rendered value *represents*, not just matching text against it — an AST
  or template-semantics problem, not a lexical one. **Lesson: this class of
  invariant is out of reach for a lexical-only tool regardless of checker
  design; it needs a parser, not a new pattern type.**

Running the resulting config against the real target produced 25 violations
and 2 advisories on the first run, all real (not tool artifacts): several
were deliberate, already-justified exceptions (migrations correctly marked
irreversible in a comment, with no bug); most were genuine, previously
un-tracked drift from an established convention. One advisory-level
`suspicious_usage` hit initially looked like the exact hazard the knowledge
entry warned about, but reading the surrounding contract (a docblock plus a
sibling method's matching pattern) showed the lookup was intentional and
correct — confirming that `suspicious_usage` findings are a starting point
for a human/model to read code around, not a verdict on their own. A
`suspicious_usage` check predicted to fire (on a string match found during
translation) came back clean on the real run, because the match wasn't
within the proximity window of an actual import/instantiation pattern —
correct behavior, and a reminder that grep-during-translation and
grep-with-context-during-checking can disagree.

**Takeaway**: three honest refusals during translation, rather than three
approximated checks that would have fired on the wrong thing, is the
intended failure mode of this tool. A check that's silently wrong is worse
than an invariant that's silently unchecked.

## Development

```
npm install
npm test
```

`test/fixtures/` is a small, permanent PHP/JS target tree plus two
`architecture.json` variants that exercise every checker type, both
exemption states (active-and-suppressing, expired, active-but-unused), the
error path, and every knowledge-section combination. It's the test suite, not
throwaway scaffolding — re-run it whenever checker behavior changes.
