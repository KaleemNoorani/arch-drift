# Checker reference

Scope of the static checker, every checker type, per-checker options, and the
`architecture.json` shape. For the PHP method scanner, see
[PHP-METHOD-SCOPE.md](PHP-METHOD-SCOPE.md); for report output, see
[STATIC-REPORT-CONTRACT.md](STATIC-REPORT-CONTRACT.md).

## Static checker v1 scope

Checks are **lexical only** — reading files as text, regexing, and globbing.
No AST parser, no language-parsing dependency. Where a check can't reliably
express an invariant without one, that's a documented `known_gap`, not
something v1 tries to solve.

**One qualification to that claim**: `method_body_forbids` (see [PHP-METHOD-SCOPE.md](PHP-METHOD-SCOPE.md)) uses
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
| `method_body_forbids` | **PHP only** (`src/checkers/method_scope/php.js`) — flags forbidden call patterns inside one named method's body specifically, leaving the same call elsewhere in the file alone. See [PHP-METHOD-SCOPE.md](PHP-METHOD-SCOPE.md). |

Each checker exports `type` (string) and `async check(checkParams, invariant, ctx)`,
returning an array of `{ file, line, matchedText }`. `ctx` also carries
`recordExclusions(rows)`, which `forbidden_call` and `suspicious_usage` call
to report which `except` entries suppressed files and how many (see
`except` below); and `recordUnresolvable(file, reason)`, which
`method_body_forbids` calls when a file's method boundary can't be
confidently bounded (see [PHP-METHOD-SCOPE.md](PHP-METHOD-SCOPE.md)). Neither call affects the checker's return
value.

### `suspicious_usage`: `word_boundary`

By default `suspicious_usage` matches `symbol` and every `near` entry as plain,
case-sensitive substrings, so `"where"` also matches inside `nowhere`,
`somewhere`, and `whereIn`. Set the optional check-level boolean
`"word_boundary": true` to require whole-token matches:

```json
{ "type": "suspicious_usage", "symbol": "display_slug", "near": ["where", "->on("],
  "window_chars": 60, "scope": ["app/**/*.php"], "word_boundary": true }
```

| source text | default | `word_boundary: true` |
| --- | --- | --- |
| `where` | match | match |
| `nowhere`, `somewhere` | match | no match |
| `whereIn`, `where_`, `where2` | match | no match |
| `->where(` for pattern `->where(` | match | match |

Semantics, which apply to both `symbol` and `near`:

- Matching stays literal (patterns are never regular expressions) and
  case-sensitive.
- A *word character* is a Unicode letter, Unicode number, or underscore
  (`[\p{L}\p{N}_]`). Neighbouring characters are read by Unicode code point,
  so astral letters and digits count and surrogate pairs are never split.
- Each edge of a pattern is judged independently, and only when the pattern's
  own edge character is a word character: such an edge must not be adjacent to
  another word character. Edges that are punctuation (`->where(`, `DB::`) carry
  no constraint, and punctuation inside a pattern (`DB::table`) is matched
  literally.
- Neighbours are taken from the whole file, not the `window_chars` slice, so a
  token clipped by the window edge never counts as a whole word. The window
  distance itself is unchanged, and `matchedText` is still the raw window.
- Every occurrence of a `near` pattern inside the window is considered; an
  invalid one (`nowhere`) does not hide a later valid one.
- The value must be a boolean. Any other type, and empty `symbol`/`near`
  strings, is reported in `errors[]` and exits `2`.

Only checks that set `word_boundary: true` change behavior; existing configs are
unaffected, and `schemaVersion` stays `3`.

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

See [`examples/architecture.json`](../examples/architecture.json) for a full
worked example.

