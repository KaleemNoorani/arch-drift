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

Bucket 1 looks like the soft, unenforceable half of the three — no artifact
in a file tree for a lexical tool to look at, filed as out of scope and
left there. In practice it's the half that caught the most. Every real
defect this project itself shipped — `src/cli.js` with no invocation guard,
`--json` claimed done while unimplemented — was exactly a bucket-1 failure:
"don't claim done without a real run," unenforced, on the tool's own
development. No `checks[]` entry would have caught either one; only running
the actual documented command would have. See
[drift-log.md](drift-log.md) for both.

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

**Three hand-maintained numbers, three independent drifts.** Across this
section's own drafts, three different counts were carried in prose instead
of read from the actual run output — and all three turned out wrong,
independently, not as one error propagating: an original claim of "25
violations, all real" (the real run-1 total was 24); a first attempt at
correcting that to "23" during this very fact-check (still wrong — also
24); and a working expectation of "~15 real drift sites" going into the
first run (the real, disposed count was 13). Three separate instances of
the same failure mode, not one mistake repeated: a number sat in someone's
head or in a paragraph instead of being read off the artifact, every single
time. One of those three instances was this project's own author correcting
an earlier instance of exactly the same thing and still getting it wrong
until the actual output files were read line by line. That is the whole
premise of this tool, demonstrated on its own documentation before anything
else: re-check ground truth first, every time a number is asserted, not
only when a bug is suspected.

The first real run against the target produced **24 violations and 2
advisories** (26 findings total), verified directly from the saved run
output. Disposed by hand, the 24 violations break down as:

- **13** confirmed live drift — real, previously un-tracked divergence from
  the stated convention; still present, unfixed, in the second run below
- **1** known false positive — a match inside a commented-out line; also
  still present in the second run, unresolved; see drift-log.md
- **6** deliberate, not defects — migrations correctly, intentionally
  irreversible. Six "deliberate" dispositions clustered on one invariant
  turned out to mean the invariant's *definition* was wrong, not that six
  legitimate exceptions existed; see the `reversible-migrations` entry in
  [drift-log.md](drift-log.md) for the fix (a marker convention, not six
  exemptions) — resolved before the second run, absent from it entirely
- **4** legitimately excluded call sites, across **2** files (one file
  contributed 3 of the 4) — properly out of scope, given a named `except`
  reason rather than narrowed to make the run quieter; resolved before the
  second run

The 2 advisories were both the same `suspicious_usage` knowledge check
firing on `order_number` near a lookup construct, in both runs. One was a
low-risk `LIKE` search filter — no action needed. The second, inside an
external partner's webhook handler, looked on first read like the exact
hazard the check exists to catch — and was reclassified after reading the
surrounding contract. That reclassification
(**correct-but-unresolvable-lexically**, not drift) is the single strongest
piece of evidence in this project for why v1 stays lexical rather than
growing an AST layer for this class of invariant; the full writeup is the
external-partner-webhook-reversal entry in [drift-log.md](drift-log.md).

A second run, after the round-1 fixes (the marker convention and the two
named exclusions above), landed at **14 violations and 2 advisories** (16
findings total) — exactly the 13 confirmed-drift plus the 1 unresolved
false positive from run one, with the 6 deliberate migrations and the 4
excluded call sites gone entirely rather than merely suppressed. A more
credible number than the original 25, and for a specific reason: every
figure in this paragraph was read from a saved run artifact, not carried in
prose.

**Takeaway**: three honest refusals during translation, rather than three
approximated checks that would have fired on the wrong thing, is the
intended failure mode of this tool. A check that's silently wrong is worse
than an invariant that's silently unchecked — and that applies as much to
a headline number in this README as it does to a finding in a report.

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
