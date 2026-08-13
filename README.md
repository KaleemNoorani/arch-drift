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
the current directory).

Exit codes:

- `0` — clean, no unsuppressed violations
- `1` — at least one unsuppressed violation-severity finding
- `2` — tool/config error (malformed invariant, unreadable target, unknown
  checker type). Errors dominate violations because they mean the run was
  incomplete, not merely that it found problems.

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
| `method_not_empty` | brace-matched extraction of a named method body; flags empty/comment-only/throws-only bodies |
| `handler_present` | flags files missing any of a set of handling patterns, and separately flags occurrences of specific risky patterns |
| `suspicious_usage` | proximity heuristic: flags a symbol appearing within N characters of any of a set of patterns |

Each checker exports `type` (string) and `async check(checkParams, invariant, ctx)`,
returning an array of `{ file, line, matchedText }`.

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

Five sections: **Violations**, **Advisories**, **Active Exemptions**,
**Errors**, **Knowledge**. Every finding shows its invariant id, `file:line`,
the matched text, and the invariant's `rationale` verbatim. Advisories never
affect the exit code.

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
