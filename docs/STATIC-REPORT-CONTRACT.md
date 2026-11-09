# Static report contract

Reference for the static checker's output: the versioned `--json` contract
(`schemaVersion` `"3"`), the status model, and the human-readable report. For a
quick overview, see the [README](../README.md).

## Invocation

```
node bin/drift-check.js --config <path-to-architecture.json> --target <path-to-codebase>
```

Both flags are required; there is no default target (it never falls back to the
current directory). `bin/drift-check.js` is the entrypoint declared in
`package.json`'s `bin` field and is canonical; `node src/cli.js` (same flags)
works identically since it's the same module with an invocation guard, not a
second, different entrypoint.

## `--json`

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
  `method_body_forbids`, see [PHP-METHOD-SCOPE.md](PHP-METHOD-SCOPE.md)) couldn't bound a brace or a literal region
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
arch-drift enforces itself (see `method_body_forbids`'s fail-safe in [PHP-METHOD-SCOPE.md](PHP-METHOD-SCOPE.md);
a consumer that needs to gate on it, e.g. a pre-merge hook, should read
this field directly).


## Report format

Eight sections: **Violations**, **Advisories**, **Active Exemptions**,
**Exclusions**, **Unresolvable**, **Errors**, **Knowledge**, **Invariant
Status**. Every finding shows its invariant id, `file:line`, the matched
text, and the invariant's `rationale` verbatim. Advisories never affect the
exit code. Pass `--json` for the same data as a stable, versioned JSON
contract (see [`--json`](#--json)) instead of this text report.

**Unresolvable** lists every file a checker declined to scan because it
couldn't confidently bound what it was looking at (currently produced only
by `method_body_forbids`; see [PHP-METHOD-SCOPE.md](PHP-METHOD-SCOPE.md)). It never contributes a violation and
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
  this — see [PHP-METHOD-SCOPE.md](PHP-METHOD-SCOPE.md)) and zero findings came from the rest. Never confused
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

