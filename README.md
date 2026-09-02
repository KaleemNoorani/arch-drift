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
  "schemaVersion": "3",
  "exitCode": 0 | 1 | 2,
  "phase": "...",
  "summary": { "violations", "advisories", "suppressed", "errors", "knowledge", "exclusions", "unresolvable" },
  "violations": [ { invariantId, checkId, severity, rationale, file, line, matchedText } ],
  "advisories": [ ...same shape... ],
  "exemptions": {
    "suppressed": [ { ...finding, exemption: { invariant, paths, reason, validThrough, granted } } ],
    "rows": [ { invariant, paths, reason, validThrough, granted, status, suppressedCount } ]
  },
  "exclusions": [ { invariantId, checkId, reason, count } ],
  "unresolvable": [ { invariantId, checkId, file, reason, "kind": "config_drift" | "ambiguous" | "scanner_limitation" } ],
  "errors": [ { invariantId, checkId, message } ],
  "knowledge": [ { id, kind, claim, rationale, status, ... } ],
  "invariants": [
    {
      id, severity, phases,
      "status": "violated" | "advisory_only" | "clean" | "no_targets_matched" | "unresolvable" | "skipped_by_phase",
      "checks": [ { checkId, type, status, matchedFiles, findings, unresolvable } ]
    }
  ]
}
```

`schemaVersion` bumps on any change to this shape, breaking or additive, so
a consumer can tell when it's moved (bumped 2 → 3 for `unresolvable[]` and
the `unresolvable` status/count). Exit code is duplicated at the top level
and as the process exit code, so a consumer can read either.
`invariants[].checks[].status` can also be `error` (the check didn't
complete) in addition to the invariant-level six; `matchedFiles`/
`findings`/`unresolvable` are all `null` for `skipped_by_phase` and `error`
checks, since none of them ran to produce a real count.

`unresolvable[]` follows the same precedent as `exclusions[]`: an additive
array, populated only by checkers that can produce this outcome
(`method_body_forbids` today), reported alongside `violations[]`. **A
consumer that only reads `violations[]` sees nothing new here and is
unaffected**, but a file appearing in `unresolvable[]` was never scanned
for that check; its absence from `violations[]` is not evidence it's
clean.

Each entry carries both `kind` and `reason`, deliberately not one or the
other: `kind` is a fixed enum for machines to branch on, `reason` stays
free-text prose for whoever's reading the report. Do not try to derive one
from the other — `reason` will get reworded for clarity over time and is
not itself part of this contract, only its presence is; `kind` is what's
actually versioned. There are exactly three values today:

- `config_drift` — a `class` param names something that no longer exists
  in the file (a typo, a rename). The one kind that's about the config
  being stale, not the code being ambiguous or the scanner falling short.
- `ambiguous` — the code has more than one legitimate candidate (two
  classes sharing a method name, one or more of them anonymous, or a
  literal duplicate) and nothing in the config picks one.
- `scanner_limitation` — the hand-written scanner (not a parser; see
  `method_body_forbids` below) couldn't bound a brace or a literal region
  at all — an unterminated string, comment, or heredoc.

**A consumer built against this version that encounters a `kind` value it
doesn't recognize in some future schema version must treat it at least as
seriously as `config_drift`** — the most action-demanding of the three,
today — never as safe to ignore and never as a reason to throw. That's
what lets this enum grow later (a version bump, same as any other change
here) without silently breaking whatever's already reading it.

Unlike `exclusions[]`, this *does* reach into the status contract, on
purpose: `invariants[].checks[].unresolvable` is a count that rides on the
**same check object** as `matchedFiles`/`findings`, always present
(default `0`) once a check has actually run. If a check has zero findings
and one or more unresolvable files, its status is `unresolvable`, never
silently `clean` — a check that scanned nothing real is not the same thing
as a check that scanned everything and passed. If a check has *both* real
findings and unresolvable files, its status stays `violated`/
`advisory_only` (a confirmed problem still outranks an unknown), but the
nonzero `unresolvable` count stays on that same check object — a consumer
reading only the status word for a `violated` check would otherwise miss
that some files in scope were never actually checked. Rank order,
worst-to-best: `error` > `violated` > `advisory_only` > `unresolvable` >
`no_targets_matched` > `clean`. arch-drift's own exit code still does not
change for `unresolvable` — that stays a signal in the data, not a gate
arch-drift enforces itself (see `method_body_forbids`'s fail-safe below;
a consumer that needs to gate on it, e.g. a pre-merge hook, should read
this field directly).

## v1 scope

Checks are **lexical only** — reading files as text, regexing, and globbing.
No AST parser, no language-parsing dependency. Where a check can't reliably
express an invariant without one, that's a documented `known_gap`, not
something v1 tries to solve.

**One qualification to that claim**: `method_body_forbids` (see below) uses
a hand-written lexical scanner to safely bound a method's body — it still
isn't a parser (no grammar, no AST, no notion of PHP semantics), but it is
a real PHP tokenizer, and it is PHP-only, not language-agnostic like the
other six checker types. Stating this plainly rather than letting a reader
assume otherwise: a checker type that quietly only works on one language,
in a tool that markets itself as language-agnostic, is the same failure
shape as a config that's silently missing.

Dependencies: [`picomatch`](https://github.com/micromatch/picomatch) for glob
matching. No ripgrep, no other external binaries — file walking uses Node's
built-in `fs.readdir(..., { recursive: true })`.

## Checker types

Each checker lives in its own file under `src/checkers/`; adding a new type
means adding a file there, not editing a dispatch switch (see
`src/checkers/index.js`, which auto-discovers modules in its own directory
**and one level of subdirectories** — a subdirectory groups per-language
siblings of one checker family, e.g. `method_scope/php.js`; it is not a
namespacing convention for anything else).

| type | what it does |
| --- | --- |
| `forbidden_call` | flags scoped files containing any of a list of literal call patterns |
| `forbidden_dependency` | flags forbidden package names appearing in root-level manifest files |
| `config_value_allowlist` | extracts a key's literal value from a PHP config file and checks it against an allowlist |
| `method_not_empty` | brace-matched extraction of a named method body; flags empty/comment-only/throws-only bodies, unless the body carries an `escape_marker` annotation |
| `handler_present` | flags files missing any of a set of handling patterns, and separately flags occurrences of specific risky patterns |
| `suspicious_usage` | proximity heuristic: flags a symbol appearing within N characters of any of a set of patterns |
| `method_body_forbids` | **PHP only** (`src/checkers/method_scope/php.js`) — flags forbidden call patterns inside one named method's body specifically, leaving the same call elsewhere in the file alone. See below. |

Each checker exports `type` (string) and `async check(checkParams, invariant, ctx)`,
returning an array of `{ file, line, matchedText }`. `ctx` also carries
`recordExclusions(rows)`, which `forbidden_call` and `suspicious_usage` call
to report which `except` entries suppressed files and how many (see
`except` below); and `recordUnresolvable(file, reason)`, which
`method_body_forbids` calls when a file's method boundary can't be
confidently bounded (see below). Neither call affects the checker's return
value.

### `method_body_forbids`: method-scoped forbidden calls (PHP only)

Motivating case: a shared service class has one method where deleting a
row breaks an audit trail, and two other methods, in the *same file*, that
legitimately delete from the same table for unrelated, documented reasons.
`forbidden_call`'s scope is file-granular; it cannot express "forbidden
here, fine three methods down." `method_body_forbids` can:

```json
{
  "type": "method_body_forbids",
  "method": "moveUnit",
  "patterns": ["InventoryUnit::delete(", "->delete()"],
  "scope": ["app/Services/InventoryService.php"]
}
```

It extracts the named method's body and searches only within it. Doing
that safely means recognizing PHP's string, `//`/`#`/`/* */` comment, and
heredoc/nowdoc literal shapes well enough to treat their contents as
opaque — a brace inside a string, or the pattern text itself inside a
comment, must never desync the boundary or produce a match. That
recognition is implemented as a hand-written lexical scanner
(`src/lib/phpMask.js`) — deliberately not a parser: it has no notion of
PHP expressions, control flow, or scoping, only of where PHP goes opaque.

**This is the one checker type that is PHP-only, not language-agnostic.**
A second language would need its own sibling scanner recognizing that
language's own opaque-region shapes (a JS template literal, a Python
triple-quoted string) — there's nothing to generalize, because those are
different lexical problems that happen to rhyme, not one problem with a
language parameter.

**Class attribution, and the optional `class` param.** A same-named method
appearing more than once in one file is not automatically a problem — two
unrelated classes in the same file legitimately having their own
`process()` is routine, valid PHP, not a duplicate declaration. The
scanner attributes every method match to its *innermost* enclosing
class/trait/interface/anonymous-class scope (so a class conditionally
declared inside a function, itself nested in another class's method, is
its own scope, not its outer class's, even though its text falls inside
the outer class's braces). When a method name resolves to more than one
distinct scope, an optional `class` param disambiguates:

```json
{ "type": "method_body_forbids", "method": "process", "class": "PrimaryProcessor", "patterns": [...], "scope": [...] }
```

If `class` names something that doesn't exist anywhere in the file — a
typo, a rename, config drift — that's **unresolvable, not a silent pass**:
a rule that names a class no longer in the file looks configured and
checks nothing, which is the same failure as a missing config, one layer
down. **Anonymous classes** (`new class { ... }` — every Laravel 11
migration is one) are their own scope but have no name, so they can never
be targeted by `class`; two anonymous classes in one file both defining
the same method name is **permanently** unresolvable, not a gap `class`
can close — there's nothing to name.

**Fail-safe, by design**: if a method's boundary can't be confidently
resolved — an unterminated string, comment, or heredoc anywhere in the
file; unbalanced braces before EOF; more than one method resolving to the
same class scope; a named `class` absent from the file; or two+ classes
each defining the method with no `class` param to pick one — the file is
never scanned for a violation. It's reported via `recordUnresolvable` into
`unresolvable[]` (see `--json` above) and the **Unresolvable** report
section, and skipped. A coverage hole is the acceptable outcome here; a
false violation is not.

`known_gap`: this is a hand-written scanner, not the reference PHP
implementation. Genuinely pathological input (nested heredocs with
unusual identifiers, PHP syntax this scanner doesn't yet recognize) may be
reported unresolvable more often than a real parser would need to. One
specific known gap: an anonymous class instantiated with constructor
arguments that themselves contain a brace (`new class(function () { ... })
extends Foo { ... }`) can misidentify the class's own opening brace —
exotic and not seen in real Laravel code, where anonymous classes
(migrations, chiefly) take no constructor arguments at all, but worth
naming rather than implying the scanner handles every syntactically legal
form. That's the traded-off cost of staying dependency-free and
language-scoped to exactly this one checker type; see the design
discussion in [drift-log.md](drift-log.md) for why a parser dependency was
evaluated and not taken.

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

Eight sections: **Violations**, **Advisories**, **Active Exemptions**,
**Exclusions**, **Unresolvable**, **Errors**, **Knowledge**, **Invariant
Status**. Every finding shows its invariant id, `file:line`, the matched
text, and the invariant's `rationale` verbatim. Advisories never affect the
exit code. Pass `--json` for the same data as a stable, versioned JSON
contract (see `--json` above) instead of this text report.

**Unresolvable** lists every file a checker declined to scan because it
couldn't confidently bound what it was looking at (currently produced only
by `method_body_forbids`; see above). It never contributes a violation and
never changes the exit code — that's a deliberate design choice, not an
oversight: arch-drift's own exit code stays a signal about confirmed
findings, and a consumer that needs to treat "some files were unscannable"
as its own gate (a pre-merge hook, for instance) should read this section
or `unresolvable[]` directly rather than infer it from a clean exit.

**Invariant Status** exists because an invariant that produced zero findings
is otherwise invisible in the report — and "ran clean" and "never actually
ran" look identical without it. Each invariant gets one line with its
overall status, and one line per check with how many files it matched, how
many findings came out, and (when nonzero) how many files it couldn't
verify at all:

- `violated` / `advisory_only` — produced findings, matching its severity
- `clean` — ran, matched files, found nothing
- `unresolvable` — ran, matched files, but one or more couldn't be
  confidently verified (currently only `method_body_forbids` produces
  this — see above) and zero findings came from the rest. Never confused
  with `clean`: a check that skipped a file it couldn't verify has not
  demonstrated the same thing as a check that looked at everything and
  found nothing.
- `no_targets_matched` — ran, but its `scope` matched zero files (a typo'd
  pattern or an exhausted convention look identical to this on their own —
  that's the case this status exists to catch)
- `skipped_by_phase` — filtered out before running by the current `phase`
- `error` — the check didn't complete (e.g. an unknown checker `type`)

A check with real findings *and* unresolvable files keeps its
`violated`/`advisory_only` status (a confirmed problem still outranks an
unknown), but its per-check line still shows the unresolvable count
alongside `matched N file(s), M finding(s)` — never only in the separate
**Unresolvable** section below, where it would be easy to fix the
confirmed findings and never notice a file was skipped entirely.

An invariant with multiple `checks[]` rolls up to the worst status across
them (worst-to-best: `error` > `violated` > `advisory_only` >
`unresolvable` > `no_targets_matched` > `clean`), so one silently-broken
check doesn't hide behind a sibling that matched real files.

## Positioning

arch-drift isn't the first tool aimed at architectural drift, and it isn't
trying to be. The adjacent landscape includes at least three distinct
approaches:

- Tools that detect architectural erosion statistically, from signals in
  the codebase (churn, coupling, dependency-graph shape) with no
  user-authored configuration at all — architecture is inferred from
  behavior, not declared.
- Tools that model the intended architecture formally (components, layers,
  allowed relationships) and diff incoming changes against that model —
  architecture-as-code, checked structurally rather than lexically.
- Tools that learn an architectural baseline directly from the current
  state of a repository and flag PRs that deviate from what they've
  learned — the baseline itself is inferred, not authored.

All three infer structure, or detect divergence from a structure they
inferred. arch-drift starts from a different premise: some architectural
decisions exist only because a human made them, not because the codebase
implies them — a boundary drawn on purpose, a rule adopted for a stated
reason, a fact declared true. No amount of structural inference recovers a
decision that isn't visible in the code's current shape; the only way an
agent (or a person) reliably knows it is if it was written down and
checked, not rediscovered. That's the actual difference: preserving
declared intent across a long, agent-assisted build, rather than
discovering or scoring structure.

**The checker is the enforcement half of a three-part contract.** A human
authors the **Decision**; a deterministic check provides the
**Enforcement** for whatever part of it is mechanizable; and `knowledge[]`
carries the **Context** an agent needs to know but can't prove from code.
arch-drift is built to be exactly the middle third — nothing more.

## Case study: translating a real codebase's constraints

This tool was validated once against a real, unrelated production-track
codebase's own plain-English architecture constraints (not the illustrative
`examples/architecture.json` above). The translation pass classified every
prose rule into one of the three roles described above — Decision,
Enforcement, Context — before writing a single check:

1. **Decision** — a human-authored architectural decision that leaves no
   artifact in a file tree ("pause before destructive ops," "don't claim
   done without a real run," "ask before guessing at a physical fact").
   Not drift-checkable by construction; a tool that inspects source files
   has nothing to look at. Out of scope, not a v1 gap.
2. **Enforcement** — the mechanizable part of a decision, provable from the
   file tree. These become `checks[]`.
3. **Context** — what an agent needs to know but can't prove from code:
   source-of-truth decisions, identifier hazards, name collisions,
   unconfirmed assumptions. These go in `knowledge[]`, with a `checks[]`
   block only where a genuine lexical shadow exists to check against;
   otherwise documentary only.

Decision looks like the soft, unenforceable third of the three — no
artifact in a file tree for a lexical tool to look at, filed as out of
scope and left there. In practice it's the third that caught the most.
Every real defect this project itself shipped — `src/cli.js` with no
invocation guard, `--json` claimed done while unimplemented — was exactly
a Decision-layer failure: "don't claim done without a real run," unenforced,
on the tool's own development. No `checks[]` entry would have caught either
one; only running the actual documented command would have. See
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
